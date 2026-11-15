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
  createRefundRecord,
  createTransaction,
  deleteConnection,
  getCatalog,
  getConnection,
  getOwnedCatalog,
  markConnectionState,
  syncOrderPayment,
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
import { resolveStoreCurrency, toMinorUnits } from "../../../src/lib/currency.ts";
import type { PaymentProviderKey } from "../_shared/payments/types.ts";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
    .select("id, catalog_id, total, subtotal, currency, payment_status, payment_provider, items, customer_name")
    .eq("id", orderId)
    .maybeSingle();
  if (!orderData) throw new HttpError(404, "Pedido não encontrado.");

  const order = orderData as {
    id: string;
    catalog_id: string;
    total: number;
    subtotal: number | null;
    currency: string | null;
    payment_status: string;
    payment_provider: string | null;
    items: Array<{ name: string; quantity: number; unitPrice: number }>;
    customer_name: string;
  };

  if (["approved", "authorized", "captured", "refunded", "disputed"].includes(order.payment_status)) {
    throw new HttpError(409, "Este pedido já possui pagamento aprovado.");
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

  const fallbackReturn = `${allowedOrigin()}/c/${catalog.slug}?payment=return&order=${order.id}`;
  const returnUrl = safeReturnUrl(ctx.body.return_url as string, fallbackReturn);
  const cancelUrl = safeReturnUrl(ctx.body.cancel_url as string, fallbackReturn);

  const items = Array.isArray(order.items) && order.items.length > 0
    ? order.items.map((item) => ({
        name: String(item.name ?? "Item"),
        quantity: Number(item.quantity ?? 1),
        unitPrice: Number(item.unitPrice ?? 0),
      }))
    : [{ name: `Pedido ${order.id.slice(0, 8)}`, quantity: 1, unitPrice: orderTotal }];

  const result = await providerImpl.createPayment(loaded.credentials, {
    catalogId: catalog.id,
    orderId: order.id,
    amount: orderTotal,
    currency,
    description: `Pedido ${order.id.slice(0, 8)} — ${catalog.store_name}`,
    items,
    returnUrl,
    cancelUrl,
    externalReference: order.id,
    buyerEmail: null,
  });

  if (!result.checkoutUrl) {
    throw new HttpError(502, "O provedor não retornou a URL de pagamento.");
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

  const session = await validateCheckoutSession(orderId, token);
  if (!session.ok) throw new HttpError(403, session.reason ?? "Sessão inválida.");

  const admin = adminClient();
  const { data } = await admin
    .from("orders")
    .select("id, total, subtotal, currency, payment_status, payment_provider")
    .eq("id", orderId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Pedido não encontrado.");

  return jsonRes({
    success: true,
    order_id: data.id,
    total: Number(data.total ?? 0),
    currency: resolveStoreCurrency(data.currency as string | null),
    payment_status: data.payment_status,
    payment_provider: data.payment_provider,
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

  const state = await signState({
    catalog_id: catalog.id,
    user_id: ctx.userId,
    provider,
    env: providerEnvironment(provider),
    nonce: crypto.randomUUID(),
    exp: Date.now() + stateExpiryMs(),
  });
  if (!state) throw new HttpError(503, "Não foi possível assinar a autorização (state).");

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
    transactions: (data ?? []).map((row) => ({
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

  const amount = Number(transaction.amount ?? 0);
  const refunded = Number(transaction.refunded_amount ?? 0);
  const remaining = Math.round((amount - refunded) * 100) / 100;
  if (remaining <= 0) throw new HttpError(409, "Este pagamento já foi totalmente reembolsado.");

  const requested = ctx.body.amount === undefined || ctx.body.amount === null
    ? remaining
    : Number(ctx.body.amount);
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new HttpError(400, "Valor de reembolso inválido.");
  }
  if (requested > remaining + 0.001) {
    throw new HttpError(400, "O valor excede o saldo reembolsável deste pagamento.");
  }

  const loaded = await loadCredentials(catalogId, provider);
  if (!loaded.credentials) {
    throw new HttpError(409, loaded.reason ?? "Conexão do provedor inválida.");
  }

  const providerImpl = getProvider(provider)!;
  const providerPaymentId = transaction.provider_payment_id ?? "";
  if (!providerPaymentId) {
    throw new HttpError(409, "Pagamento ainda não identificado no provedor.");
  }

  const result = await providerImpl.refund(loaded.credentials, {
    providerPaymentId,
    amount: requested,
    currency: transaction.currency,
    reason: (ctx.body.reason as string) ?? null,
  });

  await createRefundRecord({
    transactionId: transaction.id,
    catalogId,
    provider,
    providerRefundId: result.providerRefundId,
    amount: result.amount,
    status: result.status,
    reason: (ctx.body.reason as string) ?? null,
    requestedBy: ctx.userId,
  });

  if (result.status === "approved" || result.status === "pending") {
    const newRefunded = Math.round((refunded + result.amount) * 100) / 100;
    const newStatus = newRefunded >= amount - 0.001 ? "refunded" : "partially_refunded";
    await updateTransaction({
      transactionId: transaction.id,
      status: newStatus,
      providerStatus: transaction.provider_status,
      refundedAmount: newRefunded,
    });
    await syncOrderPayment({
      orderId: transaction.order_id,
      provider,
      status: newStatus,
      transactionId: transaction.id,
    });
  }

  return jsonRes({
    success: true,
    status: result.status,
    amount: result.amount,
    provider_refund_id: result.providerRefundId,
  });
}

async function refreshPaymentAction(ctx: OwnerCtx): Promise<Response> {
  const transactionId = String(ctx.body.transaction_id ?? "").trim();
  if (!transactionId) throw new HttpError(400, "transaction_id é obrigatório.");

  const { transaction, catalogId, provider } = await loadOwnedTransaction(
    ctx.userId,
    transactionId,
  );
  const loaded = await loadCredentials(catalogId, provider);
  if (!loaded.credentials) {
    throw new HttpError(409, loaded.reason ?? "Conexão do provedor inválida.");
  }
  const providerImpl = getProvider(provider)!;
  const paymentId = transaction.provider_order_id ?? transaction.provider_payment_id ?? "";
  if (!paymentId) throw new HttpError(409, "Pagamento ainda não identificado no provedor.");

  const snapshot = await providerImpl.getPayment(loaded.credentials, paymentId);
  if (!snapshot) throw new HttpError(502, "O provedor não retornou o pagamento.");

  await updateTransaction({
    transactionId: transaction.id,
    status: snapshot.status,
    providerStatus: snapshot.providerStatus,
    capturedAmount: snapshot.capturedAmount,
    refundedAmount: snapshot.refundedAmount,
    payerReference: snapshot.payerReference,
    providerPaymentId: snapshot.providerPaymentId,
  });
  await syncOrderPayment({
    orderId: transaction.order_id,
    provider,
    status: snapshot.status,
    transactionId: transaction.id,
  });

  return jsonRes({
    success: true,
    status: snapshot.status,
    provider_status: snapshot.providerStatus,
    captured_amount: snapshot.capturedAmount,
    refunded_amount: snapshot.refundedAmount,
    amount: snapshot.amount,
    currency: snapshot.currency,
  });
}
