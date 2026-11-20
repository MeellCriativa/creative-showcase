/**
 * MercadoPagoProvider — Marketplace com Split 1:1.
 *
 * Cada vendedor autoriza o aplicativo via OAuth (Authorization Code) e a
 * preferência de pagamento é criada COM O TOKEN DO VENDEDOR. Assim o dinheiro
 * é liquidado diretamente na conta dele (split 1:1), sem comissão da
 * plataforma: nenhum `marketplace_fee` é enviado e nenhuma taxa é habilitada.
 *
 * Split 1:N não é implementado (exigiria habilitação específica na conta).
 */
import { maskAccountId, maskEmail, readEnv } from "./crypto.ts";
import { addAmounts, currencyDecimals, providerAmount } from "./money.ts";
import { computeChargeSplit } from "./lifecycle.ts";
import { selectPaymentFromMerchantOrder } from "./resolution.ts";
import { validatedPaymentsWebhookUrl } from "./urls.ts";
import type {
  CreatePaymentInput,
  CreatePaymentResult,
  NotificationResolution,
  PaymentProvider,
  PaymentStatus,
  ProviderCredentials,
  ProviderPaymentSnapshot,
  RefundInput,
  RefundResult,
  RevokeResult,
  WebhookRequest,
  WebhookVerification,
} from "./types.ts";

const API_BASE = "https://api.mercadopago.com";
const TIMEOUT_MS = 20_000;
/** Janela de tolerância do `ts` assinado do webhook (defesa contra replay). */
const WEBHOOK_TS_TOLERANCE_MS = 10 * 60_000;

/**
 * O `ts` do `x-signature` aparece em duas formas na documentação oficial:
 * segundos (10 dígitos) e milissegundos (13 dígitos). Normalizamos as duas
 * para evitar recusar uma notificação legítima por causa do formato.
 */
function webhookTimestampMs(ts: string): number | null {
  if (!/^\d+$/.test(ts)) return null;
  const numeric = Number(ts);
  if (!Number.isSafeInteger(numeric)) return null;
  if (ts.length <= 10) return numeric * 1000;
  if (ts.length >= 13) return numeric;
  return null;
}

/** Comparação em tempo constante (a documentação oficial recomenda isso). */
function constantTimeEquals(expected: string, candidate: string): boolean {
  let diff = expected.length === candidate.length ? 0 : 1;
  for (let i = 0; i < Math.min(expected.length, candidate.length); i++) {
    diff |= expected.charCodeAt(i) ^ candidate.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Manifesto oficial: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.
 * A documentação manda omitir os pares cujo valor não esteja presente.
 */
function webhookManifest(dataId: string, requestId: string, ts: string): string {
  const parts: string[] = [];
  if (dataId) parts.push(`id:${dataId.toLowerCase()}`);
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  return `${parts.join(";")};`;
}

/**
 * Erro da API do MP nunca é logado cru: o corpo pode conter dados do pagador
 * ou da conta da lojista. Mantemos apenas o que é necessário para diagnosticar.
 */
function redact(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
    .replace(/\b\d{11,14}\b/g, "<documento>")
    .slice(0, 200);
}

function safeApiError(body: any): string {
  if (!body || typeof body !== "object") return "";
  const message = typeof body.message === "string" ? redact(body.message) : "";
  const code = typeof body.error === "string" ? redact(body.error) : "";
  return [code, message].filter(Boolean).join(": ");
}

/** Nunca persistir e-mail/apelido da conta em claro (visível via capabilities/RLS). */
function maskAccountLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const clean = String(value);
  return clean.includes("@") ? maskEmail(clean) : maskAccountId(clean);
}

export function mpEnvironment(): "sandbox" | "production" {
  return readEnv("MP_ENV") === "production" ? "production" : "sandbox";
}

/**
 * M1 — PKCE NÃO é implementado nesta etapa (decisão registrada no relatório).
 * O fluxo é authorization code com `state` HMAC + nonce; o aplicativo MP deve
 * permanecer com PKCE desabilitado. Um `code_challenge` sem o fluxo completo
 * do `code_verifier` quebraria a troca do código.
 */

/** Escopos mínimos para criar preferência, consultar e reembolsar. */
export const MP_REQUIRED_SCOPES = ["offline_access", "read", "write"] as const;

/**
 * M2 — normaliza o `scope` devolvido por `/oauth/token`.
 *
 * Escopos são configurados no aplicativo MP, NÃO enviados na URL de
 * autorização. Um campo ausente nunca vira "permissão concedida": `known=false`
 * impede a conexão (fail-closed) sem inventar valores.
 */
export function mpScopesFromToken(value: unknown): {
  scopes: string[];
  known: boolean;
  missing: string[];
} {
  if (typeof value !== "string" || !value.trim()) {
    return { scopes: [], known: false, missing: [...MP_REQUIRED_SCOPES] };
  }
  const scopes = value
    .split(/[\s,]+/)
    .map((scope) => scope.trim().toLowerCase())
    .filter(Boolean);
  const missing = MP_REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
  return { scopes, known: true, missing };
}

function config() {
  return {
    clientId: readEnv("MP_CLIENT_ID"),
    clientSecret: readEnv("MP_CLIENT_SECRET"),
    /**
     * Correção P1: o segredo configurado no projeto é `MERCADOPAGO_WEBHOOK_SECRET`.
     * O nome antigo (`MP_WEBHOOK_SECRET`) fica apenas como compatibilidade com
     * instalações que já o tenham; o nome novo tem precedência. Nenhum valor é
     * logado ou devolvido ao chamador.
     */
    webhookSecret: readEnv("MERCADOPAGO_WEBHOOK_SECRET") ?? readEnv("MP_WEBHOOK_SECRET"),
    authBase: readEnv("MP_AUTH_BASE") ?? "https://auth.mercadopago.com.br",
    siteId: readEnv("MP_SITE_ID") ?? "MLB",
  };
}

async function mpFetch(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<{ ok: boolean; status: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

export function mapMercadoPagoStatus(
  status: string | null | undefined,
  refundedAmount = 0,
  totalAmount = 0,
): PaymentStatus {
  const s = String(status ?? "").toLowerCase();
  switch (s) {
    case "approved":
      // No Mercado Pago o valor aprovado já está capturado na conta do vendedor.
      return refundedAmount > 0 && totalAmount > 0 && refundedAmount < totalAmount
        ? "partially_refunded"
        : refundedAmount >= totalAmount && totalAmount > 0
          ? "refunded"
          : "captured";
    case "authorized":
      return "authorized";
    case "in_process":
    case "pending":
      return "pending";
    case "rejected":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "charged_back":
      return "disputed";
    default:
      return "pending";
  }
}

/**
 * Endpoint público que recebe as notificações (precisa de verify_jwt = false).
 *
 * P5: esta função apenas formata a URL. A validação fail-fast usada antes de
 * criar a preferência fica em `validatedPaymentsWebhookUrl()` (urls.ts), que
 * também impede que uma URL de outro ambiente seja enviada ao Mercado Pago.
 */
export function mpNotificationUrl(supabaseUrl: string): string {
  return `${String(supabaseUrl ?? "").replace(/\/+$/, "")}/functions/v1/webhooks-mercadopago`;
}

/** Conta vendedora devolvida pela API oficial — nunca inferida do payload. */
function officialSellerAccountId(body: Record<string, unknown>): string | null {
  const raw = body["collector_id"] ?? body["user_id"] ?? null;
  if (raw === null || raw === undefined || raw === "") return null;
  return String(raw);
}

/** Nome da loja na fatura: ASCII curto, aceito pelos sites do Mercado Pago. */
function statementDescriptor(value: string | null | undefined): string {
  const cleaned = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 22);
  return cleaned || "VITRINE CRIATIVA";
}

/**
 * Monta o corpo da preferência do Checkout Pro.
 *
 * Correção da auditoria (C3): o frete (`shipments.cost`) passou a ser enviado.
 * Se `itens + frete` não fechar exatamente com o total oficial do pedido, a
 * cobrança é recusada — nunca cobramos um valor diferente do pedido.
 */
export function buildPreferenceBody(
  input: CreatePaymentInput,
  notificationUrl: string,
): Record<string, unknown> {
  if (typeof notificationUrl !== "string" || !notificationUrl.trim()) {
    throw new Error("Cobrança recusada: notification URL ausente.");
  }
  const decimals = currencyDecimals(input.currency);
  const charge = computeChargeSplit({
    items: input.items.map((item) => ({
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    })),
    shippingAmount: Number(input.shippingAmount ?? 0),
    expectedTotal: Number(input.amount),
    decimals,
  });
  if (!charge.ok) {
    throw new Error(`Cobrança recusada: ${charge.reason}`);
  }

  return {
    items: input.items.map((item, index) => ({
      id: `${input.orderId}-${index}`,
      title: String(item.name).slice(0, 250),
      description: String(input.description).slice(0, 250),
      quantity: Number(item.quantity),
      currency_id: input.currency,
      unit_price: providerAmount(item.unitPrice, input.currency),
    })),
    // Frete cobrado à parte, como o Mercado Pago espera no Checkout Pro.
    ...(charge.shippingMinor > 0
      ? { shipments: { cost: charge.shipping, mode: "not_specified" } }
      : {}),
    external_reference: input.externalReference,
    notification_url: notificationUrl,
    back_urls: {
      success: input.returnUrl,
      pending: input.returnUrl,
      failure: input.cancelUrl,
    },
    auto_return: "approved",
    statement_descriptor: statementDescriptor(input.statementDescriptor),
    metadata: {
      order_id: input.orderId,
      catalog_id: input.catalogId,
      order_total: charge.total,
      shipping_cost: charge.shipping,
    },
    // Split 1:1 → nenhum marketplace_fee é enviado. O token é do vendedor,
    // portanto 100% do valor é liquidado na conta dele.
  };
}

/** Soma itens + frete (usada nos testes e na conferência de valores). */
export function mpChargeTotal(input: CreatePaymentInput): number {
  return addAmounts(
    [...input.items.map((item) => Number(item.unitPrice) * Number(item.quantity)), Number(input.shippingAmount ?? 0)],
    input.currency,
  );
}

export const mercadopagoProvider: PaymentProvider = {
  key: "mercadopago",
  label: "Mercado Pago",

  isConfigured(): boolean {
    const { clientId, clientSecret } = config();
    return !!(clientId && clientSecret);
  },

  setupMessage(): string | null {
    const { clientId, clientSecret } = config();
    if (!clientId || !clientSecret) {
      return "Mercado Pago ainda não configurado na plataforma (credenciais ausentes).";
    }
    return null;
  },

  async buildAuthorizeUrl({ state, redirectUri, siteId }): Promise<string> {
    const { clientId, authBase, siteId: defaultSiteId } = config();
    if (!clientId) throw new Error("MP_CLIENT_ID ausente.");
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      platform_id: "mp",
      state,
      redirect_uri: redirectUri,
      // M4: o site vem do connect (quando informado) ou do env; `/users/me`
      // continua sendo a fonte da verdade persistida no callback.
      site_id: String(siteId || defaultSiteId).toUpperCase(),
    });
    // M1: sem PKCE — o aplicativo MP cadastrado deve permanecer com PKCE off.
    return `${authBase}/authorization?${query.toString()}`;
  },

  async completeAuthorization({ query, redirectUri }): Promise<ProviderCredentials> {
    const { clientId, clientSecret } = config();
    if (!clientId || !clientSecret) throw new Error("Credenciais Mercado Pago ausentes.");
    const code = String(query.code ?? "").trim();
    if (!code) throw new Error("O Mercado Pago não retornou o código de autorização.");

    const res = await mpFetch("/oauth/token", {
      method: "POST",
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok || !res.body?.access_token) {
      console.error("[mercadopago] oauth/token", res.status, safeApiError(res.body));
      throw new Error(safeApiError(res.body) || `Mercado Pago recusou a autorização (${res.status}).`);
    }

    // M2: fail-closed. Se o MP não informou escopos ou concedeu menos do que o
    // necessário, NÃO assumimos que está tudo bem — o callback traduz esse erro
    // para `permissions_not_granted`.
    const parsedScopes = mpScopesFromToken(res.body.scope);
    if (!parsedScopes.known || parsedScopes.missing.length) {
      console.error(
        "[mercadopago] escopos insuficientes:",
        parsedScopes.known ? parsedScopes.missing.join(",") : "scope_ausente",
      );
      throw new Error(
        `permissions_not_granted: ${parsedScopes.known ? parsedScopes.missing.join(",") : "scope_ausente"}`,
      );
    }

    const accessToken = res.body.access_token as string;
    const refreshToken = (res.body.refresh_token as string) ?? null;
    const expiresIn = Number(res.body.expires_in ?? 15_552_000); // 180 dias (padrão MP)
    const me = await mpFetch("/users/me", { method: "GET", token: accessToken });
    const userId = String(res.body.user_id ?? me.body?.id ?? "");

    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: parsedScopes.scopes,
      externalAccountId: userId,
      externalAccountLabel: maskAccountLabel(me.body?.email ?? me.body?.nickname) ?? userId,
      merchantId: userId,
      capabilities: {
        site_id: me.body?.site_id ?? null,
        country_id: me.body?.country_id ?? null,
        nickname: maskAccountId(me.body?.nickname ?? null),
        live_mode: res.body.live_mode ?? null,
        scopes_known: true,
      },
    };
  },

  async refreshCredentials({ refreshToken, current }): Promise<ProviderCredentials> {
    const { clientId, clientSecret } = config();
    if (!clientId || !clientSecret) throw new Error("Credenciais Mercado Pago ausentes.");
    if (!refreshToken) throw new Error("Sem refresh token para renovar.");
    const res = await mpFetch("/oauth/token", {
      method: "POST",
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok || !res.body?.access_token) {
      console.error("[mercadopago] refresh", res.status, safeApiError(res.body));
      throw new Error("Não foi possível renovar a autorização do Mercado Pago.");
    }
    const expiresIn = Number(res.body.expires_in ?? 15_552_000);
    // M2: se o refresh trouxer `scope`, revalidamos. Se não trouxer, preservamos
    // os escopos conhecidos (fail-open aqui evita expiração em massa).
    let scopes = current.scopes;
    let capabilities = current.capabilities;
    if (res.body.scope !== undefined && res.body.scope !== null) {
      const refreshedScopes = mpScopesFromToken(res.body.scope);
      if (!refreshedScopes.known || refreshedScopes.missing.length) {
        console.error(
          "[mercadopago] refresh com escopos insuficientes:",
          refreshedScopes.known ? refreshedScopes.missing.join(",") : "scope_ausente",
        );
        throw new Error("A autorização do Mercado Pago perdeu permissões necessárias.");
      }
      scopes = refreshedScopes.scopes;
      capabilities = { ...current.capabilities, scopes_known: true };
    }
    return {
      ...current,
      accessToken: res.body.access_token,
      refreshToken: res.body.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes,
      capabilities,
    };
  },

  async revoke(credentials: ProviderCredentials): Promise<RevokeResult> {
    // M3: não existe endpoint público de revogação confirmado na documentação
    // consultada. Nunca fingimos que revogamos: sinalizamos a ação manual.
    // A desconexão local é feita pelo chamador, independente deste retorno.
    void credentials;
    return {
      remoteRevoked: false,
      manualRequired: true,
      reason: "Revogue o aplicativo Mercado Pago na sua própria conta.",
    };
  },

  async verifyConnection(credentials: ProviderCredentials) {
    const res = await mpFetch("/users/me", { method: "GET", token: credentials.accessToken });
    if (!res.ok || !res.body?.id) {
      return {
        ok: false,
        externalAccountId: credentials.externalAccountId || null,
        externalAccountLabel: credentials.externalAccountLabel || null,
        merchantId: credentials.merchantId,
        capabilities: credentials.capabilities,
        reason: `Mercado Pago respondeu ${res.status}.`,
      };
    }
    // M4: `/users/me` é a fonte da verdade, mas um campo ausente NÃO pode
    // apagar o que já estava persistido (isso deixava a conta sem site_id e a
    // checagem de moeda silenciosamente permissiva).
    const previous = credentials.capabilities ?? {};
    return {
      ok: true,
      externalAccountId: String(res.body.id),
      externalAccountLabel:
        maskAccountLabel(res.body.email ?? res.body.nickname) ??
        credentials.externalAccountLabel ??
        String(res.body.id),
      merchantId: String(res.body.id),
      capabilities: {
        ...previous,
        ...(res.body.site_id ? { site_id: String(res.body.site_id) } : {}),
        ...(res.body.country_id ? { country_id: String(res.body.country_id) } : {}),
        nickname: maskAccountId(res.body.nickname ?? null) ?? previous.nickname ?? null,
      },
    };
  },

  async createPayment(
    credentials: ProviderCredentials,
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    // P5: falha rápido se a Notification URL estiver ausente, malformada ou
    // apontar para outro projeto (ex.: produção durante testes Sandbox).
    const notificationUrl = validatedPaymentsWebhookUrl();
    const body = buildPreferenceBody(input, notificationUrl);

    const res = await mpFetch("/checkout/preferences", {
      method: "POST",
      token: credentials.accessToken,
      // P4: a chave é por tentativa; o fallback preserva chamadores antigos.
      headers: { "X-Idempotency-Key": input.idempotencyKey ?? input.externalReference },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("[mercadopago] preference", res.status, safeApiError(res.body));
      throw new Error(safeApiError(res.body) || `Mercado Pago recusou o pagamento (${res.status}).`);
    }
    const isSandbox = mpEnvironment() === "sandbox";
    const checkoutUrl =
      (isSandbox ? res.body?.sandbox_init_point : res.body?.init_point) ??
      res.body?.init_point ??
      null;
    return {
      providerPaymentId: null,
      providerOrderId: res.body?.id ?? null,
      status: "pending",
      providerStatus: "preference_created",
      checkoutUrl,
      raw: res.body ?? {},
    };
  },

  async getPayment(
    credentials: ProviderCredentials,
    providerPaymentId: string,
  ): Promise<ProviderPaymentSnapshot | null> {
    const res = await mpFetch(`/v1/payments/${encodeURIComponent(providerPaymentId)}`, {
      method: "GET",
      token: credentials.accessToken,
    });
    if (!res.ok || !res.body?.id) return null;
    const amount = Number(res.body.transaction_amount ?? 0);
    const refunded = Number(res.body.transaction_amount_refunded ?? 0);
    return {
      providerPaymentId: String(res.body.id),
      providerOrderId: res.body.order?.id ? String(res.body.order.id) : null,
      status: mapMercadoPagoStatus(res.body.status, refunded, amount),
      providerStatus: res.body.status ?? null,
      amount,
      currency: String(res.body.currency_id ?? ""),
      /**
       * Correção P2: a confirmação oficial precisa dizer a QUAL pedido e a QUAL
       * vendedor pertence o pagamento. `external_reference` é o UUID do pedido
       * enviado na Preference; `collector_id` é a conta do vendedor que recebe.
       * Ambos vêm da API oficial — nunca do corpo do webhook.
       */
      externalReference: res.body.external_reference
        ? String(res.body.external_reference)
        : null,
      sellerAccountId: res.body.collector_id
        ? String(res.body.collector_id)
        : res.body.user_id
          ? String(res.body.user_id)
          : null,
      capturedAmount: res.body.status === "approved" ? amount : 0,
      refundedAmount: refunded,
      // O Mercado Pago informa `transaction_amount_refunded` oficialmente.
      refundedAmountKnown: true,
      // Nunca persistir e-mail completo: a coluna é legível por RLS do dono.
      payerReference: maskEmail(res.body.payer?.email),
      raw: res.body,
    };
  },

  async capture(
    credentials: ProviderCredentials,
    providerPaymentId: string,
  ): Promise<ProviderPaymentSnapshot | null> {
    // Checkout Pro captura automaticamente na aprovação. Reaproveita a consulta.
    return mercadopagoProvider.getPayment(credentials, providerPaymentId);
  },

  async refund(
    credentials: ProviderCredentials,
    input: RefundInput,
  ): Promise<RefundResult> {
    const paymentId = input.providerPaymentId;
    if (!paymentId) {
      throw new Error("Pagamento do Mercado Pago ainda não identificado para reembolso.");
    }
    const amount = providerAmount(input.amount, input.currency);
    // Chave por OPERAÇÃO (R-01): retry da mesma operação devolve o MESMO
    // reembolso; outra operação de mesmo valor usa outra chave.
    const idempotencyKey = input.idempotencyKey;
    const res = await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}/refunds`, {
      method: "POST",
      token: credentials.accessToken,
      headers: { "X-Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        amount,
        ...(input.reason ? { reason: input.reason.slice(0, 250) } : {}),
      }),
    });
    if (!res.ok) {
      console.error("[mercadopago] refund", res.status, safeApiError(res.body));
      throw new Error(safeApiError(res.body) || `Mercado Pago recusou o reembolso (${res.status}).`);
    }
    const status = String(res.body?.status ?? "").toLowerCase();
    return {
      providerRefundId: res.body?.id ? String(res.body.id) : null,
      status: status === "approved" ? "approved" : status === "rejected" ? "failed" : "pending",
      amount: Number(res.body?.amount ?? amount),
      raw: res.body ?? {},
    };
  },

  /**
   * Resolve a notificação pela API oficial.
   *
   * O webhook do Mercado Pago entrega `{ type: "payment", data: { id } }`: o
   * `id` é o pagamento, enquanto a transação guarda a preferência. Sem esta
   * consulta, o pedido nunca era encontrado (auditoria C1/C2).
   */
  async resolveNotification(
    credentials: ProviderCredentials,
    resource: { type: string; id: string },
  ): Promise<NotificationResolution | null> {
    const id = String(resource.id ?? "").trim();
    if (!id) return null;

    if (resource.type === "payment") {
      const res = await mpFetch(`/v1/payments/${encodeURIComponent(id)}`, {
        method: "GET",
        token: credentials.accessToken,
      });
      if (!res.ok || !res.body?.id) return null;
      return {
        externalReference: res.body.external_reference
          ? String(res.body.external_reference)
          : null,
        providerPaymentId: String(res.body.id),
        providerStatus: res.body.status ?? null,
        sellerAccountId: officialSellerAccountId(res.body),
      };
    }

    if (resource.type === "merchant_order") {
      const res = await mpFetch(`/v1/merchant_orders/${encodeURIComponent(id)}`, {
        method: "GET",
        token: credentials.accessToken,
      });
      if (!res.ok || !res.body) return null;
      const payment = selectPaymentFromMerchantOrder(res.body);
      return {
        externalReference: res.body.external_reference
          ? String(res.body.external_reference)
          : null,
        providerPaymentId: payment?.paymentId ?? null,
        providerStatus: payment?.status ?? null,
        sellerAccountId: officialSellerAccountId(res.body),
      };
    }

    return null;
  },

  async verifyWebhook(request: WebhookRequest): Promise<WebhookVerification> {
    // O Mercado Pago pode notificar apenas por query string (IPN legado),
    // sem corpo. Nesse caso reconstruímos o payload a partir da query.
    let payload: Record<string, unknown> = {};
    const rawBody = (request.rawBody ?? "").trim();
    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return {
          valid: false,
          eventId: "",
          eventType: "",
          providerPaymentId: null,
          isTestEvent: false,
          payload: {},
          reason: "Payload inválido.",
        };
      }
    }
    if (!payload || typeof payload !== "object") payload = {};
    if (!payload["type"] && !payload["topic"] && request.query["topic"]) {
      payload = {
        type: request.query["topic"],
        data: { id: request.query["id"] ?? request.query["data.id"] ?? "" },
      };
    }

    const type = String((payload as any).type ?? (payload as any).topic ?? "");
    const dataId = String(
      (payload as any)?.data?.id ?? request.query["data.id"] ?? request.query.id ?? "",
    );
    const action = String((payload as any).action ?? "");
    const requestId = request.headers["x-request-id"] ?? "";
    // `x-request-id` identifica a entrega de forma estável; `action` varia entre
    // reenvios do mesmo pagamento e fragmentava a idempotência do evento.
    const eventId = requestId
      ? `${type || "payment"}:${dataId || "unknown"}:${requestId}`
      : `${type || "payment"}:${dataId || "unknown"}:${action || "notification"}`;
    const isPayment = type === "payment" || type === "merchant_order";

    const { webhookSecret } = config();
    if (!webhookSecret) {
      return {
        valid: false,
        eventId,
        eventType: type,
        providerPaymentId: type === "payment" ? dataId || null : null,
        isTestEvent: false,
        payload,
        reason: "MERCADOPAGO_WEBHOOK_SECRET não configurado.",
      };
    }

    /**
     * P6 — o `x-signature` é uma lista de pares `chave=valor` separados por
     * vírgula. Durante a rotação da chave do webhook o Mercado Pago pode
     * enviar MAIS DE UM `v1`. O código antigo usava um Map e o ÚLTIMO `v1`
     * sobrescrevia os anteriores — uma assinatura válida no início da lista
     * era descartada. Agora todos os valores são coletados e QUALQUER um pode
     * validar a notificação; nenhum é sobreposto.
     */
    const signatureHeader = request.headers["x-signature"] ?? "";
    const timestamps: string[] = [];
    const signatures: string[] = [];
    for (const chunk of signatureHeader.split(",")) {
      let separator = chunk.indexOf("=");
      if (separator < 0) separator = chunk.indexOf(":");
      if (separator <= 0) continue;
      const key = chunk.slice(0, separator).trim().toLowerCase();
      const value = chunk.slice(separator + 1).trim();
      if (!value) continue;
      if (key === "ts") timestamps.push(value);
      else if (key === "v1") signatures.push(value);
    }
    if (!timestamps.length || !signatures.length || !dataId) {
      return {
        valid: false,
        eventId,
        eventType: type,
        providerPaymentId: type === "payment" ? dataId || null : null,
        isTestEvent: false,
        payload,
        reason: "Assinatura ausente.",
      };
    }

    // Defesa contra replay: o ts assinado precisa estar dentro da janela.
    // Cada par (ts, v1) é avaliado junto — um ts fresco com um v1 antigo (ou
    // vice-versa) nunca produz uma assinatura válida.
    const now = Date.now();
    const freshTimestamps = timestamps.filter((ts) => {
      const tsMs = webhookTimestampMs(ts);
      return tsMs !== null && Math.abs(now - tsMs) <= WEBHOOK_TS_TOLERANCE_MS;
    });
    if (!freshTimestamps.length) {
      return {
        valid: false,
        eventId,
        eventType: type,
        providerPaymentId: type === "payment" ? dataId || null : null,
        isTestEvent: false,
        payload,
        reason: "Assinatura fora da janela de validade.",
      };
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const encoder = new TextEncoder();
    let valid = false;
    for (const ts of freshTimestamps) {
      const digest = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(webhookManifest(dataId, requestId, ts)),
      );
      const expected = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      // Sem `break`: comparar todos os candidatos evita vazar Qual v1 casou.
      for (const candidate of signatures) {
        if (constantTimeEquals(expected, candidate)) valid = true;
      }
    }
    if (!valid) {
      return {
        valid: false,
        eventId,
        eventType: type,
        providerPaymentId: type === "payment" ? dataId || null : null,
        isTestEvent: false,
        payload,
        reason: "Assinatura do webhook inválida.",
      };
    }

    // Eventos que não são de pagamento são marcados como `isTestEvent` para o
    // handler responder 200 sem efeitos — mas assinatura inválida continua 401.
    return {
      valid: true,
      eventId,
      eventType: type,
      providerPaymentId: type === "payment" ? dataId || null : null,
      isTestEvent: !isPayment,
      payload,
    };
  },
};
