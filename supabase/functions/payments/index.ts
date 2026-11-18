/**
 * Router de pagamentos da Etapa 2.
 *
 * Ações públicas (comprador):
 *   GET  ?action=methods&slug=...            → métodos habilitados na loja
 *   POST ?action=create_order                → cria pedido com preços oficiais
 *   POST ?action=create_payment              → inicia PayPal / Mercado Pago
 *   GET  ?action=payment_status&order_id&token → status financeiro do pedido
 *
 * Ações do vendedor (JWT obrigatório):
 *   GET  ?action=status&catalog_id=...
 *   POST ?action=connect | disconnect | verify | set_enabled
 *   GET  ?action=transactions&catalog_id=...
 *   POST ?action=refund | refresh_payment
 */
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  adminClient,
  claimRefundOperation,
  consumeCheckoutSession,
  createTransaction,
  deleteConnection,
  findActiveTransactionByOrder,
  findRefundByOperation,
  findRefundByProviderId,
  findTransactionByOrder,
  getCatalog,
  getConnection,
  getOwnedCatalog,
  listRefunds,
  markConnectionState,
  saveOAuthState,
  syncOrderPayment,
  updateRefundRecord,
  updateTransaction,
  validateCheckoutSession,
  verifyUser,
  type TransactionRow,
} from "../_shared/payments/db.ts";
import {
  buildConnectionView,
  listPublicPaymentMethods,
  loadCredentials,
} from "../_shared/payments/connections.ts";
import {
  getProvider,
  isProviderKey,
  providerEnvironment,
  PROVIDER_KEYS,
} from "../_shared/payments/index.ts";
import { signState, encryptionConfigured, readEnv } from "../_shared/payments/crypto.ts";
import { checkCurrencySupport } from "../_shared/payments/currencies.ts";
import { createSecureOrder } from "../_shared/payments/orders.ts";
import { applyOfficialSnapshot } from "../_shared/payments/webhooks.ts";
import { clientFingerprint, enforceRateLimit } from "../_shared/payments/ratelimit.ts";
import {
  blocksNewCharge,
  paymentAttemptDecision,
  providerLookupId,
} from "../_shared/payments/lifecycle.ts";
import {
  computeRefundState,
  newRefundOperationId,
  normalizeRefundOperationId,
  planRefund,
  reconcilePendingRefunds,
  refundProviderKey,
  type RefundState,
} from "../_shared/payments/refunds.ts";
import { resolveStoreCurrency, toMinorUnits } from "../../../src/lib/currency.ts";
import type {
  PaymentProvider,
  PaymentProviderKey,
  ProviderCredentials,
  RefundResult,
} from "../_shared/payments/types.ts";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonRes(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extraHeaders },
  });
}

/**
 * Limites por ação pública (auditoria A6).
 *
 * O checkout continua funcionando em pico: os limites são por cliente e por
 * janela, e `create_payment` só é atingido por tentativa repetida.
 */
const PUBLIC_RATE_LIMITS: Record<string, { windowMs: number; max: number }> = {
  methods: { windowMs: 60_000, max: 120 },
  create_order: { windowMs: 10 * 60_000, max: 30 },
  create_payment: { windowMs: 10 * 60_000, max: 20 },
  payment_status: { windowMs: 60_000, max: 120 },
};

function stateExpiryMs(): number {
  return 15 * 60 * 1000;
}

function callbackUrl(): string {
  const base = readEnv("SUPABASE_URL") ?? "https://wdcufpvlbisnqtvmbyso.supabase.co";
  return `${base}/functions/v1/payments-callback`;
}

function allowedOrigin(): string {
  return (
    readEnv("VITRINE_URL") ??
    readEnv("PAYMENTS_RETURN_ORIGIN") ??
    "https://vitrine.meellcriativa.workers.dev"
  ).replace(/\/+$/, "");
}

function safeReturnUrl(candidate: string | null | undefined, fallback: string): string {
  const origin = allowedOrigin();
  if (!candidate) return fallback;
  try {
    // Compara a origem exata: `startsWith` aceitaria `vitrine...workers.dev.evil.com`.
    return new URL(candidate).origin === origin ? candidate : fallback;
  } catch {
    return fallback;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "status";
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const user = await verifyUser(req);

    const publicActions = ["methods", "create_order", "create_payment", "payment_status"];
    if (publicActions.includes(action)) {
      const limit = PUBLIC_RATE_LIMITS[action];
      if (limit) {
        const decision = await enforceRateLimit({
          bucket: `${action}:${clientFingerprint(req)}`,
          windowMs: limit.windowMs,
          max: limit.max,
        });
        if (!decision.allowed) {
          const retrySeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
          return jsonRes(
            {
              success: false,
              error: "Muitas tentativas em pouco tempo. Aguarde alguns instantes.",
              code: "rate_limited",
            },
            429,
            { "Retry-After": String(retrySeconds) },
          );
        }
      }
      return await handlePublic(action, { req, url, body });
    }
    if (!user) return jsonRes({ success: false, error: "Unauthorized" }, 401);
    return await handleOwner(action, { req, url, body, userId: user.id });
  } catch (error) {
    console.error("[payments]", error);
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Erro interno.";
    return jsonRes(
      { success: false, error: status >= 500 ? "Erro interno. Tente novamente." : message },
      status,
    );
  }
});

type PublicCtx = { req: Request; url: URL; body: Record<string, unknown> };
type OwnerCtx = PublicCtx & { userId: string };

async function handlePublic(action: string, ctx: PublicCtx): Promise<Response> {
  switch (action) {
    case "methods":
      return methodsAction(ctx);
    case "create_order":
      return createOrderAction(ctx);
    case "create_payment":
      return createPaymentAction(ctx);
    case "payment_status":
      return paymentStatusAction(ctx);
    default:
      return jsonRes({ success: false, error: "Ação desconhecida." }, 400);
  }
}

async function handleOwner(action: string, ctx: OwnerCtx): Promise<Response> {
  switch (action) {
    case "status":
      return statusAction(ctx);
    case "connect":
      return connectAction(ctx);
    case "disconnect":
      return disconnectAction(ctx);
    case "verify":
      return verifyAction(ctx);
    case "set_enabled":
      return setEnabledAction(ctx);
    case "transactions":
      return transactionsAction(ctx);
    case "refund":
      return refundAction(ctx);
    case "refresh_payment":
      return refreshPaymentAction(ctx);
    default:
      return jsonRes({ success: false, error: "Ação desconhecida." }, 400);
  }
}

function readCatalogId(ctx: PublicCtx): string {
  return String(ctx.url.searchParams.get("catalog_id") ?? ctx.body.catalog_id ?? "");
}

function readProvider(ctx: PublicCtx): PaymentProviderKey {
  const value = String(ctx.url.searchParams.get("provider") ?? ctx.body.provider ?? "");
  if (!isProviderKey(value)) throw new HttpError(400, "Provedor de pagamento inválido.");
  return value;
}

/* ── Comprador ───────────────────────────────────────────────────────────── */

async function methodsAction(ctx: PublicCtx): Promise<Response> {
  const slug = String(ctx.url.searchParams.get("slug") ?? ctx.body.slug ?? "").trim();
  const catalogId = readCatalogId(ctx);

  let catalog = catalogId ? await getCatalog(catalogId) : null;
  if (!catalog && slug) {
    const admin = adminClient();
    const { data } = await admin
      .from("catalogs")
      .select("id, user_id, slug, store_name, whatsapp, currency, payment_methods, delivery_methods, shipping_origin_zip")
      .eq("slug", slug)
      .maybeSingle();
    catalog = (data as typeof catalog) ?? null;
  }
  if (!catalog) throw new HttpError(404, "Loja não encontrada.");

  const currency = resolveStoreCurrency(catalog.currency);
  const methods = await listPublicPaymentMethods(catalog.id, currency);
  return jsonRes({ success: true, catalog_id: catalog.id, currency, methods });
}

async function createOrderAction(ctx: PublicCtx): Promise<Response> {
  const catalogId = readCatalogId(ctx);
  if (!catalogId) throw new HttpError(400, "catalog_id é obrigatório.");

  const result = await createSecureOrder({
    catalogId,
    customerName: String(ctx.body.customer_name ?? ""),
    customerPhone: (ctx.body.customer_phone as string) ?? null,
    note: (ctx.body.note as string) ?? null,
    items: Array.isArray(ctx.body.items) ? (ctx.body.items as never) : [],
    deliveryMethod: (ctx.body.delivery_method as string) ?? null,
    shippingZip: (ctx.body.shipping_zip as string) ?? null,
    shippingService: (ctx.body.shipping_service as string) ?? null,
    address: (ctx.body.address as never) ?? null,
  });

  if (!result.ok) {
    return jsonRes(
      { success: false, error: result.error, code: result.code },
      result.status,
    );
  }

  const methods = await listPublicPaymentMethods(result.catalog.id, result.currency);

  return jsonRes({
    success: true,
    order_id: result.orderId,
    checkout_token: result.checkoutToken,
    currency: result.currency,
    subtotal: result.subtotal,
    shipping_cost: result.shippingCost,
    total: result.total,
    items: result.items,
    store: result.catalog,
    payment_methods: methods,
  });
}

async function createPaymentAction(ctx: PublicCtx): Promise<Response> {
  const orderId = String(ctx.body.order_id ?? "").trim();
  const token = String(ctx.body.checkout_token ?? "").trim();
  const provider = readProvider(ctx);
  if (!orderId) throw new HttpError(400, "order_id é obrigatório.");

  const session = await validateCheckoutSession(orderId, token);
  if (!session.ok) throw new HttpError(403, session.reason ?? "Sessão de checkout inválida.");

  const admin = adminClient();
  const { data: orderData } = await admin
    .from("orders")
    .select("id, catalog_id, total, subtotal, shipping_cost, currency, payment_status, payment_provider, items, customer_name")
    .eq("id", orderId)
    .maybeSingle();
  if (!orderData) throw new HttpError(404, "Pedido não encontrado.");

  const order = orderData as {
    id: string;
    catalog_id: string;
    total: number;
    subtotal: number | null;
    shipping_cost: number | null;
    currency: string | null;
    payment_status: string;
    payment_provider: string | null;
    items: Array<{ name: string; quantity: number; unitPrice: number }>;
    customer_name: string;
  };

  // ── Nenhuma cobrança nova para pedido já pago/reembolsado (R-03) ────────
  // `partially_refunded` estava fora da lista: um pedido pago e parcialmente
  // reembolsado aceitava uma nova cobrança cheia.
  if (blocksNewCharge(order.payment_status)) {
    throw new HttpError(
      409,
      "Este pedido já possui pagamento aprovado ou reembolsado e não pode ser cobrado novamente.",
    );
  }

  const catalog = await getCatalog(order.catalog_id);
  if (!catalog) throw new HttpError(404, "Loja não encontrada.");
  const currency = resolveStoreCurrency(order.currency ?? catalog.currency);

  const providerImpl = getProvider(provider);
  if (!providerImpl) throw new HttpError(400, "Provedor de pagamento inválido.");
  if (!providerImpl.isConfigured()) {
    throw new HttpError(503, providerImpl.setupMessage() ?? "Provedor não configurado.");
  }

  const connection = await getConnection(catalog.id, provider);
  if (!connection?.connected || connection.status !== "connected" || !connection.enabled) {
    throw new HttpError(409, "Este método de pagamento não está disponível nesta loja.");
  }

  const capabilities = (connection.capabilities ?? {}) as Record<string, unknown>;
  const support = checkCurrencySupport(provider, {
    currency,
    accountSiteId: (capabilities.site_id as string | null) ?? null,
    accountPrimaryCurrency: (capabilities.primary_currency as string | null) ?? null,
  });
  if (!support.supported) throw new HttpError(409, support.reason);

  const loaded = await loadCredentials(catalog.id, provider);
  if (!loaded.credentials) {
    throw new HttpError(
      409,
      loaded.reason ?? "A conexão do vendedor com o provedor precisa ser refeita.",
    );
  }

  const orderTotal = Number(order.total ?? 0);
  if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
    throw new HttpError(400, "Pedido sem valor válido para pagamento.");
  }

  // ── Uma única cobrança ativa por pedido (auditoria A4) ──────────────────
  const active = await findActiveTransactionByOrder(order.id, provider);
  const attempt = paymentAttemptDecision({
    hasValidToken: true,
    sessionConsumed: !!session.consumed,
    hasActiveTransaction: !!active,
  });
  if (attempt === "reject_consumed") {
    throw new HttpError(409, "Esta sessão de checkout já foi utilizada. Refaça o pedido.");
  }
  if (attempt === "reuse" && active) {
    if (active.checkout_url) {
      // R-03: a sessão precisa estar consumida (por esta tentativa ou pela que
      // criou a cobrança). Sem consumo comprovado, nenhum link é liberado.
      if (!session.consumed) {
        const consumed = await consumeCheckoutSession(order.id, token);
        if (!consumed.ok) {
          console.error("[payments] sessão não consumida (reuso):", consumed.reason);
          throw new HttpError(
            503,
            "Não foi possível liberar o pagamento com segurança. Refaça o pedido.",
          );
        }
      }
      return jsonRes({
        success: true,
        provider,
        checkout_url: active.checkout_url,
        transaction_id: active.id,
        status: active.status,
        currency: active.currency,
        total: Number(active.amount),
        reused: true,
      });
    }
    throw new HttpError(409, "Já existe um pagamento em andamento para este pedido.");
  }

  // Cobrança viva em OUTRO provedor também bloqueia: o pedido não pode ser
  // pago duas vezes (um link do Mercado Pago e um do PayPal ao mesmo tempo).
  const activeOther = await findActiveTransactionByOrder(order.id, null);
  if (activeOther) {
    throw new HttpError(
      409,
      "Este pedido já tem um pagamento em andamento. Conclua ou aguarde a expiração antes de tentar outro método.",
    );
  }

  const fallbackReturn = `${allowedOrigin()}/c/${catalog.slug}?payment=return&order=${order.id}`;
  const returnUrl = safeReturnUrl(ctx.body.return_url as string, fallbackReturn);
  const cancelUrl = safeReturnUrl(ctx.body.cancel_url as string, fallbackReturn);

  // Frete oficial do pedido: vai cobrado junto com os itens (auditoria C3).
  const shippingAmount = Math.max(0, Number(order.shipping_cost ?? 0));
  const sourceItems = Array.isArray(order.items) ? order.items : [];
  const items = sourceItems.length > 0
    ? sourceItems.map((item) => ({
        name: String(item.name ?? "Item"),
        quantity: Number(item.quantity ?? 1),
        unitPrice: Number(item.unitPrice ?? 0),
      }))
    : [{
        name: `Pedido ${order.id.slice(0, 8)}`,
        quantity: 1,
        unitPrice: Math.max(0, orderTotal - shippingAmount),
      }];

  const result = await providerImpl.createPayment(loaded.credentials, {
    catalogId: catalog.id,
    orderId: order.id,
    amount: orderTotal,
    currency,
    description: `Pedido ${order.id.slice(0, 8)} — ${catalog.store_name}`,
    items,
    shippingAmount,
    returnUrl,
    cancelUrl,
    externalReference: order.id,
    buyerEmail: null,
  });

  if (!result.checkoutUrl) {
    throw new HttpError(502, "O provedor não retornou a URL de pagamento.");
  }

  // ── Token de checkout é de uso único (auditoria A3 / R-03) ──────────────
  // O consumo acontece ANTES de registrar a transação: sem consumo comprovado
  // nenhuma cobrança é criada nem liberada. Falha aqui é fatal (503) — antes
  // era apenas um aviso e o link seguia sendo devolvido.
  const consumed = await consumeCheckoutSession(order.id, token);
  if (!consumed.ok) {
    console.error("[payments] sessão não consumida:", consumed.reason);
    throw new HttpError(
      503,
      "Não foi possível liberar o pagamento com segurança. Refaça o pedido.",
    );
  }

  const transaction = await createTransaction({
    catalogId: catalog.id,
    orderId: order.id,
    provider,
    environment: providerEnvironment(provider),
    providerOrderId: result.providerOrderId,
    providerPaymentId: result.providerPaymentId,
    status: result.status,
    currency,
    amount: orderTotal,
    amountMinor: toMinorUnits(orderTotal, currency),
    checkoutUrl: result.checkoutUrl,
    providerStatus: result.providerStatus,
    metadata: { source: "checkout", order_total_minor: toMinorUnits(orderTotal, currency) },
  });

  if (!transaction) {
    // Corrida perdida: outro clique registrou a transação entre a consulta e o
    // INSERT (índice único de transação ativa por pedido). Devolve a que existe.
    const raced = await findActiveTransactionByOrder(order.id, null);
    if (raced?.checkout_url) {
      return jsonRes({
        success: true,
        provider: raced.provider,
        checkout_url: raced.checkout_url,
        transaction_id: raced.id,
        status: raced.status,
        currency: raced.currency,
        total: Number(raced.amount),
        reused: true,
      });
    }
    throw new HttpError(409, "Já existe um pagamento em andamento para este pedido.");
  }

  await admin
    .from("orders")
    .update({ payment_provider: provider, payment_status: "pending" })
    .eq("id", order.id);

  return jsonRes({
    success: true,
    provider,
    checkout_url: result.checkoutUrl,
    transaction_id: transaction?.id ?? null,
    status: result.status,
    currency,
    total: orderTotal,
  });
}

async function paymentStatusAction(ctx: PublicCtx): Promise<Response> {
  const orderId = String(ctx.url.searchParams.get("order_id") ?? ctx.body.order_id ?? "").trim();
  const token = String(ctx.url.searchParams.get("token") ?? ctx.body.checkout_token ?? "").trim();
  if (!orderId) throw new HttpError(400, "order_id é obrigatório.");

  // O token consumido continua servindo para CONSULTAR (o pagamento já foi
  // iniciado); ele não serve mais para criar outra cobrança.
  const session = await validateCheckoutSession(orderId, token, { allowConsumed: true });
  if (!session.ok) throw new HttpError(403, session.reason ?? "Sessão inválida.");

  const admin = adminClient();
  const { data } = await admin
    .from("orders")
    .select("id, total, subtotal, currency, payment_status, payment_provider")
    .eq("id", orderId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Pedido não encontrado.");

  const provider = isProviderKey(data.payment_provider) ? data.payment_provider : null;
  let transaction: TransactionRow | null = null;
  if (provider) {
    transaction =
      (await findActiveTransactionByOrder(orderId, provider)) ??
      (await findTransactionByOrder(orderId, provider));
  }

  // ── Confirmação no retorno do comprador (auditoria M6) ─────────────────
  // `refresh=1` faz uma consulta oficial sob demanda: o comprador que volta do
  // provedor vê o estado real, sem esperar o webhook.
  const wantsRefresh =
    ctx.url.searchParams.get("refresh") === "1" || ctx.body.refresh === true;
  let status = String(data.payment_status ?? "pending");
  let captured = false;
  if (wantsRefresh && transaction && provider) {
    const providerPaymentId = providerLookupId({
      provider,
      providerPaymentId: transaction.provider_payment_id,
      providerOrderId: transaction.provider_order_id,
    });
    if (providerPaymentId) {
      const applied = await applyOfficialSnapshot({
        provider,
        transaction,
        providerPaymentId,
        captureIfAuthorized: true,
      });
      if (applied.ok && applied.snapshot) {
        status = applied.snapshot.status;
        captured = applied.captured ?? false;
      }
    }
  }

  return jsonRes({
    success: true,
    order_id: data.id,
    total: Number(data.total ?? 0),
    currency: resolveStoreCurrency(data.currency as string | null),
    payment_status: status,
    payment_provider: data.payment_provider,
    transaction_id: transaction?.id ?? null,
    captured,
    settled: ["captured", "approved", "refunded", "partially_refunded", "disputed"].includes(
      status,
    ),
    failed: ["failed", "cancelled"].includes(status),
  });
}

/* ── Vendedor ────────────────────────────────────────────────────────────── */

async function statusAction(ctx: OwnerCtx): Promise<Response> {
  const catalogId = readCatalogId(ctx);
  if (!catalogId) throw new HttpError(400, "catalog_id é obrigatório.");
  const catalog = await getOwnedCatalog(ctx.userId, catalogId);
  if (!catalog) throw new HttpError(404, "Catálogo não encontrado.");

  const currency = resolveStoreCurrency(catalog.currency);
  const providers = [];
  for (const provider of PROVIDER_KEYS) {
    providers.push(await buildConnectionView(catalog.id, provider, currency));
  }

  return jsonRes({
    success: true,
    currency,
    encryption_configured: encryptionConfigured(),
    environment: providerEnvironment("mercadopago"),
    providers,
  });
}

async function connectAction(ctx: OwnerCtx): Promise<Response> {
  const catalogId = readCatalogId(ctx);
  const provider = readProvider(ctx);
  const catalog = await getOwnedCatalog(ctx.userId, catalogId);
  if (!catalog) throw new HttpError(404, "Catálogo não encontrado.");
  if (!encryptionConfigured()) {
    throw new HttpError(
      503,
      "A plataforma ainda não configurou a criptografia dos tokens de pagamento.",
    );
  }
  const providerImpl = getProvider(provider)!;
  if (!providerImpl.isConfigured()) {
    throw new HttpError(503, providerImpl.setupMessage() ?? "Provedor não configurado.");
  }

  // Nonce de uso único (auditoria M8): o `state` continua assinado e expirando,
  // mas agora também precisa existir e estar livre em `payment_oauth_states`.
  const nonce = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + stateExpiryMs()).toISOString();
  const state = await signState({
    catalog_id: catalog.id,
    user_id: ctx.userId,
    provider,
    env: providerEnvironment(provider),
    nonce,
    exp: Date.now() + stateExpiryMs(),
  });
  if (!state) throw new HttpError(503, "Não foi possível assinar a autorização (state).");
  await saveOAuthState({
    nonce,
    catalogId: catalog.id,
    provider,
    userId: ctx.userId,
    expiresAt,
  });

  const authorizeUrl = await providerImpl.buildAuthorizeUrl({
    state,
    redirectUri: callbackUrl(),
    trackingId: `${catalog.id}-${Date.now()}`,
  });

  return jsonRes({ success: true, url: authorizeUrl, provider });
}

async function disconnectAction(ctx: OwnerCtx): Promise<Response> {
  const catalogId = readCatalogId(ctx);
  const provider = readProvider(ctx);
  const catalog = await getOwnedCatalog(ctx.userId, catalogId);
  if (!catalog) throw new HttpError(404, "Catálogo não encontrado.");

  const loaded = await loadCredentials(catalog.id, provider);
  if (loaded.credentials) {
    await getProvider(provider)!.revoke(loaded.credentials);
  }
  await deleteConnection(catalog.id, provider);
  return jsonRes({ success: true });
}

async function verifyAction(ctx: OwnerCtx): Promise<Response> {
  const catalogId = readCatalogId(ctx);
  const provider = readProvider(ctx);
  const catalog = await getOwnedCatalog(ctx.userId, catalogId);
  if (!catalog) throw new HttpError(404, "Catálogo não encontrado.");

  const loaded = await loadCredentials(catalog.id, provider);
  if (!loaded.credentials) {
    throw new HttpError(409, loaded.reason ?? "Nenhuma conexão válida encontrada.");
  }
  const providerImpl = getProvider(provider)!;
  const result = await providerImpl.verifyConnection(loaded.credentials);
  const admin = adminClient();

  if (!result.ok) {
    await markConnectionState({
      catalogId: catalog.id,
      provider,
      status: "expired",
      connected: false,
      enabled: false,
    });
    return jsonRes({
      success: false,
      verified: false,
      error: result.reason ?? "A conexão não pôde ser verificada.",
    }, 409);
  }

  await admin
    .from("payment_connections")
    .update({
      external_account_id: result.externalAccountId,
      external_account_label: result.externalAccountLabel,
      merchant_id: result.merchantId,
      capabilities: result.capabilities,
      last_verified_at: new Date().toISOString(),
      status: "connected",
      connected: true,
      updated_at: new Date().toISOString(),
    })
    .eq("catalog_id", catalog.id)
    .eq("provider", provider);

  const view = await buildConnectionView(
    catalog.id,
    provider,
    resolveStoreCurrency(catalog.currency),
  );
  return jsonRes({ success: true, verified: true, connection: view });
}

async function setEnabledAction(ctx: OwnerCtx): Promise<Response> {
  const catalogId = readCatalogId(ctx);
  const provider = readProvider(ctx);
  const enabled = ctx.body.enabled === true;
  const catalog = await getOwnedCatalog(ctx.userId, catalogId);
  if (!catalog) throw new HttpError(404, "Catálogo não encontrado.");

  if (enabled) {
    const connection = await getConnection(catalog.id, provider);
    if (!connection?.connected || connection.status !== "connected") {
      throw new HttpError(409, "Conecte o provedor antes de habilitá-lo no checkout.");
    }
    const currency = resolveStoreCurrency(catalog.currency);
    const capabilities = (connection.capabilities ?? {}) as Record<string, unknown>;
    const support = checkCurrencySupport(provider, {
      currency,
      accountSiteId: (capabilities.site_id as string | null) ?? null,
      accountPrimaryCurrency: (capabilities.primary_currency as string | null) ?? null,
    });
    if (!support.supported) throw new HttpError(409, support.reason);
  }

  const admin = adminClient();
  await admin
    .from("payment_connections")
    .update({ enabled, updated_at: new Date().toISOString() })
    .eq("catalog_id", catalog.id)
    .eq("provider", provider);

  const view = await buildConnectionView(
    catalog.id,
    provider,
    resolveStoreCurrency(catalog.currency),
  );
  return jsonRes({ success: true, connection: view });
}

async function transactionsAction(ctx: OwnerCtx): Promise<Response> {
  const catalogId = readCatalogId(ctx);
  const catalog = await getOwnedCatalog(ctx.userId, catalogId);
  if (!catalog) throw new HttpError(404, "Catálogo não encontrado.");

  const admin = adminClient();
  const { data } = await admin
    .from("payment_transactions")
    .select("id, order_id, provider, status, currency, amount, captured_amount, refunded_amount, provider_payment_id, created_at, updated_at")
    .eq("catalog_id", catalog.id)
    .order("created_at", { ascending: false })
    .limit(100);

  return jsonRes({
    success: true,
    transactions: (data ?? []).map((row: Record<string, any>) => ({
      id: row.id,
      order_id: row.order_id,
      provider: row.provider,
      status: row.status,
      currency: row.currency,
      amount: Number(row.amount ?? 0),
      captured_amount: Number(row.captured_amount ?? 0),
      refunded_amount: Number(row.refunded_amount ?? 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  });
}

async function loadOwnedTransaction(
  userId: string,
  transactionId: string,
): Promise<{ transaction: TransactionRow; catalogId: string; provider: PaymentProviderKey }> {
  const admin = adminClient();
  const { data } = await admin
    .from("payment_transactions")
    .select("*")
    .eq("id", transactionId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Transação não encontrada.");
  const transaction = data as TransactionRow;
  const catalog = await getOwnedCatalog(userId, transaction.catalog_id);
  if (!catalog) throw new HttpError(404, "Transação não encontrada.");
  return { transaction, catalogId: catalog.id, provider: transaction.provider };
}

/**
 * Consulta o total reembolsado oficial (best-effort).
 *
 * Nunca é fonte de inflação: o valor entra como complemento do ledger e é
 * limitado ao total da transação em `computeRefundState`.
 */
async function readOfficialRefunded(input: {
  providerImpl: PaymentProvider;
  credentials: ProviderCredentials;
  provider: PaymentProviderKey;
  transaction: TransactionRow;
  providerPaymentId: string;
}): Promise<number | null> {
  try {
    // O PayPal expõe o reembolso na ORDEM (a captura não traz o total parcial).
    const lookupId =
      input.provider === "paypal" && input.transaction.provider_order_id
        ? input.transaction.provider_order_id
        : input.providerPaymentId;
    const snapshot = await input.providerImpl.getPayment(input.credentials, lookupId);
    if (!snapshot) return null;
    const value = Number(snapshot.refundedAmount ?? 0);
    return Number.isFinite(value) ? value : null;
  } catch (error) {
    console.error(
      "[payments] refund snapshot",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/** Persiste o estado consolidado (só escreve quando algo realmente mudou). */
async function persistRefundState(input: {
  transaction: TransactionRow;
  provider: PaymentProviderKey;
  state: RefundState;
}): Promise<void> {
  const before = Number(input.transaction.refunded_amount ?? 0);
  const changed =
    Math.abs(before - input.state.refundedAmount) > 1e-9 ||
    input.transaction.status !== input.state.status;
  if (!changed) return;

  await updateTransaction({
    transactionId: input.transaction.id,
    status: input.state.status,
    providerStatus: input.transaction.provider_status,
    refundedAmount: input.state.refundedAmount,
  });
  await syncOrderPayment({
    orderId: input.transaction.order_id,
    provider: input.provider,
    status: input.state.status,
    transactionId: input.transaction.id,
  });
}

/**
 * Reembolso (total ou parcial) — corrigido pela auditoria 2.1 (R-01/R-02).
 *
 * Fluxo:
 *  1. cada chamada carrega um `operation_id` (UUID do painel, ou gerado aqui);
 *  2. a operação é reservada no banco como `pending` ANTES do provedor;
 *  3. a chave de idempotência do provedor deriva da OPERAÇÃO (nunca do valor);
 *  4. o saldo é recalculado a partir do ledger aprovado, com a moeda real;
 *  5. resposta repetida do provedor/retry não soma nada de novo.
 */
async function refundAction(ctx: OwnerCtx): Promise<Response> {
  const transactionId = String(ctx.body.transaction_id ?? "").trim();
  if (!transactionId) throw new HttpError(400, "transaction_id é obrigatório.");

  const { transaction, catalogId, provider } = await loadOwnedTransaction(
    ctx.userId,
    transactionId,
  );

  if (!["captured", "approved", "partially_refunded"].includes(transaction.status)) {
    throw new HttpError(409, "Somente pagamentos capturados podem ser reembolsados.");
  }

  const providerPaymentId = String(transaction.provider_payment_id ?? "").trim();
  if (!providerPaymentId) {
    throw new HttpError(409, "Pagamento ainda não identificado no provedor.");
  }

  // ── Identificador da operação (R-01) ───────────────────────────────────
  // O painel envia o mesmo id em retries; operações distintas (mesmo valor)
  // recebem ids distintos.
  const rawOperationId = ctx.body.operation_id;
  const trimmedOperationId =
    rawOperationId === undefined || rawOperationId === null
      ? ""
      : String(rawOperationId).trim();
  const providedOperationId = normalizeRefundOperationId(rawOperationId);
  if (trimmedOperationId && !providedOperationId) {
    throw new HttpError(400, "operation_id inválido.");
  }
  const operationId = providedOperationId ?? newRefundOperationId();

  const reason = typeof ctx.body.reason === "string" ? ctx.body.reason : null;
  const providerImpl = getProvider(provider);
  if (!providerImpl) throw new HttpError(400, "Provedor de pagamento inválido.");

  const loaded = await loadCredentials(catalogId, provider);
  if (!loaded.credentials) {
    throw new HttpError(409, loaded.reason ?? "Conexão do provedor inválida.");
  }

  // ── Retry da MESMA operação: devolve o que já existe ───────────────────
  const existing = await findRefundByOperation(transaction.id, operationId);
  if (existing?.status === "approved") {
    return jsonRes({
      success: true,
      status: "approved",
      amount: Number(existing.amount),
      provider_refund_id: existing.provider_refund_id,
      payment_status: transaction.status,
      pending: false,
      reused: true,
      operation_id: operationId,
    });
  }
  if (existing?.status === "cancelled") {
    throw new HttpError(
      409,
      "Esta operação de reembolso já foi contabilizada por outra operação.",
    );
  }
  if (existing?.status === "pending" && existing.provider_refund_id) {
    // O provedor já recebeu a operação e ela aguarda confirmação.
    return jsonRes({
      success: true,
      status: "pending",
      amount: Number(existing.amount),
      provider_refund_id: existing.provider_refund_id,
      payment_status: transaction.status,
      pending: true,
      reused: true,
      operation_id: operationId,
    });
  }

  const ledger = await listRefunds(transaction.id);
  const snapshotRefunded = await readOfficialRefunded({
    providerImpl,
    credentials: loaded.credentials,
    provider,
    transaction,
    providerPaymentId,
  });

  // ── Validação monetária (R-02) ─────────────────────────────────────────
  const plan = planRefund({
    totalAmount: Number(transaction.amount ?? 0),
    currency: transaction.currency,
    requestedAmount: existing
      ? Number(existing.amount)
      : ctx.body.amount === undefined || ctx.body.amount === null
        ? null
        : Number(ctx.body.amount),
    ledger,
    snapshotRefunded,
    currentStatus: transaction.status,
    operationId,
  });
  if (!plan.ok) {
    const status =
      plan.code === "invalid_amount" ||
      plan.code === "precision" ||
      plan.code === "invalid_operation_id"
        ? 400
        : 409;
    throw new HttpError(status, plan.reason);
  }

  // ── Reserva a operação antes do provedor (retry seguro) ────────────────
  let row = existing;
  if (!row) {
    const claim = await claimRefundOperation({
      transactionId: transaction.id,
      catalogId,
      provider,
      amount: plan.amount,
      reason,
      requestedBy: ctx.userId,
      operationId,
    });
    if (!claim.row) {
      throw new HttpError(
        503,
        "Não foi possível registrar a operação de reembolso. Tente novamente.",
      );
    }
    row = claim.row;
    if (!claim.created && row.status === "approved") {
      return jsonRes({
        success: true,
        status: "approved",
        amount: Number(row.amount),
        provider_refund_id: row.provider_refund_id,
        payment_status: transaction.status,
        pending: false,
        reused: true,
        operation_id: operationId,
      });
    }
    if (!claim.created && row.status === "pending" && row.provider_refund_id) {
      return jsonRes({
        success: true,
        status: "pending",
        amount: Number(row.amount),
        provider_refund_id: row.provider_refund_id,
        payment_status: transaction.status,
        pending: true,
        reused: true,
        operation_id: operationId,
      });
    }
  }

  const idempotencyKey = refundProviderKey({ providerPaymentId, operationId });

  let result: RefundResult;
  try {
    result = await providerImpl.refund(loaded.credentials, {
      providerPaymentId,
      amount: plan.amount,
      currency: plan.currency,
      reason,
      idempotencyKey,
    });
  } catch (error) {
    // Resultado DESCONHECIDO (timeout/rede): a linha fica `pending` para que o
    // retry reuse a MESMA chave. Nada é contabilizado.
    console.error(
      "[payments] refund provider",
      error instanceof Error ? error.message : String(error),
    );
    throw new HttpError(
      502,
      "O provedor não confirmou o reembolso. Tente novamente — a mesma operação não será reembolsada duas vezes.",
    );
  }

  // ── O provedor devolveu um reembolso de OUTRA operação? ────────────────
  // Anula esta linha: o valor já pertence a outra operação e não pode ser
  // somado de novo (R-01).
  const duplicate = result.providerRefundId
    ? await findRefundByProviderId(provider, result.providerRefundId)
    : null;
  if (duplicate && duplicate.id !== row.id) {
    await updateRefundRecord(row.id, {
      status: "cancelled",
      providerRefundId: result.providerRefundId,
    });
    const state = computeRefundState({
      totalAmount: Number(transaction.amount ?? 0),
      currency: plan.currency,
      ledger: await listRefunds(transaction.id),
      snapshotRefunded,
      currentStatus: transaction.status,
    });
    await persistRefundState({ transaction, provider, state });
    return jsonRes({
      success: true,
      status: duplicate.status,
      amount: 0,
      provider_refund_id: result.providerRefundId,
      payment_status: state.status,
      pending: duplicate.status === "pending",
      reused: true,
      operation_id: operationId,
    });
  }

  await updateRefundRecord(row.id, {
    status: result.status,
    providerRefundId: result.providerRefundId,
    amount: result.amount,
  });

  // ── Saldo recalculado do ledger (R-01/R-02) ────────────────────────────
  // O total oficial só complementa; nunca é somado ao que já existe.
  const official =
    result.status === "approved"
      ? await readOfficialRefunded({
          providerImpl,
          credentials: loaded.credentials,
          provider,
          transaction,
          providerPaymentId,
        })
      : null;

  const state = computeRefundState({
    totalAmount: Number(transaction.amount ?? 0),
    currency: plan.currency,
    ledger: await listRefunds(transaction.id),
    snapshotRefunded: official ?? snapshotRefunded,
    currentStatus: transaction.status,
  });

  await persistRefundState({ transaction, provider, state });

  return jsonRes({
    success: true,
    status: result.status,
    amount: result.amount,
    provider_refund_id: result.providerRefundId,
    payment_status: state.status,
    pending: result.status === "pending",
    operation_id: operationId,
  });
}

async function refreshPaymentAction(ctx: OwnerCtx): Promise<Response> {
  const transactionId = String(ctx.body.transaction_id ?? "").trim();
  if (!transactionId) throw new HttpError(400, "transaction_id é obrigatório.");

  const { transaction, catalogId, provider } = await loadOwnedTransaction(
    ctx.userId,
    transactionId,
  );

  // Consulta oficial usando o id correto (pagamento no MP, ordem no PayPal) e
  // captura a ordem PayPal quando ela ainda está apenas autorizada.
  const paymentId = providerLookupId({
    provider,
    providerPaymentId: transaction.provider_payment_id,
    providerOrderId: transaction.provider_order_id,
  });
  if (!paymentId) throw new HttpError(409, "Pagamento ainda não identificado no provedor.");

  const applied = await applyOfficialSnapshot({
    provider,
    transaction,
    providerPaymentId: paymentId,
    captureIfAuthorized: true,
  });
  if (!applied.ok || !applied.snapshot) {
    throw new HttpError(502, applied.reason ?? "O provedor não retornou o pagamento.");
  }
  void catalogId;

  // ── Conciliação de reembolsos pendentes (auditoria M5 / R-01) ──────────
  // Aprova apenas os pendentes que o total oficial comprova, em ordem
  // cronológica — nunca "todos de uma vez" só porque o saldo subiu.
  const ledger = await listRefunds(transaction.id);
  const snapshotRefunded = Number(applied.snapshot.refundedAmount ?? 0);
  const reconciliation = reconcilePendingRefunds({
    totalAmount: Number(transaction.amount ?? 0),
    currency: transaction.currency,
    ledger,
    snapshotRefunded,
    currentStatus: applied.snapshot.status,
  });
  for (const refundId of reconciliation.approveIds) {
    await updateRefundRecord(refundId, { status: "approved" });
  }

  const state = computeRefundState({
    totalAmount: Number(transaction.amount ?? 0),
    currency: transaction.currency,
    ledger:
      reconciliation.approveIds.length > 0 ? await listRefunds(transaction.id) : ledger,
    snapshotRefunded,
    currentStatus: applied.snapshot.status,
  });

  await persistRefundState({
    transaction: {
      ...transaction,
      status: applied.snapshot.status,
      refunded_amount: snapshotRefunded,
    },
    provider,
    state,
  });

  return jsonRes({
    success: true,
    status: state.status,
    provider_status: applied.snapshot.providerStatus,
    captured_amount: applied.snapshot.capturedAmount,
    refunded_amount: state.refundedAmount,
    amount: applied.snapshot.amount,
    currency: applied.snapshot.currency,
    captured: applied.captured ?? false,
  });
}
