/**
 * Acesso ao banco para a camada de pagamentos.
 *
 * Todas as escritas em tabelas financeiras passam por aqui, sempre com o
 * cliente service_role (nunca com o token do navegador).
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isBlockedPaymentStatus } from "../digital_delivery_pure.ts";
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
  // Correção da auditoria (M2): `connected` era sempre `true`, mesmo quando o
  // status era `pending`/`expired`. Agora é derivado do status — é ele que
  // libera o checkout.
  const status = input.status ?? "connected";
  const connected = status === "connected";
  const { error } = await admin.from("payment_connections").upsert(
    {
      catalog_id: input.catalogId,
      provider: input.provider,
      environment: input.environment,
      status,
      connected,
      external_account_id: input.credentials.externalAccountId || null,
      external_account_label: input.credentials.externalAccountLabel || null,
      merchant_id: input.credentials.merchantId,
      scopes: input.credentials.scopes,
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      token_expires_at: input.credentials.expiresAt,
      capabilities: input.credentials.capabilities,
      last_verified_at: now,
      ...(connected ? { connected_at: now, disconnected_at: null } : {}),
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

/**
 * Localiza a loja dona de uma conta do provedor.
 *
 * Correção da auditoria (C1): o webhook do Mercado Pago só traz `user_id` (a
 * conta do vendedor). Sem esta busca não há como saber qual token usar para
 * consultar o pagamento.
 */
export async function findConnectionByExternalAccount(
  provider: PaymentProviderKey,
  externalAccountId: string,
): Promise<ConnectionRow | null> {
  const id = String(externalAccountId ?? "").trim();
  if (!id) return null;
  const admin = adminClient();
  const { data } = await admin
    .from("payment_connections")
    .select("*")
    .eq("provider", provider)
    .eq("external_account_id", id)
    .maybeSingle();
  return (data as ConnectionRow | null) ?? null;
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

/** Valida o token do comprador. */
export async function validateCheckoutSession(
  orderId: string,
  token: string,
  options: { allowConsumed?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; consumed?: boolean }> {
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
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    return { ok: false, reason: "Sessão de checkout expirada. Refaça o pedido." };
  }
  const consumed = !!data.consumed_at;
  if (consumed && !options.allowConsumed) {
    return { ok: false, consumed: true, reason: "Sessão de checkout já utilizada." };
  }
  return { ok: true, consumed };
}

/**
 * Marca a sessão como usada (uma única vez).
 *
 * Correção da auditoria (A3): o token nunca era consumido, então o mesmo link
 * podia iniciar pagamentos indefinidamente. A marcação é condicional
 * (`consumed_at is null`), portanto duas requisições simultâneas não passam.
 */
export async function consumeCheckoutSession(
  orderId: string,
  token: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (!orderId || !token) return { ok: false, reason: "Sessão de checkout ausente." };
  const hash = await sha256Hex(token);
  const admin = adminClient();
  const { data, error } = await admin
    .from("order_checkout_sessions")
    .update({ consumed_at: new Date().toISOString() })
    .eq("order_id", orderId)
    .eq("token_hash", hash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[payments] consumeCheckoutSession", error.message);
    return { ok: false, reason: "Não foi possível validar a sessão de checkout." };
  }
  if (!data) return { ok: false, reason: "Sessão de checkout já utilizada ou expirada." };
  return { ok: true };
}

/**
 * Compensa o consumo da sessão quando a cobrança foi criada no provedor mas o
 * espelho local `payment_transactions` falhou. Sem isso o comprador ficaria sem
 * link e o retry seria recusado apesar de não haver transação registrada.
 */
export async function releaseCheckoutSession(
  orderId: string,
  token: string,
): Promise<void> {
  if (!orderId || !token) return;
  const hash = await sha256Hex(token);
  const admin = adminClient();
  const { error } = await admin
    .from("order_checkout_sessions")
    .update({ consumed_at: null })
    .eq("order_id", orderId)
    .eq("token_hash", hash)
    .not("consumed_at", "is", null)
    .gt("expires_at", new Date().toISOString());
  if (error) console.error("[payments] releaseCheckoutSession", error.message);
}

/* ── Nonces de OAuth (uso único) ─────────────────────────────────────────── */

/**
 * Guarda o nonce do `state` para uso único.
 *
 * Correção da auditoria (M8): o `state` assinado expirava, mas podia ser
 * reapresentado quantas vezes quisesse dentro da validade. Agora cada nonce só
 * pode ser trocado por credenciais uma vez.
 */
export async function saveOAuthState(input: {
  nonce: string;
  catalogId: string;
  provider: PaymentProviderKey;
  userId: string;
  expiresAt: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = adminClient();
  const { error } = await admin.from("payment_oauth_states").insert({
    nonce: input.nonce,
    catalog_id: input.catalogId,
    provider: input.provider,
    user_id: input.userId,
    expires_at: input.expiresAt,
  });
  if (error) {
    // P11: falha precisa ser propagada. Sem o nonce gravado o callback
    // terminaria em `state_already_used` depois da autorização do vendedor.
    console.error("[payments] saveOAuthState", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Consome o nonce. `false` = já usado, inexistente ou expirado. */
export async function consumeOAuthState(nonce: string): Promise<boolean> {
  const id = String(nonce ?? "").trim();
  if (!id) return false;
  const admin = adminClient();
  const { data, error } = await admin
    .from("payment_oauth_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("nonce", id)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("nonce")
    .maybeSingle();
  if (error) {
    console.error("[payments] consumeOAuthState", error.message);
    return false;
  }
  return !!data;
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

export async function findTransactionByProviderOrder(
  provider: PaymentProviderKey,
  providerOrderId: string,
): Promise<TransactionRow | null> {
  const admin = adminClient();
  const { data } = await admin
    .from("payment_transactions")
    .select("*")
    .eq("provider", provider)
    .eq("provider_order_id", providerOrderId)
    .maybeSingle();
  return (data as TransactionRow | null) ?? null;
}

/** Status em que a cobrança ainda pode evoluir (não é terminal). */
export const ACTIVE_TRANSACTION_STATUSES: readonly PaymentStatus[] = [
  "pending",
  "authorized",
];

/**
 * Transação ainda "viva" do pedido.
 *
 * Correção da auditoria (A4): sem isso, cada clique em "pagar" criava outra
 * cobrança para o mesmo pedido — duas preferências abertas, dois pagamentos
 * possíveis.
 *
 * `provider` nulo consulta qualquer provedor: um pedido não pode ter duas
 * cobranças vivas, nem de provedores diferentes.
 */
export async function findActiveTransactionByOrder(
  orderId: string,
  provider: PaymentProviderKey | null = null,
): Promise<TransactionRow | null> {
  const admin = adminClient();
  let query = admin
    .from("payment_transactions")
    .select("*")
    .eq("order_id", orderId)
    .in("status", ACTIVE_TRANSACTION_STATUSES as unknown as string[]);
  if (provider) query = query.eq("provider", provider);
  const { data } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as TransactionRow | null) ?? null;
}

/**
 * Reserva exclusiva da captura (lease).
 *
 * Correção da auditoria (M9): dois webhooks simultâneos podiam capturar a mesma
 * ordem. A captura é idempotente no provedor, mas o lease evita chamadas
 * duplicadas e mantém o estado local coerente.
 */
export async function claimCapture(
  transactionId: string,
  leaseMs: number,
): Promise<boolean> {
  const admin = adminClient();
  const now = Date.now();
  const cutoff = new Date(now - leaseMs).toISOString();
  // UPDATE condicional + RETURNING: só quem alterou a linha recebe `data`.
  // O antigo SELECT + UPDATE permitia dois isolates obterem o lease ao mesmo tempo.
  const { data, error } = await admin
    .from("payment_transactions")
    .update({ capture_claimed_at: new Date(now).toISOString() })
    .eq("id", transactionId)
    .or(`capture_claimed_at.is.null,capture_claimed_at.lt.${cutoff}`)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[payments] claimCapture", error.message);
    return false;
  }
  return !!data?.id;
}

export async function releaseCapture(transactionId: string): Promise<void> {
  const admin = adminClient();
  await admin
    .from("payment_transactions")
    .update({ capture_claimed_at: null })
    .eq("id", transactionId);
}

/**
 * Registra divergência entre o valor/moeda do pedido e o confirmado pelo
 * provedor. Nunca corrige o valor do pedido — apenas deixa rastro auditável.
 */
export async function flagDivergence(input: {
  transactionId: string;
  orderId: string;
  expectedAmount: number;
  receivedAmount: number;
  expectedCurrency: string;
  receivedCurrency: string;
}): Promise<void> {
  const admin = adminClient();
  const { data } = await admin
    .from("payment_transactions")
    .select("metadata")
    .eq("id", input.transactionId)
    .maybeSingle();
  const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
  const divergences = Array.isArray(metadata["divergences"])
    ? (metadata["divergences"] as unknown[])
    : [];
  const entry = {
    at: new Date().toISOString(),
    order_id: input.orderId,
    expected_amount: input.expectedAmount,
    received_amount: input.receivedAmount,
    expected_currency: input.expectedCurrency,
    received_currency: input.receivedCurrency,
  };
  const next = [...divergences.slice(-19), entry];
  await admin
    .from("payment_transactions")
    .update({ metadata: { ...metadata, divergences: next } })
    .eq("id", input.transactionId);
}

export async function updateTransaction(input: {
  transactionId: string;
  status: PaymentStatus;
  providerStatus: string | null;
  capturedAmount?: number;
  refundedAmount?: number;
  payerReference?: string | null;
  providerPaymentId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = adminClient();
  const now = new Date().toISOString();
  const { error } = await admin
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
  if (error) {
    // F-06A: quem chama PRECISA saber que a gravação falhou. Antes o erro era
    // descartado e o painel exibia sucesso financeiro sem estado persistido.
    console.error("[payments] updateTransaction", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Espelha o estado financeiro no pedido (nunca sobrescreve status logístico). */
export async function syncOrderPayment(input: {
  orderId: string;
  provider: PaymentProviderKey;
  status: PaymentStatus;
  transactionId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = adminClient();
  const { error } = await admin
    .from("orders")
    .update({
      payment_status: input.status,
      payment_provider: input.provider,
      payment_transaction_id: input.transactionId,
    })
    .eq("id", input.orderId);
  if (error) {
    console.error("[payments] syncOrderPayment", error.message);
    return { ok: false, error: error.message };
  }

  // Reembolso/chargeback/cancelamento revoga links ainda válidos.
  // Best-effort: nunca altera o resultado financeiro da sincronização.
  if (isBlockedPaymentStatus(input.status)) {
    try {
      const now = new Date().toISOString();
      await admin
        .from("digital_download_tokens")
        .update({ revoked_at: now })
        .eq("order_id", input.orderId)
        .is("revoked_at", null);
      await admin
        .from("digital_deliveries")
        .update({ revoked_at: now, updated_at: now })
        .eq("order_id", input.orderId)
        .is("revoked_at", null);
    } catch (revokeError) {
      console.error(
        "[payments] syncOrderPayment: falha ao revogar links digitais",
        revokeError instanceof Error ? revokeError.message : "erro",
      );
    }
  }
  return { ok: true };
}

/* ── Eventos (idempotência) ──────────────────────────────────────────────── */

export type RecordEventResult = {
  inserted: boolean;
  id: string | null;
  /** `true` quando o evento já existia (constraint única). */
  duplicate: boolean;
  /** Erro real de banco — NUNCA deve ser confundido com duplicata. */
  error?: string;
};

/**
 * Registra o evento verificado.
 *
 * Correção da auditoria (A1): qualquer erro era devolvido como "duplicata",
 * então uma falha de banco fazia o evento ser descartado em silêncio. Agora só
 * o código 23505 é duplicata; o resto é erro de verdade (o webhook responde
 * 500 e o provedor reenvia).
 */
export async function recordEvent(input: {
  provider: PaymentProviderKey;
  eventId: string;
  eventType: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
  transactionId?: string | null;
  orderId?: string | null;
}): Promise<RecordEventResult> {
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
    if ((error as { code?: string }).code === "23505") {
      return { inserted: false, id: null, duplicate: true };
    }
    console.error("[payments] recordEvent", error.message);
    return { inserted: false, id: null, duplicate: false, error: error.message };
  }
  return { inserted: true, id: (data?.id as string) ?? null, duplicate: false };
}

export type EventRow = {
  id: string;
  provider: PaymentProviderKey;
  provider_event_id: string;
  event_type: string | null;
  signature_valid: boolean;
  processed: boolean;
  processing_error: string | null;
  processed_at: string | null;
  attempts: number;
  transaction_id: string | null;
  order_id: string | null;
};

export async function getEvent(
  provider: PaymentProviderKey,
  eventId: string,
): Promise<EventRow | null> {
  const admin = adminClient();
  const { data } = await admin
    .from("payment_events")
    .select("*")
    .eq("provider", provider)
    .eq("provider_event_id", eventId)
    .maybeSingle();
  return (data as EventRow | null) ?? null;
}

export async function finishEvent(
  eventRowId: string | null,
  processed: boolean,
  error?: string,
): Promise<void> {
  if (!eventRowId) return;
  const admin = adminClient();
  const { data } = await admin
    .from("payment_events")
    .select("attempts")
    .eq("id", eventRowId)
    .maybeSingle();
  const attempts = Number(data?.attempts ?? 0) + 1;
  await admin
    .from("payment_events")
    .update({
      processed,
      processing_error: error ?? null,
      processed_at: new Date().toISOString(),
      attempts,
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
  /** Identificador da operação (R-01). Só é gravado quando a coluna existe. */
  operationId?: string | null;
  /** F-02: `snapshot` = espelho do total oficial, nunca somável. */
  entryKind?: "operation" | "snapshot";
  idempotencyKey?: string | null;
  dedupeKey?: string | null;
}): Promise<string | null> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("payment_refunds")
    .insert({
      transaction_id: input.transactionId,
      catalog_id: input.catalogId,
      provider: input.provider,
      provider_refund_id: input.providerRefundId,
      amount: input.amount,
      status: input.status,
      reason: input.reason,
      requested_by: input.requestedBy,
      ...(input.operationId ? { operation_id: input.operationId } : {}),
      ...(input.entryKind ? { entry_kind: input.entryKind } : {}),
      ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
      ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[payments] createRefundRecord", error.message);
    return null;
  }
  return (data?.id as string) ?? null;
}

export type RefundRow = {
  id: string;
  transaction_id: string;
  catalog_id: string;
  provider: PaymentProviderKey;
  provider_refund_id: string | null;
  amount: number;
  status: string;
  reason: string | null;
  requested_by: string | null;
  created_at: string;
  /** Presente apenas depois da migration de operações (R-01). */
  operation_id?: string | null;
  /** Presente apenas depois da migration de ciclo de vida (2.1.3). */
  entry_kind?: string | null;
  idempotency_key?: string | null;
  dedupe_key?: string | null;
  last_error?: string | null;
  last_attempt_at?: string | null;
};

/** `true` quando o erro é só a coluna `operation_id` ainda não existir. */
function isMissingOperationColumn(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): boolean {
  const code = String(error.code ?? "").toUpperCase();
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  if (!text.includes("operation_id")) return false;
  return code === "42703" || code === "PGRST204" || /column|coluna|does not exist/.test(text);
}

/**
 * `true` quando as colunas de ciclo de vida da 2.1.3 ainda não existem.
 *
 * F-06A: nesse caso o reembolso NÃO pode degradar em silêncio (sem dedupe,
 * sem chave estável). Quem chama devolve 503 e nada é enviado ao provedor.
 */
function isMissingLifecycleColumn(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): boolean {
  const code = String(error.code ?? "").toUpperCase();
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  const names = ["idempotency_key", "dedupe_key", "entry_kind", "last_error", "last_attempt_at"];
  if (!names.some((name) => text.includes(name))) return false;
  return code === "42703" || code === "PGRST204" || /column|coluna|does not exist/.test(text);
}

/** Identifica qual índice único foi violado (para reconciliar sem repetir). */
function uniqueConflict(error: {
  message?: string | null;
  details?: string | null;
}): "provider_refund_id" | "pending" | "operation" | null {
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  if (text.includes("provider_refund") || text.includes("payment_refunds_provider_refund_key")) {
    return "provider_refund_id";
  }
  if (text.includes("dedupe_key") || text.includes("pending_guard")) return "pending";
  if (text.includes("operation_id") || text.includes("operation")) return "operation";
  return null;
}

/** Todos os reembolsos da transação (base da contabilidade — R-01). */
export async function listRefunds(transactionId: string): Promise<RefundRow[]> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("payment_refunds")
    .select("*")
    .eq("transaction_id", transactionId)
    .order("created_at");
  if (error) {
    console.error("[payments] listRefunds", error.message);
    return [];
  }
  return (data as RefundRow[] | null) ?? [];
}

/**
 * Reembolso já registrado para a MESMA operação (retry seguro).
 *
 * Degrada para `null` quando a migration ainda não foi aplicada — nesse caso a
 * proteção contra duplicidade continua no provedor (chave por operação) e no
 * dedupe por `provider_refund_id`.
 */
export async function findRefundByOperation(
  transactionId: string,
  operationId: string,
): Promise<RefundRow | null> {
  const id = String(operationId ?? "").trim().toLowerCase();
  if (!transactionId || !id) return null;
  const admin = adminClient();
  const { data, error } = await admin
    .from("payment_refunds")
    .select("*")
    .eq("transaction_id", transactionId)
    .eq("operation_id", id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) {
    if (!isMissingOperationColumn(error)) {
      console.error("[payments] findRefundByOperation", error.message);
    }
    return null;
  }
  return (data as RefundRow | null) ?? null;
}

/**
 * Reserva a operação antes de chamar o provedor.
 *
 * A linha nasce `pending`: se o processo cair no meio (timeout, deploy), o
 * retry encontra a mesma operação e reusa a chave — nunca cria um segundo
 * reembolso.
 */
export async function claimRefundOperation(input: {
  transactionId: string;
  catalogId: string;
  provider: PaymentProviderKey;
  amount: number;
  reason: string | null;
  requestedBy: string | null;
  operationId: string;
  /** Chave de idempotência do provedor — persistida ANTES da chamada (F-01). */
  idempotencyKey?: string | null;
  /** `transaction_id` enquanto pendente: garante UMA pendência por transação. */
  dedupeKey?: string | null;
}): Promise<{
  row: RefundRow | null;
  created: boolean;
  code?: "operation_exists" | "pending_exists" | "schema_missing" | "error";
  error?: string;
}> {
  const admin = adminClient();
  const base = {
    transaction_id: input.transactionId,
    catalog_id: input.catalogId,
    provider: input.provider,
    provider_refund_id: null,
    amount: input.amount,
    status: "pending",
    reason: input.reason,
    requested_by: input.requestedBy,
    entry_kind: "operation",
  };

  const inserted = await admin
    .from("payment_refunds")
    .insert({
      ...base,
      operation_id: input.operationId,
      idempotency_key: input.idempotencyKey ?? null,
      dedupe_key: input.dedupeKey ?? null,
    })
    .select("*")
    .maybeSingle();

  if (!inserted.error) {
    return { row: (inserted.data as RefundRow | null) ?? null, created: true };
  }

  // Migration ausente: falha FECHADA. Antes o código seguia sem operation_id e
  // sem dedupe — exatamente a janela em que o reembolso podia duplicar.
  if (
    isMissingLifecycleColumn(inserted.error) ||
    isMissingOperationColumn(inserted.error)
  ) {
    console.error("[payments] claimRefundOperation schema", inserted.error.message);
    return {
      row: null,
      created: false,
      code: "schema_missing",
      error: inserted.error.message,
    };
  }

  if (String(inserted.error.code ?? "") === "23505") {
    const conflict = uniqueConflict(inserted.error);
    if (conflict === "pending") {
      const pending = await listPendingRefunds(input.transactionId);
      const row =
        pending.find((candidate) => candidate.entry_kind !== "snapshot") ?? pending[0] ?? null;
      return { row, created: false, code: "pending_exists" };
    }
    const existing = await findRefundByOperation(input.transactionId, input.operationId);
    return { row: existing, created: false, code: "operation_exists" };
  }

  console.error("[payments] claimRefundOperation", inserted.error.message);
  return {
    row: null,
    created: false,
    code: "error",
    error: inserted.error.message,
  };
}

/** Reembolso já registrado para o mesmo id do provedor (idempotência). */
export async function findRefundByProviderId(
  provider: PaymentProviderKey,
  providerRefundId: string,
): Promise<RefundRow | null> {
  const id = String(providerRefundId ?? "").trim();
  if (!id) return null;
  const admin = adminClient();
  const { data } = await admin
    .from("payment_refunds")
    .select("*")
    .eq("provider", provider)
    .eq("provider_refund_id", id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return (data as RefundRow | null) ?? null;
}

/** Reembolsos ainda não confirmados pelo provedor. */
export async function listPendingRefunds(transactionId: string): Promise<RefundRow[]> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("payment_refunds")
    .select("*")
    .eq("transaction_id", transactionId)
    .eq("status", "pending")
    .order("created_at");
  if (error) {
    console.error("[payments] listPendingRefunds", error.message);
    return [];
  }
  return (data as RefundRow[] | null) ?? [];
}

/**
 * Pendências de um catálogo — usadas pelo painel para retomar a MESMA operação
 * depois de reload/logout (F-01), sem depender do estado do navegador.
 */
export async function listPendingRefundsForCatalog(catalogId: string): Promise<RefundRow[]> {
  if (!catalogId) return [];
  const admin = adminClient();
  const { data, error } = await admin
    .from("payment_refunds")
    .select("*")
    .eq("catalog_id", catalogId)
    .eq("status", "pending")
    .order("created_at")
    .limit(200);
  if (error) {
    console.error("[payments] listPendingRefundsForCatalog", error.message);
    return [];
  }
  return (data as RefundRow[] | null) ?? [];
}

export type RefundUpdateResult = {
  ok: boolean;
  error?: string;
  conflict?: "provider_refund_id" | "pending" | "operation" | "schema_missing";
};

/**
 * Atualiza a linha do reembolso e DEVOLVE o resultado.
 *
 * F-03/F-06A: antes o erro era ignorado — a linha ficava `pending` para sempre
 * e o painel mostrava sucesso. `clearDedupeKey` libera a guarda de ambiguidade
 * quando a operação deixa de estar pendente.
 */
export async function updateRefundRecord(
  refundId: string,
  input: {
    status?: string;
    providerRefundId?: string | null;
    amount?: number;
    idempotencyKey?: string | null;
    clearDedupeKey?: boolean;
    lastError?: string | null;
    lastAttemptAt?: string | null;
  },
): Promise<RefundUpdateResult> {
  const admin = adminClient();
  const patch: Record<string, unknown> = {
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.providerRefundId === undefined
      ? {}
      : { provider_refund_id: input.providerRefundId }),
    ...(input.amount === undefined ? {} : { amount: input.amount }),
    ...(input.idempotencyKey === undefined ? {} : { idempotency_key: input.idempotencyKey }),
    ...(input.clearDedupeKey ? { dedupe_key: null } : {}),
    ...(input.lastError === undefined ? {} : { last_error: input.lastError }),
    ...(input.lastAttemptAt === undefined ? {} : { last_attempt_at: input.lastAttemptAt }),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("payment_refunds").update(patch).eq("id", refundId);
  if (error) {
    if (isMissingLifecycleColumn(error)) {
      return { ok: false, conflict: "schema_missing", error: error.message };
    }
    if (String(error.code ?? "") === "23505") {
      return {
        ok: false,
        conflict: uniqueConflict(error) ?? "operation",
        error: error.message,
      };
    }
    console.error("[payments] updateRefundRecord", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
