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
import { readEnv } from "./crypto.ts";
import { addAmounts, currencyDecimals, providerAmount } from "./money.ts";
import { computeChargeSplit } from "./lifecycle.ts";
import { selectPaymentFromMerchantOrder } from "./resolution.ts";
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
  WebhookRequest,
  WebhookVerification,
} from "./types.ts";

const API_BASE = "https://api.mercadopago.com";
const TIMEOUT_MS = 20_000;

export function mpEnvironment(): "sandbox" | "production" {
  return readEnv("MP_ENV") === "production" ? "production" : "sandbox";
}

function config() {
  return {
    clientId: readEnv("MP_CLIENT_ID"),
    clientSecret: readEnv("MP_CLIENT_SECRET"),
    webhookSecret: readEnv("MP_WEBHOOK_SECRET"),
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

/** Endpoint público que recebe as notificações (precisa de verify_jwt = false). */
export function mpNotificationUrl(supabaseUrl: string): string {
  return `${String(supabaseUrl ?? "").replace(/\/+$/, "")}/functions/v1/webhooks-mercadopago`;
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
    statement_descriptor: "VITRINE CRIATIVA",
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

  async buildAuthorizeUrl({ state, redirectUri }): Promise<string> {
    const { clientId, authBase, siteId } = config();
    if (!clientId) throw new Error("MP_CLIENT_ID ausente.");
    const query = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      platform_id: "mp",
      state,
      redirect_uri: redirectUri,
      site_id: siteId,
    });
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
      console.error("[mercadopago] oauth/token", res.status, JSON.stringify(res.body));
      throw new Error(res.body?.message || `Mercado Pago recusou a autorização (${res.status}).`);
    }

    const accessToken = res.body.access_token as string;
    const refreshToken = (res.body.refresh_token as string) ?? null;
    const expiresIn = Number(res.body.expires_in ?? 15_552_000); // 180 dias (padrão MP)
    const me = await mpFetch("/users/me", { method: "GET", token: accessToken });
    const userId = String(res.body.user_id ?? me.body?.id ?? "");
    const label = me.body?.email ?? me.body?.nickname ?? userId;

    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      scopes: String(res.body.scope ?? "offline_access read write").split(/[\s,]+/).filter(Boolean),
      externalAccountId: userId,
      externalAccountLabel: String(label),
      merchantId: userId,
      capabilities: {
        site_id: me.body?.site_id ?? null,
        country_id: me.body?.country_id ?? null,
        nickname: me.body?.nickname ?? null,
        live_mode: res.body.live_mode ?? null,
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
      console.error("[mercadopago] refresh", res.status, JSON.stringify(res.body));
      throw new Error("Não foi possível renovar a autorização do Mercado Pago.");
    }
    const expiresIn = Number(res.body.expires_in ?? 15_552_000);
    return {
      ...current,
      accessToken: res.body.access_token,
      refreshToken: res.body.refresh_token ?? refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  },

  async revoke(credentials: ProviderCredentials): Promise<void> {
    // MP não documenta revogação programática; a desconexão apaga os tokens
    // locais e o vendedor pode remover o app na conta dele.
    void credentials;
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
    return {
      ok: true,
      externalAccountId: String(res.body.id),
      externalAccountLabel: String(res.body.email ?? res.body.nickname ?? res.body.id),
      merchantId: String(res.body.id),
      capabilities: {
        site_id: res.body.site_id ?? null,
        country_id: res.body.country_id ?? null,
        nickname: res.body.nickname ?? null,
      },
    };
  },

  async createPayment(
    credentials: ProviderCredentials,
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    const supabaseUrl = readEnv("SUPABASE_URL") ?? "";
    const body = buildPreferenceBody(input, mpNotificationUrl(supabaseUrl));

    const res = await mpFetch("/checkout/preferences", {
      method: "POST",
      token: credentials.accessToken,
      headers: { "X-Idempotency-Key": input.externalReference },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("[mercadopago] preference", res.status, JSON.stringify(res.body));
      throw new Error(res.body?.message || `Mercado Pago recusou o pagamento (${res.status}).`);
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
      capturedAmount: res.body.status === "approved" ? amount : 0,
      refundedAmount: refunded,
      payerReference: res.body.payer?.email ?? null,
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
      console.error("[mercadopago] refund", res.status, JSON.stringify(res.body));
      throw new Error(res.body?.message || `Mercado Pago recusou o reembolso (${res.status}).`);
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
    const eventId = `${type || "payment"}:${dataId || "unknown"}:${action || "notification"}`;
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
        reason: "MP_WEBHOOK_SECRET não configurado.",
      };
    }

    const signature = request.headers["x-signature"] ?? "";
    const requestId = request.headers["x-request-id"] ?? "";
    const parts = new Map<string, string>();
    for (const chunk of signature.split(",")) {
      const idx = chunk.indexOf("=");
      if (idx > 0) parts.set(chunk.slice(0, idx).trim(), chunk.slice(idx + 1).trim());
    }
    const ts = parts.get("ts") ?? "";
    const v1 = parts.get("v1") ?? "";
    if (!ts || !v1 || !dataId) {
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

    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
    const expected = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    let diff = expected.length === v1.length ? 0 : 1;
    for (let i = 0; i < Math.min(expected.length, v1.length); i++) {
      diff |= expected.charCodeAt(i) ^ v1.charCodeAt(i);
    }
    const valid = diff === 0;

    // `valid` reflete apenas a assinatura. Eventos que não são de pagamento
    // (ex.: merchant_order) são marcados como `isTestEvent` para o handler
    // responder 200 sem efeitos — mas com assinatura inválida continuam 401.
    return {
      valid,
      eventId,
      eventType: type,
      providerPaymentId: type === "payment" ? dataId || null : null,
      isTestEvent: !isPayment,
      payload,
      ...(valid ? {} : { reason: "Assinatura do webhook inválida." }),
    };
  },
};
