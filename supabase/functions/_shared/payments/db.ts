/**
 * Acesso ao banco para a camada de pagamentos.
 *
 * Todas as escritas em tabelas financeiras passam por aqui, sempre com o
 * cliente service_role (nunca com o token do navegador).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decryptSecret,
  encryptSecret,
  encryptionConfigured,
  randomToken,
  sha256Hex,
} from "./crypto.ts";
import type {
  PaymentProviderKey,
  PaymentStatus,
  ProviderCredentials,
} from "./types.ts";

export const CHECKOUT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export async function verifyUser(req: Request) {
  const header = req.headers.get("Authorization");
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export type CatalogRow = {
  id: string;
  user_id: string;
  slug: string;
  store_name: string;
  whatsapp: string | null;
  currency: string | null;
  payment_methods: string[] | null;
  delivery_methods: string[] | null;
  shipping_origin_zip: string | null;
};

export async function getCatalog(catalogId: string): Promise<CatalogRow | null> {
  const admin = adminClient();
  const { data } = await admin
    .from("catalogs")
    .select("id, user_id, slug, store_name, whatsapp, currency, payment_methods, delivery_methods, shipping_origin_zip")
    .eq("id", catalogId)
    .maybeSingle();
  return (data as CatalogRow | null) ?? null;
}

export async function getOwnedCatalog(
  userId: string,
  catalogId: string,
): Promise<CatalogRow | null> {
  const catalog = await getCatalog(catalogId);
  if (!catalog || catalog.user_id !== userId) return null;
  return catalog;
}

export type ConnectionRow = {
  id: string;
  catalog_id: string;
  provider: PaymentProviderKey;
  environment: string;
  status: string;
  enabled: boolean;
  connected: boolean;
  external_account_id: string | null;
  external_account_label: string | null;
  merchant_id: string | null;
  scopes: string[] | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  capabilities: Record<string, unknown> | null;
  last_verified_at: string | null;
  connected_at: string | null;
};

export async function getConnection(
  catalogId: string,
  provider: PaymentProviderKey,
): Promise<ConnectionRow | null> {
  const admin = adminClient();
  const { data } = await admin
    .from("payment_connections")
    .select("*")
    .eq("catalog_id", catalogId)
    .eq("provider", provider)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
}

/** Descriptografa as credenciais. Retorna `null` se não houver token válido. */
export async function credentialsFromConnection(
  row: ConnectionRow | null,
): Promise<ProviderCredentials | null> {
  if (!row || !row.access_token_enc) return null;
  const accessToken = await decryptSecret(row.access_token_enc);
  if (!accessToken) return null;
  const refreshToken = row.refresh_token_enc ? await decryptSecret(row.refresh_token_enc) : null;
  return {
    accessToken,
    refreshToken,
    expiresAt: row.token_expires_at,
    scopes: row.scopes ?? [],
    externalAccountId: row.external_account_id ?? "",
    externalAccountLabel: row.external_account_label ?? "",
    merchantId: row.merchant_id,
    capabilities: row.capabilities ?? {},
  };
}

export async function saveConnection(input: {
  catalogId: string;
  provider: PaymentProviderKey;
  environment: string;
  credentials: ProviderCredentials;
  status?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!encryptionConfigured()) {
    return { ok: false, error: "Criptografia de tokens não configurada na plataforma." };
  }
  const accessEnc = await encryptSecret(input.credentials.accessToken ?? "");
  const refreshEnc = input.credentials.refreshToken
    ? await encryptSecret(input.credentials.refreshToken)
    : null;
  if (!accessEnc) {
    return { ok: false, error: "Falha ao criptografar o token de acesso." };
  }
  const admin = adminClient();
  const now = new Date().toISOString();
  const { error } = await admin.from("payment_connections").upsert(
    {
      catalog_id: input.catalogId,
      provider: input.provider,
      environment: input.environment,
      status: input.status ?? "connected",
      connected: true,
      external_account_id: input.credentials.externalAccountId || null,
      external_account_label: input.credentials.externalAccountLabel || null,
      merchant_id: input.credentials.merchantId,
      scopes: input.credentials.scopes,
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: input.credentials.expiresAt,
      capabilities: input.credentials.capabilities,
      last_verified_at: now,
      connected_at: now,
      disconnected_at: null,
      updated_at: now,
    },
    { onConflict: "catalog_id,provider" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateConnectionTokens(input: {
  catalogId: string;
  provider: PaymentProviderKey;
  credentials: ProviderCredentials;
}): Promise<void> {
  const accessEnc = await encryptSecret(input.credentials.accessToken ?? "");
  if (!accessEnc) return;
  const refreshEnc = input.credentials.refreshToken
    ? await encryptSecret(input.credentials.refreshToken)
    : null;
  const admin = adminClient();
  await admin
    .from("payment_connections")
    .update({
      access_token_enc: accessEnc,
      ...(refreshEnc ? { refresh_token_enc: refreshEnc } : {}),
      token_expires_at: input.credentials.expiresAt,
      scopes: input.credentials.scopes,
      capabilities: input.credentials.capabilities,
      status: "connected",
      connected: true,
      updated_at: new Date().toISOString(),
    })
    .eq("catalog_id", input.catalogId)
    .eq("provider", input.provider);
}

export async function markConnectionState(input: {
  catalogId: string;
  provider: PaymentProviderKey;
  status: "pending" | "connected" | "expired" | "revoked" | "error";
  connected: boolean;
  enabled?: boolean;
}): Promise<void> {
  const admin = adminClient();
  await admin
    .from("payment_connections")
    .update({
      status: input.status,
      connected: input.connected,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.connected ? {} : { disconnected_at: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    })
    .eq("catalog_id", input.catalogId)
    .eq("provider", input.provider);
}

export async function deleteConnection(
  catalogId: string,
  provider: PaymentProviderKey,
): Promise<void> {
  const admin = adminClient();
  await admin
    .from("payment_connections")
    .delete()
    .eq("catalog_id", catalogId)
    .eq("provider", provider);
}

/* ── Sessões de checkout ─────────────────────────────────────────────────── */

export async function createCheckoutSession(
  orderId: string,
  catalogId: string,
): Promise<string> {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  const admin = adminClient();
  const { error } = await admin.from("order_checkout_sessions").insert({
    order_id: orderId,
    catalog_id: catalogId,
    token_hash: hash,
    expires_at: new Date(Date.now() + CHECKOUT_SESSION_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`checkout session: ${error.message}`);
  return token;
}

/** Valida o token do comprador. Não consome (o pagamento pode ser retentado). */
export async function validateCheckoutSession(
  orderId: string,
  token: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!orderId || !token) return { ok: false, reason: "Sessão de checkout ausente." };
  const hash = await sha256Hex(token);
  const admin = adminClient();
  const { data } = await admin
    .from("order_checkout_sessions")
    .select("order_id, token_hash, expires_at, consumed_at")
    .eq("order_id", orderId)
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data) return { ok: false, reason: "Sessão de checkout inválida." };
  if (data.consumed_at) return { ok: false, reason: "Sessão de checkout já utilizada." };
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    return { ok: false, reason: "Sessão de checkout expirada. Refaça o pedido." };
  }
  return { ok: true };
}

/* ── Transações ──────────────────────────────────────────────────────────── */

export type TransactionRow = {
  id: string;
  catalog_id: string;
  order_id: string;
  provider: PaymentProviderKey;
  environment: string;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  status: PaymentStatus;
  currency: string;
  amount: number;
  amount_minor: number;
  captured_amount: number;
  refunded_amount: number;
  checkout_url: string | null;
  provider_status: string | null;
  payer_reference: string | null;
  metadata: Record<string, unknown> | null;
};

export async function createTransaction(input: {
  catalogId: string;
  orderId: string;
  provider: PaymentProviderKey;
  environment: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  status: PaymentStatus;
  currency: string;
  amount: number;
  amountMinor: number;
  checkoutUrl: string | null;
  providerStatus: string | null;
  metadata?: Record<string, unknown>;
}): Promise<TransactionRow | null> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("payment_transactions")
    .insert({
      catalog_id: input.catalogId,
      order_id: input.orderId,
      provider: input.provider,
      environment: input.environment,
      provider_order_id: input.providerOrderId,
      provider_payment_id: input.providerPaymentId,
      status: input.status,
      currency: input.currency,
      amount: input.amount,
      amount_minor: input.amountMinor,
      checkout_url: input.checkoutUrl,
      provider_status: input.providerStatus,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("[payments] createTransaction", error.message);
    return null;
  }
  return (data as TransactionRow | null) ?? null;
}

export async function findTransactionByProviderPayment(
  provider: PaymentProviderKey,
  providerPaymentId: string,
): Promise<TransactionRow | null> {
  const admin = adminClient();
  const { data } = await admin
    .from("payment_transactions")
    .select("*")
    .eq("provider", provider)
    .eq("provider_payment_id", providerPaymentId)
    .maybeSingle();
  return (data as TransactionRow | null) ?? null;
}

export async function findTransactionByOrder(
  orderId: string,
  provider: PaymentProviderKey,
): Promise<TransactionRow | null> {
  const admin = adminClient();
  const { data } = await admin
    .from("payment_transactions")
    .select("*")
    .eq("order_id", orderId)
    .eq("provider", provider)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as TransactionRow | null) ?? null;
}

export async function updateTransaction(input: {
  transactionId: string;
  status: PaymentStatus;
  providerStatus: string | null;
  capturedAmount?: number;
  refundedAmount?: number;
  payerReference?: string | null;
  providerPaymentId?: string | null;
}): Promise<void> {
  const admin = adminClient();
  const now = new Date().toISOString();
  await admin
    .from("payment_transactions")
    .update({
      status: input.status,
      provider_status: input.providerStatus,
      ...(input.capturedAmount === undefined ? {} : { captured_amount: input.capturedAmount }),
      ...(input.refundedAmount === undefined ? {} : { refunded_amount: input.refundedAmount }),
      ...(input.payerReference === undefined ? {} : { payer_reference: input.payerReference }),
      ...(input.providerPaymentId === undefined
        ? {}
        : { provider_payment_id: input.providerPaymentId }),
      last_event_at: now,
      updated_at: now,
    })
    .eq("id", input.transactionId);
}

/** Espelha o estado financeiro no pedido (nunca sobrescreve status logístico). */
export async function syncOrderPayment(input: {
  orderId: string;
  provider: PaymentProviderKey;
  status: PaymentStatus;
  transactionId: string;
}): Promise<void> {
  const admin = adminClient();
  await admin
    .from("orders")
    .update({
      payment_status: input.status,
      payment_provider: input.provider,
      payment_transaction_id: input.transactionId,
    })
    .eq("id", input.orderId);
}

/* ── Eventos (idempotência) ──────────────────────────────────────────────── */

/**
 * Registra o evento. Retorna `{ inserted: false }` quando o mesmo evento já foi
 * recebido (constraint única por provedor + id) — o webhook responde 200 e não
 * reprocessa nada.
 */
export async function recordEvent(input: {
  provider: PaymentProviderKey;
  eventId: string;
  eventType: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
  transactionId?: string | null;
  orderId?: string | null;
}): Promise<{ inserted: boolean; id: string | null }> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("payment_events")
    .insert({
      provider: input.provider,
      provider_event_id: input.eventId,
      event_type: input.eventType,
      signature_valid: input.signatureValid,
      payload: input.payload,
      transaction_id: input.transactionId ?? null,
      order_id: input.orderId ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    // 23505 = unique_violation → evento duplicado.
    if ((error as { code?: string }).code === "23505") {
      return { inserted: false, id: null };
    }
    console.error("[payments] recordEvent", error.message);
    return { inserted: false, id: null };
  }
  return { inserted: true, id: (data?.id as string) ?? null };
}

export async function finishEvent(
  eventRowId: string | null,
  processed: boolean,
  error?: string,
): Promise<void> {
  if (!eventRowId) return;
  const admin = adminClient();
  await admin
    .from("payment_events")
    .update({
      processed,
      processing_error: error ?? null,
      processed_at: new Date().toISOString(),
    })
    .eq("id", eventRowId);
}

/* ── Reembolsos ──────────────────────────────────────────────────────────── */

export async function createRefundRecord(input: {
  transactionId: string;
  catalogId: string;
  provider: PaymentProviderKey;
  providerRefundId: string | null;
  amount: number;
  status: "pending" | "approved" | "failed" | "cancelled";
  reason: string | null;
  requestedBy: string | null;
}): Promise<void> {
  const admin = adminClient();
  await admin.from("payment_refunds").insert({
    transaction_id: input.transactionId,
    catalog_id: input.catalogId,
    provider: input.provider,
    provider_refund_id: input.providerRefundId,
    amount: input.amount,
    status: input.status,
    reason: input.reason,
    requested_by: input.requestedBy,
  });
}
