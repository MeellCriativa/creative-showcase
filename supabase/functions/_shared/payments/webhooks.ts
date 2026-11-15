/**
 * Processamento comum de webhooks de pagamento.
 *
 * Regras invioláveis:
 *   - a assinatura oficial é validada ANTES de qualquer efeito colateral;
 *   - todo evento é registrado em `payment_events` com idempotência por
 *     (provider, provider_event_id) — duplicata responde 200 sem reprocessar;
 *   - o estado financeiro NUNCA é confirmado pelo corpo do webhook: sempre
 *     consultamos a API oficial do provedor;
 *   - o pedido só é sincronizado depois da confirmação oficial.
 */
import {
  adminClient,
  createRefundRecord,
  finishEvent,
  findTransactionByOrder,
  findTransactionByProviderPayment,
  recordEvent,
  syncOrderPayment,
  updateTransaction,
  type TransactionRow,
} from "./db.ts";
import { loadCredentials } from "./connections.ts";
import { getProvider } from "./index.ts";
import type {
  PaymentProviderKey,
  PaymentStatus,
  ProviderPaymentSnapshot,
  WebhookVerification,
} from "./types.ts";

export type WebhookOutcome = {
  status: number;
  body: Record<string, unknown>;
};

function log(provider: PaymentProviderKey, message: string, extra?: unknown): void {
  console.log(`[webhooks-${provider}] ${message}`, extra ?? "");
}

/** Extrai o id do pedido a partir da referência externa do provedor. */
function orderIdFromReference(value: string | null | undefined): string | null {
  const ref = String(value ?? "").trim();
  if (!ref) return null;
  // UUID direto (PayPal usa o id do pedido como custom_id/reference).
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
    return ref;
  }
  return null;
}

function extractReference(provider: PaymentProviderKey, payload: Record<string, unknown>): string | null {
  const resource = (payload["resource"] ?? {}) as Record<string, unknown>;
  if (provider === "paypal") {
    const purchaseUnits = resource["purchase_units"];
    if (Array.isArray(purchaseUnits) && purchaseUnits.length > 0) {
      const unit = purchaseUnits[0] as Record<string, unknown>;
      const custom = unit["custom_id"] ?? unit["reference_id"] ?? unit["invoice_id"];
      if (custom) return String(custom);
    }
    const supplementary = resource["supplementary_data"] as Record<string, unknown> | undefined;
    const related = supplementary?.["related_ids"] as Record<string, unknown> | undefined;
    if (related?.["order_id"]) return String(related["order_id"]);
    return null;
  }
  const data = (payload["data"] ?? {}) as Record<string, unknown>;
  const candidates = [payload["external_reference"], data["external_reference"]];
  for (const candidate of candidates) {
    if (candidate) return String(candidate);
  }
  return null;
}

async function resolveTransaction(
  provider: PaymentProviderKey,
  verification: WebhookVerification,
): Promise<TransactionRow | null> {
  const providerPaymentId = verification.providerPaymentId;
  if (providerPaymentId) {
    const direct = await findTransactionByProviderPayment(provider, providerPaymentId);
    if (direct) return direct;
  }

  const reference = extractReference(provider, verification.payload);
  const orderId = orderIdFromReference(reference);
  if (orderId) {
    const byOrder = await findTransactionByOrder(orderId, provider);
    if (byOrder) return byOrder;
  }

  // Fallback: procura pelo `provider_order_id` (preferência do Mercado Pago).
  if (providerPaymentId) {
    const admin = adminClient();
    const { data } = await admin
      .from("payment_transactions")
      .select("*")
      .eq("provider", provider)
      .eq("provider_order_id", providerPaymentId)
      .maybeSingle();
    if (data) return data as TransactionRow;
  }
  return null;
}

/**
 * Consulta oficial + atualização de transação/pedido. Usado pelo webhook e
 * também pelo `refresh_payment` do painel.
 */
export async function applyOfficialSnapshot(input: {
  provider: PaymentProviderKey;
  transaction: TransactionRow;
  providerPaymentId: string;
}): Promise<{ ok: boolean; snapshot: ProviderPaymentSnapshot | null; reason?: string }> {
  const loaded = await loadCredentials(input.transaction.catalog_id, input.provider);
  if (!loaded.credentials) {
    return { ok: false, snapshot: null, reason: loaded.reason ?? "Credenciais indisponíveis." };
  }
  const providerImpl = getProvider(input.provider);
  if (!providerImpl) return { ok: false, snapshot: null, reason: "Provedor desconhecido." };

  const snapshot = await providerImpl.getPayment(loaded.credentials, input.providerPaymentId);
  if (!snapshot) return { ok: false, snapshot: null, reason: "Provedor não retornou o pagamento." };

  // Divergência de moeda/valor é registrada, nunca "corrigida" silenciosamente.
  const currencyMismatch =
    snapshot.currency && snapshot.currency.toUpperCase() !== String(input.transaction.currency).toUpperCase();
  const amountMismatch =
    snapshot.amount > 0 && Math.abs(Number(snapshot.amount) - Number(input.transaction.amount)) > 0.01;

  await updateTransaction({
    transactionId: input.transaction.id,
    status: snapshot.status,
    providerStatus: snapshot.providerStatus,
    capturedAmount: snapshot.capturedAmount,
    refundedAmount: snapshot.refundedAmount,
    payerReference: snapshot.payerReference,
    providerPaymentId: snapshot.providerPaymentId,
  });

  await syncOrderPayment({
    orderId: input.transaction.order_id,
    provider: input.provider,
    status: snapshot.status,
    transactionId: input.transaction.id,
  });

  if (currencyMismatch || amountMismatch) {
    log(input.provider, "divergência entre pedido e provedor", {
      transaction: input.transaction.id,
      currency: [input.transaction.currency, snapshot.currency],
      amount: [input.transaction.amount, snapshot.amount],
    });
  }

  return { ok: true, snapshot };
}

/** Registra reembolso detectado via webhook (não solicitado pelo painel). */
async function recordWebhookRefund(
  provider: PaymentProviderKey,
  transaction: TransactionRow,
  snapshot: ProviderPaymentSnapshot,
): Promise<void> {
  const refunded = Number(snapshot.refundedAmount ?? 0);
  const previous = Number(transaction.refunded_amount ?? 0);
  if (refunded <= previous + 0.001) return;
  await createRefundRecord({
    transactionId: transaction.id,
    catalogId: transaction.catalog_id,
    provider,
    providerRefundId: null,
    amount: Math.round((refunded - previous) * 100) / 100,
    status: "approved",
    reason: "Reembolso registrado pelo provedor.",
    requestedBy: null,
  });
}

export async function handleWebhook(input: {
  provider: PaymentProviderKey;
  request: { headers: Record<string, string>; rawBody: string; query: Record<string, string> };
}): Promise<WebhookOutcome> {
  const providerImpl = getProvider(input.provider);
  if (!providerImpl) {
    return { status: 400, body: { success: false, error: "Provedor inválido." } };
  }
  if (!providerImpl.isConfigured()) {
    // Sem credenciais não é possível validar assinatura → recusa explícita.
    return { status: 503, body: { success: false, error: "Provedor não configurado." } };
  }

  const verification = await providerImpl.verifyWebhook(input.request);

  // Evento de verificação/teste do provedor: responde 200 sem efeitos.
  if (verification.isTestEvent && verification.valid) {
    return { status: 200, body: { success: true, ignored: "test_event" } };
  }

  const eventId = verification.eventId || `unknown:${Date.now()}`;
  const recorded = await recordEvent({
    provider: input.provider,
    eventId,
    eventType: verification.eventType,
    signatureValid: verification.valid,
    payload: verification.payload,
  });

  if (!recorded.inserted) {
    log(input.provider, "evento duplicado ignorado", eventId);
    return { status: 200, body: { success: true, duplicate: true } };
  }

  if (!verification.valid) {
    await finishEvent(recorded.id, false, verification.reason ?? "invalid_signature");
    log(input.provider, "assinatura inválida", verification.reason);
    // 401 para o provedor reenviar depois de corrigida a configuração.
    return { status: 401, body: { success: false, error: "Assinatura inválida." } };
  }

  try {
    const transaction = await resolveTransaction(input.provider, verification);
    if (!transaction) {
      await finishEvent(recorded.id, false, "transaction_not_found");
      // 200 evita reenvios infinitos de eventos que não são de pagamento nosso.
      return { status: 200, body: { success: true, ignored: "transaction_not_found" } };
    }

    const providerPaymentId =
      verification.providerPaymentId ??
      transaction.provider_payment_id ??
      transaction.provider_order_id ??
      "";
    if (!providerPaymentId) {
      await finishEvent(recorded.id, false, "missing_provider_payment_id");
      return { status: 200, body: { success: true, ignored: "missing_provider_payment_id" } };
    }

    const applied = await applyOfficialSnapshot({
      provider: input.provider,
      transaction,
      providerPaymentId,
    });
    if (!applied.ok || !applied.snapshot) {
      await finishEvent(recorded.id, false, applied.reason ?? "provider_lookup_failed");
      return { status: 502, body: { success: false, error: "Falha ao confirmar no provedor." } };
    }

    if (
      applied.snapshot.status === "refunded" ||
      applied.snapshot.status === "partially_refunded"
    ) {
      await recordWebhookRefund(input.provider, transaction, applied.snapshot);
    }

    // Associa o evento à transação/pedido (auditoria).
    const admin = adminClient();
    await admin
      .from("payment_events")
      .update({ transaction_id: transaction.id, order_id: transaction.order_id })
      .eq("id", recorded.id!);

    await finishEvent(recorded.id, true);
    log(input.provider, "evento processado", {
      eventId,
      transaction: transaction.id,
      status: applied.snapshot.status as PaymentStatus,
    });

    return { status: 200, body: { success: true, status: applied.snapshot.status } };
  } catch (error) {
    const message = (error as Error).message ?? "internal_error";
    await finishEvent(recorded.id, false, message);
    console.error(`[webhooks-${input.provider}] falha ao processar`, message);
    return { status: 500, body: { success: false, error: "Erro ao processar evento." } };
  }
}
