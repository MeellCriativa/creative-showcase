/**
 * Processamento comum de webhooks de pagamento.
 *
 * Regras invioláveis:
 *   - a assinatura oficial é validada ANTES de qualquer efeito colateral;
 *   - evento com assinatura inválida NUNCA ocupa a chave do evento legítimo
 *     (auditoria C6: um POST forjado podia "queimar" o evento verdadeiro);
 *   - todo evento válido é registrado em `payment_events` com idempotência por
 *     (provider, provider_event_id); duplicata responde 200 sem reprocessar;
 *   - evento que falhou é REPROCESSADO (auditoria A2: antes ficava perdido);
 *   - o estado financeiro NUNCA é confirmado pelo corpo do webhook: sempre
 *     consultamos a API oficial do provedor;
 *   - o pedido só é sincronizado depois da confirmação oficial.
 */
import {
  adminClient,
  claimCapture,
  credentialsFromConnection,
  findActiveTransactionByOrder,
  findConnectionByExternalAccount,
  findTransactionByOrder,
  findTransactionByProviderOrder,
  findTransactionByProviderPayment,
  finishEvent,
  flagDivergence,
  getConnection,
  getEvent,
  recordEvent,
  syncOrderPayment,
  updateTransaction,
  type TransactionRow,
} from "./db.ts";
import { maskEmail } from "./crypto.ts";
import { loadCredentials } from "./connections.ts";
import { getProvider, providerEnvironment } from "./index.ts";
import {
  canClaimCapture,
  connectionEnvironmentMatches,
  detectDivergence,
  detectPaymentOwnershipMismatch,
  eventDecision,
  eventKeyFor,
  isCrossCatalogEvent,
  mergeRefundState,
  paypalAccountMatchesConnection,
  paymentConfirmationGate,
  paymentIdForLookup,
  shouldCapture,
} from "./lifecycle.ts";
import { currencyDecimals } from "./money.ts";
import {
  clientFingerprintFromHeaders,
  enforceRateLimit,
} from "./ratelimit.ts";
import {
  extractReference,
  notificationResource,
  orderIdFromReference,
  resolveTransaction as resolveNotificationTransaction,
} from "./resolution.ts";
import { resolveStoreCurrency } from "../../../../src/lib/currency.ts";
import type {
  NotificationResource,
  PaymentProviderKey,
  PaymentStatus,
  ProviderCredentials,
  ProviderPaymentSnapshot,
  WebhookVerification,
} from "./types.ts";

export type WebhookOutcome = {
  status: number;
  body: Record<string, unknown>;
};

/** Tempo máximo que uma captura fica "presa" antes de poder ser retomada. */
export const CAPTURE_LEASE_MS = 60_000;

function log(provider: PaymentProviderKey, message: string, extra?: unknown): void {
  console.log(`[webhooks-${provider}] ${message}`, extra ?? "");
}

/**
 * Reduz PII antes de persistir o payload bruto em `payment_events`.
 * A resolução do evento usa o payload original; só o registro auditável é
 * redatado (e-mail mascarado, demais dados pessoais removidos).
 */
function redactWebhookPayload(value: unknown, key = ""): unknown {
  const sensitiveKey = key.toLowerCase();
  if (value === null || typeof value !== "object") {
    if (/e-?mail|email/i.test(sensitiveKey) && typeof value === "string") {
      return maskEmail(value);
    }
    if (
      /cpf|cnpj|document|documento|phone|telefone|celular|address|endereco|payer|buyer|customer|comprador|pagador|\bip\b/i.test(
        sensitiveKey,
      )
    ) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => redactWebhookPayload(item));
  const out: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    out[childKey] = redactWebhookPayload(childValue, childKey);
  }
  return out;
}

/** Conta do vendedor informada pelo Mercado Pago no corpo do evento. */
function externalAccountFromPayload(payload: Record<string, unknown>): string {
  return String(payload["user_id"] ?? payload["userId"] ?? "").trim();
}

async function credentialsForNotification(
  provider: PaymentProviderKey,
  payload: Record<string, unknown>,
): Promise<{ credentials: ProviderCredentials | null; catalogId: string | null }> {
  if (provider !== "mercadopago") {
    // PayPal: a consulta usa o token de plataforma, não o do vendedor.
    return { credentials: null, catalogId: null };
  }
  const externalAccountId = externalAccountFromPayload(payload);
  if (!externalAccountId) return { credentials: null, catalogId: null };
  const connection = await findConnectionByExternalAccount(provider, externalAccountId);
  if (!connection) return { credentials: null, catalogId: null };
  // Correção P3: a conta notificada precisa estar autorizada neste ambiente.
  if (!connectionEnvironmentMatches(connection.environment, providerEnvironment(provider))) {
    return { credentials: null, catalogId: null };
  }
  return {
    credentials: await credentialsFromConnection(connection),
    catalogId: connection.catalog_id,
  };
}

/**
 * Consulta oficial + atualização de transação/pedido. Usado pelo webhook e
 * também pelo `refresh_payment` do painel.
 */
export async function applyOfficialSnapshot(input: {
  provider: PaymentProviderKey;
  transaction: TransactionRow;
  providerPaymentId: string;
  /** Captura a ordem quando o provedor exige captura explícita (PayPal). */
  captureIfAuthorized?: boolean;
}): Promise<{
  ok: boolean;
  snapshot: ProviderPaymentSnapshot | null;
  reason?: string;
  captured?: boolean;
  regressed?: boolean;
}> {
  const loaded = await loadCredentials(input.transaction.catalog_id, input.provider);
  if (!loaded.credentials) {
    return { ok: false, snapshot: null, reason: loaded.reason ?? "Credenciais indisponíveis." };
  }
  const providerImpl = getProvider(input.provider);
  if (!providerImpl) return { ok: false, snapshot: null, reason: "Provedor desconhecido." };

  let snapshot = await providerImpl.getPayment(loaded.credentials, input.providerPaymentId);
  if (!snapshot) return { ok: false, snapshot: null, reason: "Provedor não retornou o pagamento." };

  // P4/P5 (PayPal): o `payee.merchant_id` da ordem oficial precisa ser a conta
  // conectada DA LOJA DESTA TRANSAÇÃO. Sem isso, um evento de outra loja poderia
  // capturar/confirmar o pedido errado. Fail-closed antes de qualquer efeito.
  if (
    input.provider === "paypal" &&
    !paypalAccountMatchesConnection({
      snapshotMerchantId: snapshot.sellerAccountId,
      connectionMerchantId: loaded.credentials.merchantId,
      connectionExternalAccountId: loaded.credentials.externalAccountId,
    })
  ) {
    log(input.provider, "conta de destino divergente; confirmação recusada", {
      transaction: input.transaction.id,
    });
    return { ok: false, snapshot: null, reason: "paypal_merchant_mismatch" };
  }

  let captured = false;
  const currency = resolveStoreCurrency(input.transaction.currency);

  /**
   * Correção P2: todo snapshot oficial precisa provar valor, moeda, pedido e
   * vendedor antes de virar confirmação. A mesma checagem roda depois da
   * captura (PayPal), porque a resposta da captura pode trazer outros dados.
   */
  const confirmationFor = (candidate: ProviderPaymentSnapshot) => {
    const divergence = detectDivergence({
      expectedAmount: Number(input.transaction.amount),
      expectedCurrency: currency,
      snapshotAmount: Number(candidate.amount ?? 0),
      snapshotCurrency: String(candidate.currency ?? ""),
      decimals: currencyDecimals(currency),
    });
    const ownership = detectPaymentOwnershipMismatch({
      expectedOrderId: input.transaction.order_id,
      snapshotOrderId: candidate.externalReference,
      expectedSellerId: loaded.credentials.externalAccountId,
      snapshotSellerId: candidate.sellerAccountId,
      // P3: os dois provedores informam pedido e conta na consulta OFICIAL.
      // `paypalSnapshotFromOrder` extrai `custom_id` e `payee.merchant_id`.
      // Ausência impede a confirmação (fail-closed) antes da captura.
      requireOrderReference: true,
      requireSellerAccount: true,
    });
    return { divergence, ownership, gate: paymentConfirmationGate({ divergence, ownership }) };
  };

  // ── Validação financeira ANTES de qualquer efeito (correção P2) ──────────
  const checked = confirmationFor(snapshot);
  if (!checked.gate.allow) {
    if (checked.divergence.hasDivergence) {
      await flagDivergence({
        transactionId: input.transaction.id,
        orderId: input.transaction.order_id,
        expectedAmount: Number(input.transaction.amount),
        receivedAmount: Number(snapshot.amount ?? 0),
        expectedCurrency: currency,
        receivedCurrency: String(snapshot.currency ?? ""),
      });
    }
    log(input.provider, "confirmação recusada: divergência na resposta oficial", {
      transaction: input.transaction.id,
      reason: checked.gate.reason,
      orderMismatch: checked.ownership.orderMismatch,
      sellerMismatch: checked.ownership.sellerMismatch,
      missingOrderReference: checked.ownership.missingOrderReference,
      missingSellerAccount: checked.ownership.missingSellerAccount,
    });
    // `snapshot: null` deixa explícito para o chamador que NADA foi confirmado.
    return { ok: false, snapshot: null, reason: checked.gate.reason ?? "divergence", captured };
  }

  // ── Captura real (PayPal) ────────────────────────────────────────────────
  if (
    input.captureIfAuthorized &&
    shouldCapture({
      provider: input.provider,
      snapshotStatus: snapshot.status,
      transactionStatus: input.transaction.status,
    })
  ) {
    const claimed = await claimCapture(input.transaction.id, CAPTURE_LEASE_MS);
    if (claimed) {
      const capturedSnapshot = await providerImpl.capture(
        loaded.credentials,
        snapshot.providerOrderId ?? input.providerPaymentId,
      );
      if (capturedSnapshot) {
        const afterCapture = confirmationFor(capturedSnapshot);
        if (!afterCapture.gate.allow) {
          log(input.provider, "captura recusada: divergência na resposta oficial", {
            transaction: input.transaction.id,
            reason: afterCapture.gate.reason,
          });
          return {
            ok: false,
            snapshot: null,
            reason: afterCapture.gate.reason ?? "divergence",
            captured: false,
          };
        }
        snapshot = capturedSnapshot;
        captured = true;
      }
    } else {
      log(input.provider, "captura já em andamento", input.transaction.id);
    }
  }

  // ── Reembolsos: nunca regridem ───────────────────────────────────────────
  // F-02: NENHUMA linha de ledger é criada aqui. O total oficial é um
  // SNAPSHOT da transação — somá-lo a uma linha `approved` inflava o saldo.
  // F-06B: quando o provedor não informa o total (`PARTIALLY_REFUNDED` do
  // PayPal sem a lista de refunds), o valor local é preservado e marcado como
  // desconhecido; nada é confirmado por engano.
  const merged = mergeRefundState({
    totalAmount: Number(input.transaction.amount),
    currentRefunded: Number(input.transaction.refunded_amount ?? 0),
    currentStatus: input.transaction.status,
    snapshotRefunded: Number(snapshot.refundedAmount ?? 0),
    snapshotStatus: snapshot.status,
    snapshotKnown: snapshot.refundedAmountKnown ?? true,
  });
  if (merged.regressed) {
    log(input.provider, "provedor informou menos reembolso que o registrado", {
      transaction: input.transaction.id,
      registered: input.transaction.refunded_amount,
      provider: snapshot.refundedAmount,
    });
  }

  const effectiveSnapshot: ProviderPaymentSnapshot = {
    ...snapshot,
    status: merged.status,
    refundedAmount: merged.refundedAmount,
    refundedAmountKnown: merged.refundedAmountKnown,
  };

  const written = await updateTransaction({
    transactionId: input.transaction.id,
    status: merged.status,
    providerStatus: snapshot.providerStatus,
    capturedAmount: snapshot.capturedAmount,
    refundedAmount: merged.refundedAmount,
    payerReference: snapshot.payerReference,
    // Nunca sobrescreve o id da captura com o id da ordem.
    ...(snapshot.providerPaymentId ? { providerPaymentId: snapshot.providerPaymentId } : {}),
  });
  if (!written.ok) {
    // F-06A: sem persistência não há confirmação. O webhook responde 500 para o
    // provedor reenviar; o refresh do painel também reconcilia.
    return {
      ok: false,
      snapshot: effectiveSnapshot,
      reason: "local_persist_failed",
      captured,
      regressed: merged.regressed,
    };
  }

  const synced = await syncOrderPayment({
    orderId: input.transaction.order_id,
    provider: input.provider,
    status: merged.status,
    transactionId: input.transaction.id,
  });
  if (!synced.ok) {
    return {
      ok: false,
      snapshot: effectiveSnapshot,
      reason: "local_persist_failed",
      captured,
      regressed: merged.regressed,
    };
  }

  return { ok: true, snapshot: effectiveSnapshot, captured, regressed: merged.regressed };
}

/**
 * F-02 (2.1.3): o webhook NÃO grava mais linhas de reembolso.
 *
 * O total oficial do provedor é aplicado como SNAPSHOT em
 * `payment_transactions.refunded_amount`. Criar uma linha `approved` anônima
 * aqui fazia o ledger somar o mesmo valor duas vezes (30 → 60).
 */

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

  const resource = notificationResource(input.provider, verification.payload, input.request.query);
  const rawEventId =
    verification.eventId ||
    `${resource.type || "unknown"}:${resource.id || "unknown"}`;
  // Chave própria para assinatura inválida: um POST forjado não bloqueia o
  // evento legítimo (auditoria C6).
  const eventId = eventKeyFor({ valid: verification.valid, eventId: rawEventId });

  const existing = await getEvent(input.provider, eventId);
  const decision = eventDecision({
    valid: verification.valid,
    existing: !!existing,
    processed: !!existing?.processed,
  });

  if (decision === "reject") {
    // P15.1: limita apenas o caminho INVÁLIDO, para impedir inflação de
    // `payment_events` com POSTs forjados sem travar reenvios legítimos do MP.
    const limiter = await enforceRateLimit({
      bucket: `webhook:${input.provider}:${clientFingerprintFromHeaders(input.request.headers)}`,
      windowMs: 60_000,
      max: 60,
    });
    if (!limiter.allowed) {
      log(input.provider, "webhook limitado", limiter.hits);
      return {
        status: limiter.degraded ? 503 : 429,
        body: {
          success: false,
          error: limiter.degraded
            ? "Validação temporariamente indisponível."
            : "Muitas notificações inválidas. Tente novamente.",
        },
      };
    }
    const rejected = await recordEvent({
      provider: input.provider,
      eventId,
      eventType: verification.eventType,
      signatureValid: false,
      payload: redactWebhookPayload(verification.payload) as Record<string, unknown>,
    });
    if (rejected.id) {
      await finishEvent(rejected.id, false, verification.reason ?? "invalid_signature");
    }
    log(input.provider, "assinatura inválida", verification.reason);
    // 401 para o provedor reenviar depois de corrigida a configuração.
    return { status: 401, body: { success: false, error: "Assinatura inválida." } };
  }

  if (decision === "duplicate") {
    log(input.provider, "evento duplicado ignorado", eventId);
    return { status: 200, body: { success: true, duplicate: true } };
  }

  let eventRowId = existing?.id ?? null;
  if (decision === "process") {
    const recorded = await recordEvent({
      provider: input.provider,
      eventId,
      eventType: verification.eventType,
      signatureValid: true,
      payload: redactWebhookPayload(verification.payload) as Record<string, unknown>,
    });
    if (recorded.error) {
      // Erro real de banco: NÃO tratamos como duplicata (auditoria A1).
      console.error(`[webhooks-${input.provider}] falha ao registrar evento`, recorded.error);
      return { status: 500, body: { success: false, error: "Falha ao registrar evento." } };
    }
    if (recorded.duplicate) {
      // Corrida entre isolates: alguém registrou entre a consulta e o insert.
      const raced = await getEvent(input.provider, eventId);
      if (raced?.processed) {
        return { status: 200, body: { success: true, duplicate: true } };
      }
      eventRowId = raced?.id ?? null;
    } else {
      eventRowId = recorded.id;
    }
  } else {
    log(input.provider, "reprocessando evento com falha anterior", eventId);
  }

  try {
    const result = await processVerifiedEvent({
      provider: input.provider,
      verification,
      resource,
    });

    if (result.transaction) {
      await associateEvent(eventRowId, result.transaction);
    }
    if (!result.ok) {
      await finishEvent(eventRowId, false, result.reason ?? "not_processed");
      return {
        status: result.status,
        body: { success: result.status < 400, ...(result.reason ? { ignored: result.reason } : {}) },
      };
    }

    await finishEvent(eventRowId, true);
    log(input.provider, "evento processado", {
      eventId,
      transaction: result.transaction?.id,
      status: result.snapshot?.status as PaymentStatus,
    });
    return {
      status: 200,
      body: {
        success: true,
        status: result.snapshot?.status,
        captured: result.captured ?? false,
      },
    };
  } catch (error) {
    const message = (error as Error).message ?? "internal_error";
    await finishEvent(eventRowId, false, message);
    console.error(`[webhooks-${input.provider}] falha ao processar`, message);
    return { status: 500, body: { success: false, error: "Erro ao processar evento." } };
  }
}

async function associateEvent(
  eventRowId: string | null,
  transaction: TransactionRow,
): Promise<void> {
  if (!eventRowId) return;
  const admin = adminClient();
  await admin
    .from("payment_events")
    .update({ transaction_id: transaction.id, order_id: transaction.order_id })
    .eq("id", eventRowId);
}

type ProcessResult = {
  ok: boolean;
  status: number;
  reason?: string;
  transaction: TransactionRow | null;
  snapshot?: ProviderPaymentSnapshot | null;
  captured?: boolean;
};

/**
 * Resolve a transação e aplica o estado oficial.
 *
 * A resolução é delegada para `resolution.ts` (módulo puro e testável) e usa,
 * nesta ordem: id de pagamento conhecido → referência do payload → consulta
 * oficial → id de preferência/ordem.
 */
async function processVerifiedEvent(input: {
  provider: PaymentProviderKey;
  verification: WebhookVerification;
  resource: NotificationResource;
}): Promise<ProcessResult> {
  const { provider, verification, resource } = input;
  const notification = await credentialsForNotification(provider, verification.payload);

  const resolved = await resolveNotificationTransaction<TransactionRow>({
    provider,
    resource,
    payload: verification.payload,
    providerPaymentId: verification.providerPaymentId,
    deps: {
      byProviderPayment: (id) => findTransactionByProviderPayment(provider, id),
      byOrder: (orderId) => findTransactionByOrder(orderId, provider),
      byProviderOrder: (id) => findTransactionByProviderOrder(provider, id),
      resolveNotification: async (res) => {
        const providerImpl = getProvider(provider);
        if (!providerImpl) return null;
        const credentials = notification.credentials ?? {
          accessToken: null,
          refreshToken: null,
          expiresAt: null,
          scopes: [],
          externalAccountId: "",
          externalAccountLabel: "",
          merchantId: null,
          capabilities: {},
        };
        const found = await providerImpl.resolveNotification(credentials, res);
        if (!found) return null;
        return {
          externalReference: found.externalReference,
          providerPaymentId: found.providerPaymentId,
        };
      },
    },
  });

  if (!resolved) {
    // 200 evita reenvios infinitos de eventos que não são de pagamento nosso.
    return { ok: false, status: 200, reason: "transaction_not_found", transaction: null };
  }

  // Isolamento entre vendedores: a transação precisa pertencer à loja dona da
  // conta que notificou.
  if (isCrossCatalogEvent(notification.catalogId, resolved.transaction.catalog_id)) {
    log(provider, "evento de outra loja ignorado", {
      notification: notification.catalogId,
      transaction: resolved.transaction.catalog_id,
    });
    return {
      ok: false,
      status: 200,
      reason: "cross_catalog_event",
      transaction: resolved.transaction,
    };
  }

  // P7: quando o payload não traz `user_id`, a checagem acima é pulada. Nesse
  // caso usamos a conta devolvida pela API oficial (`collector_id`) para
  // descobrir a loja dona e bloquear qualquer cruzamento entre vendedores.
  if (provider === "mercadopago" && !notification.catalogId && resolved.sellerAccountId) {
    const officialConnection = await findConnectionByExternalAccount(
      provider,
      resolved.sellerAccountId,
    );
    if (
      officialConnection?.catalog_id &&
      officialConnection.catalog_id !== resolved.transaction.catalog_id
    ) {
      log(provider, "evento de outra loja ignorado (conta oficial)", {
        officialCatalog: officialConnection.catalog_id,
        transaction: resolved.transaction.catalog_id,
      });
      return {
        ok: false,
        status: 200,
        reason: "cross_catalog_event",
        transaction: resolved.transaction,
      };
    }
  }

  // P4/P5 (PayPal): defesa em profundidade. A conta oficial devolvida pela
  // consulta da notificação precisa pertencer à loja dona da transação. Mesmo
  // que o payload não traga conta, `applyOfficialSnapshot` volta a exigir.
  if (provider === "paypal" && resolved.sellerAccountId) {
    const transactionConnection = await getConnection(resolved.transaction.catalog_id, provider);
    if (
      !transactionConnection ||
      !paypalAccountMatchesConnection({
        snapshotMerchantId: resolved.sellerAccountId,
        connectionMerchantId: transactionConnection.merchant_id,
        connectionExternalAccountId: transactionConnection.external_account_id,
      })
    ) {
      log(provider, "evento de outra conta PayPal ignorado", {
        transaction: resolved.transaction.id,
      });
      return {
        ok: false,
        status: 200,
        reason: "cross_seller_event",
        transaction: resolved.transaction,
      };
    }
  }

  const providerPaymentId = paymentIdForLookup({
    provider,
    providerPaymentId: resolved.transaction.provider_payment_id,
    providerOrderId: resolved.transaction.provider_order_id,
    resourceType: resource.type,
    resourceId: resource.id,
    resolvedPaymentId: resolved.providerPaymentId,
  });
  if (!providerPaymentId) {
    return {
      ok: false,
      status: 200,
      reason: "missing_provider_payment_id",
      transaction: resolved.transaction,
    };
  }

  const applied = await applyOfficialSnapshot({
    provider,
    transaction: resolved.transaction,
    providerPaymentId,
    captureIfAuthorized: true,
  });
  if (!applied.ok || !applied.snapshot) {
    return {
      ok: false,
      status: 502,
      reason: applied.reason ?? "provider_lookup_failed",
      transaction: resolved.transaction,
    };
  }

  return {
    ok: true,
    status: 200,
    transaction: resolved.transaction,
    snapshot: applied.snapshot,
    captured: applied.captured,
  };
}

/**
 * Reexportado para o painel: encontra a transação ativa de um pedido antes de
 * criar uma nova cobrança (auditoria A4).
 */
export async function findReusableTransaction(
  orderId: string,
  provider: PaymentProviderKey,
): Promise<TransactionRow | null> {
  return findActiveTransactionByOrder(orderId, provider);
}

export { canClaimCapture, extractReference, orderIdFromReference };
