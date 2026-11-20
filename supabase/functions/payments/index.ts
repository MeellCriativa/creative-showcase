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
  listPendingRefunds,
  listPendingRefundsForCatalog,
  listRefunds,
  markConnectionState,
  releaseCheckoutSession,
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
import { signState, encryptionConfigured, sha256Hex } from "../_shared/payments/crypto.ts";
import {
  EnvironmentConfigError,
  panelBaseUrl,
  panelOrigin,
  paymentsCallbackUrl,
} from "../_shared/payments/urls.ts";
import {
  checkCurrencySupport,
  MERCADOPAGO_SITE_CURRENCIES,
} from "../_shared/payments/currencies.ts";
import { createSecureOrder } from "../_shared/payments/orders.ts";
import { applyOfficialSnapshot } from "../_shared/payments/webhooks.ts";
import { clientFingerprint, enforceRateLimit } from "../_shared/payments/ratelimit.ts";
import {
  blocksNewCharge,
  connectionEnvironmentMatches,
  paymentAttemptDecision,
  providerLookupId,
} from "../_shared/payments/lifecycle.ts";
import {
  computeRefundState,
  refundProviderKey,
} from "../_shared/payments/refunds.ts";
import {
  executeRefund,
  reconcileTransactionRefunds,
  type OfficialRefunded,
  type RefundClaimInput,
  type RefundClaimResult,
  type RefundFlowDeps,
  type RefundRecord,
} from "../_shared/payments/refund-flow.ts";
import { resolveStoreCurrency, toMinorUnits } from "../../../src/lib/currency.ts";
import type {
  PaymentProvider,
  PaymentProviderKey,
  ProviderCredentials,
  RevokeResult,
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
  return paymentsCallbackUrl();
}

function allowedOrigin(): string {
  return panelOrigin();
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

/**
 * MP Checkout Pro guarda a PREFERÊNCIA em `provider_order_id`; o id consultável
 * em `/v1/payments/{id}` só chega pelo webhook. Se o comprador voltar antes
 * dele, consultamos a API oficial usando a preferência como `merchant_order`
 * e persistimos o payment id antes do snapshot (auditoria Etapa 2.2).
 *
 * Correção P0: esta função vivia aninhada em `paymentStatusAction`, mas também
 * é chamada por `refreshPaymentAction` — fora de escopo. Ela agora é de módulo
 * e serve a todas as ações que precisam resolver o id do pagamento.
 */
async function resolveMpPaymentId(
  tx: TransactionRow,
  credentials: ProviderCredentials,
): Promise<string | null> {
  const impl = getProvider("mercadopago");
  if (!impl || !tx.provider_order_id) return null;
  const looked = await impl.resolveNotification(credentials, {
    type: "merchant_order",
    id: tx.provider_order_id,
  });
  const paymentId = looked?.providerPaymentId ?? null;
  if (!paymentId) return null;
  await updateTransaction({
    transactionId: tx.id,
    status: tx.status,
    providerStatus: looked?.providerStatus ?? tx.provider_status,
    providerPaymentId: paymentId,
  });
  return paymentId;
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
        // P8: apenas ações que podem gerar cobrança falham fechado quando o
        // limitador está indisponível; consultas continuam fail-open.
        const failClosed = action === "create_order" || action === "create_payment";
        const decision = await enforceRateLimit({
          bucket: `${action}:${clientFingerprint(req)}`,
          windowMs: limit.windowMs,
          max: limit.max,
          failClosed,
        });
        if (!decision.allowed) {
          const retrySeconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
          return jsonRes(
            {
              success: false,
              error: decision.degraded
                ? "Pagamento temporariamente indisponível. Tente novamente em instantes."
                : "Muitas tentativas em pouco tempo. Aguarde alguns instantes.",
              code: decision.degraded ? "rate_limiter_unavailable" : "rate_limited",
            },
            decision.degraded ? 503 : 429,
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
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof EnvironmentConfigError
          ? 503
          : 500;
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

  // P4: a chave de idempotência é da TENTATIVA, não do pedido. O checkout_token
  // é de uso único e de alta entropia: o hash mantém a estabilidade dentro da
  // mesma tentativa (retries) e impede reaproveitar uma Preference antiga
  // quando o comprador inicia um novo checkout para o mesmo pedido.
  const attemptDigest = await sha256Hex(
    `${orderId}|${provider}|${providerEnvironment(provider)}|${token}`,
  );
  const attemptId = attemptDigest.slice(0, 32);
  const idempotencyKey = `${provider}-${attemptId}`;

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
  // Correção P3: conexão Sandbox nunca cobra em produção (e vice-versa).
  if (!connectionEnvironmentMatches(connection.environment, providerEnvironment(provider))) {
    throw new HttpError(
      409,
      "A conexão deste provedor foi autorizada em outro ambiente. Reconecte a loja para continuar.",
    );
  }

  const capabilities = (connection.capabilities ?? {}) as Record<string, unknown>;
  const support = checkCurrencySupport(provider, {
    currency,
    accountSiteId: (capabilities.site_id as string | null) ?? null,
    accountPrimaryCurrency: (capabilities.primary_currency as string | null) ?? null,
    // M4: cobrar é escrita — exige saber onde a conta liquida.
    requireKnownSite: true,
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

  // P13: a base pode conter path; a validação de origem usa panelOrigin().
  const fallbackReturn = `${panelBaseUrl()}/c/${catalog.slug}?payment=return&order=${order.id}`;
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
    statementDescriptor: catalog.store_name,
    idempotencyKey,
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
    metadata: {
      source: "checkout",
      order_total_minor: toMinorUnits(orderTotal, currency),
      attempt_id: attemptId,
      idempotency_key: idempotencyKey,
    },
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
    // Sem espelho local não há como retomar o checkout: devolve a sessão para
    // que o mesmo token possa ser usado uma vez (a cobrança já existe na origem).
    await releaseCheckoutSession(order.id, token);
    throw new HttpError(503, "Não foi possível registrar o pagamento. Tente novamente.");
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
    let providerPaymentId = providerLookupId({
      provider,
      providerPaymentId: transaction.provider_payment_id,
      providerOrderId: transaction.provider_order_id,
    });
    if (provider === "mercadopago" && !transaction.provider_payment_id) {
      const creds = await loadCredentials(transaction.catalog_id, provider);
      if (creds.credentials) {
        providerPaymentId =
          (await resolveMpPaymentId(transaction, creds.credentials)) ?? providerPaymentId;
      }
    }
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

  // M4: site da conta é opcional e validado contra a tabela oficial de moedas.
  // `/users/me` continua sendo a fonte da verdade no callback.
  let requestedSiteId: string | null = null;
  if (provider === "mercadopago") {
    const rawSite = String(ctx.body.site_id ?? "").trim().toUpperCase();
    if (rawSite) {
      if (!MERCADOPAGO_SITE_CURRENCIES[rawSite]) {
        throw new HttpError(400, "País da conta Mercado Pago inválido.");
      }
      requestedSiteId = rawSite;
    }
  }

  // M1: PKCE permanece desligado por decisão registrada. A proteção CSRF é o
  // `state` assinado + nonce de uso único; não enviamos challenge/verifier.

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
    ...(requestedSiteId ? { site_id: requestedSiteId } : {}),
    exp: Date.now() + stateExpiryMs(),
  });
  if (!state) throw new HttpError(503, "Não foi possível assinar a autorização (state).");
  const savedState = await saveOAuthState({
    nonce,
    catalogId: catalog.id,
    provider,
    userId: ctx.userId,
    expiresAt,
  });
  if (!savedState.ok) {
    throw new HttpError(503, "Não foi possível iniciar a autorização. Tente novamente.");
  }

  const authorizeUrl = await providerImpl.buildAuthorizeUrl({
    state,
    redirectUri: callbackUrl(),
    trackingId: `${catalog.id}-${Date.now()}`,
    siteId: requestedSiteId,
  });

  return jsonRes({ success: true, url: authorizeUrl, provider });
}

async function disconnectAction(ctx: OwnerCtx): Promise<Response> {
  const catalogId = readCatalogId(ctx);
  const provider = readProvider(ctx);
  const catalog = await getOwnedCatalog(ctx.userId, catalogId);
  if (!catalog) throw new HttpError(404, "Catálogo não encontrado.");

  const loaded = await loadCredentials(catalog.id, provider);
  let revocation: RevokeResult = { remoteRevoked: false, manualRequired: true };
  if (loaded.credentials) {
    try {
      // M3: a revogação remota é best effort e NUNCA impede a remoção local.
      revocation = await getProvider(provider)!.revoke(loaded.credentials);
    } catch (error) {
      console.error("[payments] revoke falhou (local removido)", (error as Error).message);
      revocation = {
        remoteRevoked: false,
        manualRequired: true,
        reason: "Não foi possível revogar no provedor.",
      };
    }
  }
  await deleteConnection(catalog.id, provider);
  // Nunca devolvemos texto cru do provedor: apenas o contrato estável acima.
  return jsonRes({ success: true, revocation });
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
    if (!connectionEnvironmentMatches(connection.environment, providerEnvironment(provider))) {
      throw new HttpError(
        409,
        "Esta conexão pertence a outro ambiente. Reconecte o provedor antes de habilitá-lo.",
      );
    }
    const currency = resolveStoreCurrency(catalog.currency);
    const capabilities = (connection.capabilities ?? {}) as Record<string, unknown>;
    const support = checkCurrencySupport(provider, {
      currency,
      accountSiteId: (capabilities.site_id as string | null) ?? null,
      accountPrimaryCurrency: (capabilities.primary_currency as string | null) ?? null,
      // M4: habilitar é escrita — exige saber onde a conta liquida.
      requireKnownSite: true,
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

  // F-01: as pendências vêm do SERVIDOR. O painel precisa retomar a MESMA
  // operação depois de reload/logout/timeout — o estado do navegador não serve.
  const pendingRows = await listPendingRefundsForCatalog(catalog.id);
  const pendingByTransaction = new Map<string, RefundRecord[]>();
  for (const refund of pendingRows) {
    const list = pendingByTransaction.get(refund.transaction_id);
    if (list) list.push(refund);
    else pendingByTransaction.set(refund.transaction_id, [refund]);
  }

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
      pending_refunds: (pendingByTransaction.get(String(row.id)) ?? []).map((refund) => ({
        id: refund.id,
        operation_id: refund.operation_id ?? null,
        amount: Number(refund.amount ?? 0),
        status: refund.status,
        provider_refund_id: refund.provider_refund_id,
        provider_acknowledged: !!refund.provider_refund_id,
        created_at: refund.created_at,
      })),
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
 * Consulta o total reembolsado oficial.
 *
 * F-06B: devolve também se o total é CONFIÁVEL. O PayPal responde
 * `PARTIALLY_REFUNDED` na captura sem informar o valor; nesse caso `known` é
 * `false` e nada pode ser confirmado a partir dele.
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
}): Promise<OfficialRefunded> {
  try {
    // O PayPal expõe o reembolso na ORDEM (a captura não traz o total parcial).
    const lookupId =
      input.provider === "paypal" && input.transaction.provider_order_id
        ? input.transaction.provider_order_id
        : input.providerPaymentId;
    const snapshot = await input.providerImpl.getPayment(input.credentials, lookupId);
    if (!snapshot) return { amount: null, known: false };
    const known = snapshot.refundedAmountKnown ?? true;
    const value = Number(snapshot.refundedAmount ?? 0);
    if (!Number.isFinite(value)) return { amount: null, known: false };
    return { amount: known ? value : null, known };
  } catch (error) {
    console.error(
      "[payments] refund snapshot",
      error instanceof Error ? error.message : String(error),
    );
    return { amount: null, known: false };
  }
}

/**
 * Liga o fluxo de reembolso (módulo testável) ao banco e ao provedor reais.
 *
 * O `operation_id`/chave de idempotência são persistidos pelo `claim` ANTES de
 * qualquer chamada ao provedor (F-01). Nenhuma dependência aqui inventa valores
 * de saldo: tudo vem do ledger + total oficial.
 */
function buildRefundDeps(input: {
  providerImpl: PaymentProvider;
  credentials: ProviderCredentials;
  providerPaymentId: string;
}): RefundFlowDeps {
  return {
    listRefunds,
    findRefundByOperation,
    findRefundByProviderId,
    listPendingRefunds,
    claimRefundOperation: async (claim) => {
      const claimed = await claimRefundOperation({
        ...claim,
        // Fallback defensivo: a chave nunca pode ficar nula no banco. O fluxo
        // sempre envia a chave estável da operação.
        idempotencyKey:
          claim.idempotencyKey.trim() ||
          refundProviderKey({
            providerPaymentId: input.providerPaymentId,
            operationId: claim.operationId,
          }),
      });
      if (claimed.code) {
        return {
          ok: false,
          code: claimed.code,
          message: claimed.error,
          row: claimed.row,
        } as RefundClaimResult;
      }
      if (!claimed.row) {
        return {
          ok: false,
          code: "error",
          message: claimed.error ?? "Registro de reembolso não retornado.",
          row: null,
        } as RefundClaimResult;
      }
      return { ok: true, row: claimed.row, created: claimed.created };
    },
    updateRefundRecord,
    updateTransaction,
    syncOrderPayment: async (sync) => {
      try {
        return await syncOrderPayment(sync);
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    readOfficialRefunded: (transaction, providerPaymentId) =>
      readOfficialRefunded({
        providerImpl: input.providerImpl,
        credentials: input.credentials,
        provider: transaction.provider,
        transaction: transaction as TransactionRow,
        providerPaymentId,
      }),
    refund: (request) =>
      input.providerImpl.refund(input.credentials, {
        providerPaymentId: request.providerPaymentId,
        amount: request.amount,
        currency: request.currency,
        reason: request.reason,
        idempotencyKey: request.idempotencyKey,
      }),
    queryRefund: input.providerImpl.getRefund
      ? async (providerRefundId: string) =>
          input.providerImpl.getRefund!(input.credentials, providerRefundId)
      : undefined,
    log: (event, detail) => {
      console.log("[payments] refund", event, detail === undefined ? "" : JSON.stringify(detail));
    },
  };
}

/**
 * Reembolso (total ou parcial) — corrigido pela auditoria 2.1 (R-01/R-02) e
 * pela 2.1.3 (F-01/F-03/F-06A).
 *
 * A identidade da operação e a chave do provedor são PERSISTIDAS antes da
 * chamada: reload, logout, timeout e retry reusam a mesma operação. Enquanto
 * houver operação ambígua, uma nova é recusada. Nenhuma resposta de sucesso é
 * dada sem que o ledger e a transação tenham sido gravados.
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

  const providerImpl = getProvider(provider);
  if (!providerImpl) throw new HttpError(400, "Provedor de pagamento inválido.");

  const loaded = await loadCredentials(catalogId, provider);
  if (!loaded.credentials) {
    throw new HttpError(409, loaded.reason ?? "Conexão do provedor inválida.");
  }

  const providerPaymentId = String(transaction.provider_payment_id ?? "").trim();
  const deps = buildRefundDeps({
    providerImpl,
    credentials: loaded.credentials,
    providerPaymentId,
  });

  const outcome = await executeRefund(deps, {
    transaction,
    operationId: ctx.body.operation_id,
    requestedAmount:
      ctx.body.amount === undefined || ctx.body.amount === null
        ? null
        : Number(ctx.body.amount),
    reason: typeof ctx.body.reason === "string" ? ctx.body.reason : null,
    requestedBy: ctx.userId,
    providerPaymentId,
  });

  if (!outcome.ok) {
    // Resposta estruturada: o painel precisa distinguir retry da MESMA operação
    // de uma operação nova, e saber quando o provedor já executou o reembolso.
    return jsonRes(
      {
        success: false,
        error: outcome.message,
        code: outcome.code,
        operation_id: outcome.operationId,
        retryable: outcome.retryable,
        provider_executed: outcome.providerExecuted,
        ...(outcome.pendingOperation
          ? { pending_operation: outcome.pendingOperation }
          : {}),
      },
      outcome.httpStatus,
    );
  }

  return jsonRes({
    success: true,
    status: outcome.status,
    amount: outcome.amount,
    provider_refund_id: outcome.providerRefundId,
    payment_status: outcome.paymentStatus,
    pending: outcome.pending,
    reused: outcome.reused,
    operation_id: outcome.operationId,
    refunded_amount: outcome.state.refundedAmount,
    remaining_amount: outcome.state.remainingAmount,
  });
}

/**
 * Consulta oficial + reconciliação.
 *
 * `applyOfficialSnapshot` grava o snapshot do provedor (monotônico). Em seguida
 * `reconcileTransactionRefunds` aprova apenas as pendências que o TOTAL OFICIAL
 * comprova — sem executar nenhum reembolso novo (F-01/F-06B).
 */
async function refreshPaymentAction(ctx: OwnerCtx): Promise<Response> {
  const transactionId = String(ctx.body.transaction_id ?? "").trim();
  if (!transactionId) throw new HttpError(400, "transaction_id é obrigatório.");

  const { transaction, catalogId, provider } = await loadOwnedTransaction(
    ctx.userId,
    transactionId,
  );

  const providerImpl = getProvider(provider);
  if (!providerImpl) throw new HttpError(400, "Provedor de pagamento inválido.");

  const loaded = await loadCredentials(catalogId, provider);
  if (!loaded.credentials) {
    throw new HttpError(409, loaded.reason ?? "Conexão do provedor inválida.");
  }

  // Consulta oficial usando o id correto (pagamento no MP, ordem no PayPal) e
  // captura a ordem PayPal quando ela ainda está apenas autorizada.
  let paymentId = providerLookupId({
    provider,
    providerPaymentId: transaction.provider_payment_id,
    providerOrderId: transaction.provider_order_id,
  });
  if (provider === "mercadopago" && !transaction.provider_payment_id) {
    paymentId = (await resolveMpPaymentId(transaction, loaded.credentials)) ?? paymentId;
  }
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

  const official: OfficialRefunded = {
    amount: Number(applied.snapshot.refundedAmount ?? 0),
    known: applied.snapshot.refundedAmountKnown ?? true,
  };
  const persistedRefunded = Number(applied.snapshot.refundedAmount ?? 0);

  const deps = buildRefundDeps({
    providerImpl,
    credentials: loaded.credentials,
    providerPaymentId: paymentId,
  });

  const reconciled = await reconcileTransactionRefunds(deps, {
    transaction: {
      ...transaction,
      status: applied.snapshot.status,
      // Piso monotônico já persistido pelo snapshot acima.
      refunded_amount: persistedRefunded,
    },
    official,
    currentStatus: applied.snapshot.status,
  });

  if (!reconciled.ok) {
    // A consulta oficial funcionou, mas a gravação local falhou. Nunca
    // devolvemos "tudo certo": o painel precisa saber que há divergência.
    const fallback = computeRefundState({
      totalAmount: Number(transaction.amount ?? 0),
      currency: transaction.currency,
      ledger: await listRefunds(transaction.id),
      snapshotRefunded: official.amount,
      snapshotKnown: official.known,
      currentRefunded: persistedRefunded,
      currentStatus: applied.snapshot.status,
    });
    return jsonRes(
      {
        success: false,
        error:
          "A consulta ao provedor funcionou, mas não foi possível reconciliar os reembolsos locais.",
        code: "reconcile_failed",
        status: fallback.status,
        provider_status: applied.snapshot.providerStatus,
        captured_amount: applied.snapshot.capturedAmount,
        refunded_amount: fallback.refundedAmount,
        refunded_amount_known: official.known,
        amount: applied.snapshot.amount,
        currency: applied.snapshot.currency,
        captured: applied.captured ?? false,
      },
      503,
    );
  }

  return jsonRes({
    success: true,
    status: reconciled.state.status,
    provider_status: applied.snapshot.providerStatus,
    captured_amount: applied.snapshot.capturedAmount,
    refunded_amount: reconciled.state.refundedAmount,
    refunded_amount_known: official.known,
    approved_refunds: reconciled.approvedIds.length,
    amount: applied.snapshot.amount,
    currency: applied.snapshot.currency,
    captured: applied.captured ?? false,
  });
}
