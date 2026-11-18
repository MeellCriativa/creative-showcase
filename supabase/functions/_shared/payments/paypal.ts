/**
 * PayPalProvider — PayPal Complete Payments Platform (marketplace).
 *
 * Modelo: cada vendedor conecta a PRÓPRIA conta via Seller Onboarding
 * (Partner Referrals API). O dinheiro é direcionado à conta do vendedor
 * (`payee.merchant_id`), nunca à conta central da plataforma.
 *
 * Requer aprovação comercial da PayPal para atuar como parceiro (Partner ID).
 * Sem `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`/`PAYPAL_PARTNER_ID` o provedor
 * reporta `configured = false` e nada é simulado.
 */
import { readEnv } from "./crypto.ts";
import { providerAmountString, currencyDecimals } from "./money.ts";
import { computeChargeSplit } from "./lifecycle.ts";
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

const BASES: Record<string, string> = {
  sandbox: "https://api-m.sandbox.paypal.com",
  production: "https://api-m.paypal.com",
};

const TIMEOUT_MS = 20_000;

export function paypalEnvironment(): "sandbox" | "production" {
  return readEnv("PAYPAL_ENV") === "production" ? "production" : "sandbox";
}

export function paypalBase(): string {
  return BASES[paypalEnvironment()]!;
}

function config() {
  return {
    clientId: readEnv("PAYPAL_CLIENT_ID"),
    clientSecret: readEnv("PAYPAL_CLIENT_SECRET"),
    partnerId: readEnv("PAYPAL_PARTNER_ID"),
    partnerAttributionId: readEnv("PAYPAL_PARTNER_ATTRIBUTION_ID") ?? readEnv("PAYPAL_PARTNER_ID"),
    webhookId: readEnv("PAYPAL_WEBHOOK_ID"),
  };
}

async function ppFetch(
  path: string,
  init: RequestInit & { token?: string } = {},
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
    const res = await fetch(`${paypalBase()}${path}`, {
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

async function platformToken(): Promise<string | null> {
  const { clientId, clientSecret } = config();
  if (!clientId || !clientSecret) return null;
  const basic = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    console.error("[paypal] platform token", res.status);
    return null;
  }
  const data = await res.json();
  return (data as { access_token?: string }).access_token ?? null;
}

export function mapPayPalStatus(status: string | null | undefined): PaymentStatus {
  switch (String(status ?? "").toUpperCase()) {
    case "COMPLETED":
      return "captured";
    case "APPROVED":
      return "authorized";
    case "CREATED":
    case "SAVED":
    case "PAYER_ACTION_REQUIRED":
      return "pending";
    case "VOIDED":
      return "cancelled";
    case "DECLINED":
    case "FAILED":
      return "failed";
    case "REFUNDED":
      return "refunded";
    case "PARTIALLY_REFUNDED":
      return "partially_refunded";
    case "DISPUTED":
    case "CHARGEBACK":
      return "disputed";
    default:
      return "pending";
  }
}

function money(value: number): string {
  return Number(value).toFixed(2);
}

/**
 * Monta a ordem de checkout do PayPal.
 *
 * O total inclui o frete e o `breakdown` deixa explícito quanto é item e quanto
 * é envio — se `itens + frete` não fechar com o total do pedido, recusamos.
 */
export function buildOrderBody(
  input: CreatePaymentInput,
  merchantId: string,
): Record<string, unknown> {
  const charge = computeChargeSplit({
    items: input.items.map((item) => ({
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
    })),
    shippingAmount: Number(input.shippingAmount ?? 0),
    expectedTotal: Number(input.amount),
    decimals: currencyDecimals(input.currency),
  });
  if (!charge.ok) {
    throw new Error(`Cobrança recusada: ${charge.reason}`);
  }

  const amount: Record<string, unknown> = {
    currency_code: input.currency,
    value: providerAmountString(charge.total, input.currency),
  };
  if (charge.shippingMinor > 0) {
    amount.breakdown = {
      item_total: {
        currency_code: input.currency,
        value: providerAmountString(charge.itemTotal, input.currency),
      },
      shipping: {
        currency_code: input.currency,
        value: providerAmountString(charge.shipping, input.currency),
      },
    };
  }

  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        reference_id: input.orderId,
        custom_id: input.externalReference,
        invoice_id: input.orderId.replace(/-/g, "").slice(0, 40),
        description: String(input.description).slice(0, 127),
        amount,
        payee: { merchant_id: merchantId },
      },
    ],
    application_context: {
      brand_name: "Vitrine Criativa",
      shipping_preference: "NO_SHIPPING",
      user_action: "PAY_NOW",
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
    },
  };
}

/**
 * Converte uma ordem do PayPal em snapshot financeiro.
 *
 * Correção da auditoria (C5): antes o status vinha só da ORDEM (`COMPLETED`) e
 * `refundedAmount` era sempre `0`, então qualquer consulta apagava o reembolso
 * já registrado e permitia reembolsar o mesmo valor duas vezes. Agora o status
 * vem da CAPTURA (que é quem carrega `REFUNDED`/`PARTIALLY_REFUNDED`).
 */
export function paypalSnapshotFromOrder(
  order: Record<string, unknown> | null | undefined,
  providerPaymentId: string,
): ProviderPaymentSnapshot | null {
  if (!order || typeof order !== "object") return null;
  const units = order["purchase_units"];
  const unit = Array.isArray(units) ? (units[0] as Record<string, unknown>) : null;
  const payments = (unit?.["payments"] ?? {}) as Record<string, unknown>;
  const captures = payments["captures"];
  const capture = Array.isArray(captures) ? (captures[0] as Record<string, unknown>) : null;

  const orderStatus = String(order["status"] ?? "");
  const captureStatus = String(capture?.["status"] ?? "").toUpperCase();
  const captureAmount = Number(
    (capture?.["amount"] as Record<string, unknown> | undefined)?.["value"] ?? 0,
  );
  const unitAmount = Number(
    (unit?.["amount"] as Record<string, unknown> | undefined)?.["value"] ?? 0,
  );

  let status: PaymentStatus = mapPayPalStatus(orderStatus);
  let capturedAmount = 0;
  let refundedAmount = 0;

  if (capture) {
    switch (captureStatus) {
      case "COMPLETED":
        status = "captured";
        capturedAmount = captureAmount;
        break;
      case "REFUNDED":
        status = "refunded";
        capturedAmount = captureAmount;
        refundedAmount = captureAmount;
        break;
      case "PARTIALLY_REFUNDED":
        // O PayPal não expõe o total reembolsado na captura; o valor já
        // registrado é preservado (merge monotônico no webhook/painel).
        status = "partially_refunded";
        capturedAmount = captureAmount;
        break;
      case "PENDING":
        status = "pending";
        break;
      case "DECLINED":
      case "FAILED":
        status = "failed";
        break;
      default:
        break;
    }
  }

  return {
    // Só a captura é um pagamento reembolsável; sem captura, nada é gravado.
    providerPaymentId: capture?.["id"] ? String(capture["id"]) : null,
    providerOrderId: order["id"] ? String(order["id"]) : providerPaymentId,
    status,
    providerStatus: captureStatus || orderStatus || null,
    amount: unitAmount || captureAmount,
    currency: String(
      (unit?.["amount"] as Record<string, unknown> | undefined)?.["currency_code"] ??
        (capture?.["amount"] as Record<string, unknown> | undefined)?.["currency_code"] ??
        "",
    ),
    capturedAmount,
    refundedAmount,
    payerReference: null,
    raw: order,
  };
}

export const paypalProvider: PaymentProvider = {
  key: "paypal",
  label: "PayPal",

  isConfigured(): boolean {
    const { clientId, clientSecret, partnerId } = config();
    return !!(clientId && clientSecret && partnerId);
  },

  setupMessage(): string | null {
    const { clientId, clientSecret, partnerId } = config();
    if (!clientId || !clientSecret) {
      return "PayPal ainda não configurado na plataforma (credenciais ausentes).";
    }
    if (!partnerId) {
      return "PayPal aguardando aprovação comercial: o Partner ID (marketplace) ainda não foi emitido.";
    }
    return null;
  },

  async buildAuthorizeUrl({ state, redirectUri, trackingId }): Promise<string> {
    const token = await platformToken();
    if (!token) throw new Error("Credenciais PayPal indisponíveis.");
    const { partnerAttributionId } = config();
    const res = await ppFetch("/v1/customer/partner-referrals", {
      method: "POST",
      token,
      headers: { "PayPal-Partner-Attribution-Id": partnerAttributionId ?? "" },
      body: JSON.stringify({
        tracking_id: (trackingId ?? state).slice(0, 120),
        partner_config_override: {
          return_url: `${redirectUri}?state=${encodeURIComponent(state)}`,
          return_url_description: "Voltar para a Vitrine Criativa",
          show_add_credit_card: true,
        },
        operations: [
          {
            operation: "API_INTEGRATION",
            api_integration_preference: {
              rest_api_integration: {
                integration_type: "THIRD_PARTY",
                third_party_details: { features: ["PAYMENT", "REFUND"] },
              },
            },
          },
        ],
        products: ["EXPRESS_CHECKOUT"],
        legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
      }),
    });
    if (!res.ok) {
      console.error("[paypal] partner-referrals", res.status, JSON.stringify(res.body));
      throw new Error(
        res.body?.message || `PayPal recusou o onboarding do vendedor (${res.status}).`,
      );
    }
    const action = Array.isArray(res.body?.links)
      ? res.body.links.find((l: { rel: string }) => l.rel === "action_url")
      : null;
    if (!action?.href) {
      throw new Error("A PayPal não retornou a URL de onboarding do vendedor.");
    }
    return action.href as string;
  },

  async completeAuthorization({ query, redirectUri }): Promise<ProviderCredentials> {
    const merchantId = String(query.merchantIdInPayPal ?? query.merchant_id ?? "").trim();
    const permissionsGranted = String(query.permissionsGranted ?? "true") === "true";
    if (!merchantId) {
      throw new Error("A PayPal não retornou o Merchant ID do vendedor.");
    }
    if (!permissionsGranted) {
      throw new Error("O vendedor não concedeu as permissões necessárias na PayPal.");
    }

    const { partnerId, partnerAttributionId } = config();
    const token = await platformToken();
    let primaryEmail = "";
    let primaryCurrency: string | null = null;
    let paymentsReceivable = false;
    let capabilities: Record<string, unknown> = {};

    if (token && partnerId) {
      const res = await ppFetch(
        `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations/${encodeURIComponent(merchantId)}`,
        {
          method: "GET",
          token,
          headers: { "PayPal-Partner-Attribution-Id": partnerAttributionId ?? "" },
        },
      );
      if (res.ok && res.body) {
        primaryEmail = res.body.primary_email ?? "";
        primaryCurrency = res.body.primary_currency ?? null;
        paymentsReceivable = !!res.body.payments_receivable;
        capabilities = {
          primary_currency: primaryCurrency,
          payments_receivable: paymentsReceivable,
          primary_email_confirmed: !!res.body.primary_email_confirmed,
          country: res.body.country ?? null,
          product_intent_id: res.body.product_intent_id ?? null,
        };
      }
    }

    return {
      // O fluxo de marketplace não emite token por vendedor: a plataforma age
      // em nome do vendedor com o próprio token + merchant_id.
      accessToken: token ?? "partner-managed",
      refreshToken: null,
      expiresAt: null,
      scopes: ["https://uri.paypal.com/services/payments/payment", "https://uri.paypal.com/services/payments/refund"],
      externalAccountId: merchantId,
      externalAccountLabel: primaryEmail || merchantId,
      merchantId,
      capabilities,
    };
  },

  async refreshCredentials({ current }): Promise<ProviderCredentials> {
    // Token de plataforma (client_credentials): reemite.
    const token = await platformToken();
    if (!token) throw new Error("Falha ao renovar o token da plataforma PayPal.");
    return { ...current, accessToken: token, expiresAt: null };
  },

  async revoke(): Promise<void> {
    // PayPal não expõe revogação programática do vínculo de marketplace.
    // A desconexão remove as credenciais locais (feita pelo router).
  },

  async verifyConnection(credentials: ProviderCredentials) {
    const { partnerId, partnerAttributionId } = config();
    if (!credentials.merchantId) {
      return {
        ok: false,
        externalAccountId: null,
        externalAccountLabel: null,
        merchantId: null,
        capabilities: {},
        reason: "Merchant ID ausente.",
      };
    }
    const token = await platformToken();
    if (!token || !partnerId) {
      return {
        ok: false,
        externalAccountId: credentials.merchantId,
        externalAccountLabel: credentials.externalAccountLabel,
        merchantId: credentials.merchantId,
        capabilities: credentials.capabilities,
        reason: "Credenciais de plataforma indisponíveis.",
      };
    }
    const res = await ppFetch(
      `/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations/${encodeURIComponent(credentials.merchantId)}`,
      {
        method: "GET",
        token,
        headers: { "PayPal-Partner-Attribution-Id": partnerAttributionId ?? "" },
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        externalAccountId: credentials.merchantId,
        externalAccountLabel: credentials.externalAccountLabel,
        merchantId: credentials.merchantId,
        capabilities: credentials.capabilities,
        reason: `PayPal respondeu ${res.status}.`,
      };
    }
    return {
      ok: !!res.body?.payments_receivable,
      externalAccountId: credentials.merchantId,
      externalAccountLabel: res.body?.primary_email ?? credentials.externalAccountLabel,
      merchantId: credentials.merchantId,
      capabilities: {
        primary_currency: res.body?.primary_currency ?? null,
        payments_receivable: !!res.body?.payments_receivable,
        primary_email_confirmed: !!res.body?.primary_email_confirmed,
        country: res.body?.country ?? null,
      },
      reason: res.body?.payments_receivable ? undefined : "A conta ainda não pode receber pagamentos.",
    };
  },

  async createPayment(
    credentials: ProviderCredentials,
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    const token = await platformToken();
    if (!token) throw new Error("Credenciais PayPal indisponíveis.");
    const { partnerAttributionId } = config();
    const merchantId = credentials.merchantId;
    if (!merchantId) throw new Error("Merchant ID do vendedor ausente.");

    const body = buildOrderBody(input, merchantId);

    const res = await ppFetch("/v2/checkout/orders", {
      method: "POST",
      token,
      headers: {
        "PayPal-Partner-Attribution-Id": partnerAttributionId ?? "",
        // Idempotência: repetir a criação do mesmo pedido devolve a mesma ordem.
        "PayPal-Request-Id": `order-${input.orderId}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      console.error("[paypal] create order", res.status, JSON.stringify(res.body));
      throw new Error(res.body?.message || `PayPal recusou a criação do pagamento (${res.status}).`);
    }
    const approve = Array.isArray(res.body?.links)
      ? res.body.links.find((l: { rel: string }) => l.rel === "approve" || l.rel === "payer-action")
      : null;
    return {
      providerPaymentId: res.body?.id ?? null,
      providerOrderId: res.body?.id ?? null,
      status: mapPayPalStatus(res.body?.status),
      providerStatus: res.body?.status ?? null,
      checkoutUrl: approve?.href ?? null,
      raw: res.body ?? {},
    };
  },

  async getPayment(
    _credentials: ProviderCredentials,
    providerPaymentId: string,
  ): Promise<ProviderPaymentSnapshot | null> {
    const token = await platformToken();
    if (!token) return null;
    const res = await ppFetch(`/v2/checkout/orders/${encodeURIComponent(providerPaymentId)}`, {
      method: "GET",
      token,
    });
    if (!res.ok || !res.body) return null;
    return paypalSnapshotFromOrder(res.body, providerPaymentId);
  },

  async resolveNotification(
    _credentials: ProviderCredentials,
    resource: { type: string; id: string },
  ): Promise<NotificationResolution | null> {
    const id = String(resource.id ?? "").trim();
    if (!id) return null;
    const token = await platformToken();
    if (!token) return null;
    const res = await ppFetch(`/v2/checkout/orders/${encodeURIComponent(id)}`, {
      method: "GET",
      token,
    });
    if (!res.ok || !res.body) return null;
    const units = res.body.purchase_units;
    const unit = Array.isArray(units) ? units[0] : null;
    return {
      externalReference: unit?.custom_id ?? unit?.reference_id ?? null,
      providerPaymentId: String(res.body.id ?? id),
      providerStatus: res.body.status ?? null,
    };
  },

  /**
   * Captura a ordem aprovada.
   *
   * Correção da auditoria (C4): a captura existia mas nunca era chamada, então
   * todo pagamento PayPal ficava `authorized` e o dinheiro nunca era capturado.
   * `PayPal-Request-Id` fixo garante que duas capturas concorrentes não gerem
   * duas capturas: a segunda recebe a mesma captura (ou `ORDER_ALREADY_CAPTURED`,
   * tratado como sucesso consultando a ordem).
   */
  async capture(
    _credentials: ProviderCredentials,
    providerPaymentId: string,
  ): Promise<ProviderPaymentSnapshot | null> {
    const token = await platformToken();
    if (!token) return null;
    const res = await ppFetch(
      `/v2/checkout/orders/${encodeURIComponent(providerPaymentId)}/capture`,
      {
        method: "POST",
        token,
        headers: { "PayPal-Request-Id": `capture-${providerPaymentId}` },
        body: JSON.stringify({}),
      },
    );
    if (!res.ok) {
      const issue = String(res.body?.details?.[0]?.issue ?? res.body?.name ?? "");
      if (issue === "ORDER_ALREADY_CAPTURED" || res.status === 422) {
        // Já capturado (retry/duplo clique): devolve o estado real da ordem.
        return paypalProvider.getPayment(_credentials, providerPaymentId);
      }
      console.error("[paypal] capture", res.status, JSON.stringify(res.body));
      return null;
    }
    return paypalSnapshotFromOrder(res.body, providerPaymentId);
  },

  async refund(
    credentials: ProviderCredentials,
    input: RefundInput,
  ): Promise<RefundResult> {
    const token = await platformToken();
    if (!token) throw new Error("Credenciais PayPal indisponíveis.");
    // O id recebido pode ser o capture id. Se não for, busca o capture da order.
    let captureId = input.providerPaymentId;
    if (!captureId.startsWith("CAPTURE-") && !/^[A-Z0-9]{17}$/.test(captureId)) {
      const order = await paypalProvider.getPayment(credentials, input.providerPaymentId);
      const rawCapture = (order?.raw as any)?.purchase_units?.[0]?.payments?.captures?.[0];
      if (rawCapture?.id) captureId = rawCapture.id;
    }
    const amount = providerAmountString(input.amount, input.currency);
    const res = await ppFetch(`/v2/payments/captures/${encodeURIComponent(captureId)}/refunds`, {
      method: "POST",
      token,
      // Mesma chave para o mesmo reembolso → o PayPal devolve o mesmo refund.
      headers: { "PayPal-Request-Id": `refund-${captureId}-${amount}` },
      body: JSON.stringify({
        amount: { value: amount, currency_code: input.currency },
        ...(input.reason ? { note_to_payer: input.reason.slice(0, 255) } : {}),
      }),
    });
    if (!res.ok) {
      console.error("[paypal] refund", res.status, JSON.stringify(res.body));
      throw new Error(res.body?.message || `PayPal recusou o reembolso (${res.status}).`);
    }
    const status = String(res.body?.status ?? "").toUpperCase();
    return {
      providerRefundId: res.body?.id ?? null,
      status: status === "COMPLETED" ? "approved" : status === "FAILED" ? "failed" : "pending",
      amount: Number(res.body?.amount?.value ?? input.amount),
      raw: res.body ?? {},
    };
  },

  async verifyWebhook(request: WebhookRequest): Promise<WebhookVerification> {
    const { webhookId } = config();
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(request.rawBody);
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
    const eventId = String((payload as any).id ?? "");
    const eventType = String((payload as any).event_type ?? "");
    if (!webhookId) {
      return {
        valid: false,
        eventId,
        eventType,
        providerPaymentId: null,
        isTestEvent: false,
        payload,
        reason: "PAYPAL_WEBHOOK_ID não configurado.",
      };
    }
    const token = await platformToken();
    if (!token) {
      return {
        valid: false,
        eventId,
        eventType,
        providerPaymentId: null,
        isTestEvent: false,
        payload,
        reason: "Credenciais de plataforma indisponíveis.",
      };
    }
    const res = await ppFetch("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      token,
      body: JSON.stringify({
        auth_algo: request.headers["paypal-auth-algo"] ?? "",
        cert_url: request.headers["paypal-cert-url"] ?? "",
        transmission_id: request.headers["paypal-transmission-id"] ?? "",
        transmission_sig: request.headers["paypal-transmission-sig"] ?? "",
        transmission_time: request.headers["paypal-transmission-time"] ?? "",
        webhook_id: webhookId,
        webhook_event: payload,
      }),
    });
    const valid = res.ok && res.body?.verification_status === "SUCCESS";
    const resource = (payload as any).resource ?? {};
    const relatedOrderId =
      resource?.supplementary_data?.related_ids?.order_id ??
      (eventType.startsWith("CHECKOUT.ORDER") ? resource?.id : null);
    return {
      valid,
      eventId,
      eventType,
      providerPaymentId: relatedOrderId ?? resource?.id ?? null,
      isTestEvent: false,
      payload,
      ...(valid ? {} : { reason: "Assinatura do webhook inválida." }),
    };
  },
};
