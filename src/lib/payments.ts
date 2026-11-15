import { supabase } from "@/integrations/supabase/client";

/**
 * Cliente da camada de pagamentos (Etapa 2).
 *
 * Nenhum token de provedor chega ao navegador: as respostas trazem apenas
 * identificadores mascarados, status e capacidades. Toda criação de pedido e
 * pagamento acontece no backend, que recalcula preços e frete.
 */

export const PAYMENTS_FUNCTIONS_URL = `${import.meta.env["VITE_SUPABASE_URL"]}/functions/v1`;

export type PaymentProviderKey = "paypal" | "mercadopago";

export type PaymentConnectionStatus = "pending" | "connected" | "expired" | "revoked" | "error";

export type PaymentConnectionView = {
  provider: PaymentProviderKey;
  label: string;
  configured: boolean;
  connected: boolean;
  enabled: boolean;
  status: PaymentConnectionStatus;
  environment: string;
  accountIdMasked: string | null;
  accountLabel: string | null;
  currency: string | null;
  currencySupported: boolean;
  currencyMessage: string | null;
  capabilities: Record<string, unknown>;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  needsReconnect: boolean;
  setupMessage: string | null;
};

export type PublicPaymentMethod = {
  provider: PaymentProviderKey;
  label: string;
  currency: string;
};

export type PaymentTransaction = {
  id: string;
  order_id: string;
  provider: PaymentProviderKey;
  status: string;
  currency: string;
  amount: number;
  captured_amount: number;
  refunded_amount: number;
  created_at: string;
  updated_at: string;
};

export type ApiResult<T> = T & { success: boolean; error?: string; code?: string };

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${session?.access_token ?? ""}`,
    apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
    "Content-Type": "application/json",
  };
}

async function call<T>(
  action: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown>; query?: Record<string, string>; auth?: boolean } = {},
): Promise<ApiResult<T>> {
  const method = options.method ?? "POST";
  const params = new URLSearchParams({ action, ...(options.query ?? {}) });
  const headers = options.auth === false
    ? {
        apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
        "Content-Type": "application/json",
      }
    : await authHeaders();

  let res: Response;
  try {
    res = await fetch(`${PAYMENTS_FUNCTIONS_URL}/payments?${params.toString()}`, {
      method,
      headers,
      ...(method === "POST" ? { body: JSON.stringify(options.body ?? {}) } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[payments] fetch falhou (${action}):`, error);
    return { success: false, error: `Erro de rede ao chamar o servidor. (${message})` } as ApiResult<T>;
  }

  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    return {
      success: false,
      error: `Resposta inválida do servidor (status ${res.status}).`,
    } as ApiResult<T>;
  }

  if (!res.ok || data["success"] === false) {
    return {
      success: false,
      error: String(data["error"] ?? `Falha na operação (status ${res.status}).`),
      code: data["code"] ? String(data["code"]) : undefined,
      ...data,
    } as ApiResult<T>;
  }
  return data as ApiResult<T>;
}

/* ── Comprador (público) ─────────────────────────────────────────────── */

export type MethodsResult = {
  catalog_id: string;
  currency: string;
  methods: PublicPaymentMethod[];
};

export function listPaymentMethods(input: { catalogId?: string; slug?: string }) {
  return call<MethodsResult>("methods", {
    method: "GET",
    auth: false,
    query: {
      ...(input.catalogId ? { catalog_id: input.catalogId } : {}),
      ...(input.slug ? { slug: input.slug } : {}),
    },
  });
}

export type CreateOrderItem = {
  product_id: string;
  quantity: number;
  variation?: string | null;
};

export type CreateOrderResult = {
  order_id: string;
  checkout_token: string;
  currency: string;
  subtotal: number;
  shipping_cost: number;
  total: number;
  items: Array<Record<string, unknown>>;
  store: { id: string; slug: string; storeName: string; whatsapp: string | null };
  payment_methods: PublicPaymentMethod[];
};

export function createSecureOrder(input: {
  catalogId: string;
  customerName: string;
  customerPhone?: string | null;
  note?: string | null;
  items: CreateOrderItem[];
  deliveryMethod?: string | null;
  shippingZip?: string | null;
  shippingService?: string | null;
  address?: Record<string, string | null> | null;
}) {
  return call<CreateOrderResult>("create_order", {
    auth: false,
    body: {
      catalog_id: input.catalogId,
      customer_name: input.customerName,
      customer_phone: input.customerPhone ?? null,
      note: input.note ?? null,
      items: input.items,
      delivery_method: input.deliveryMethod ?? null,
      shipping_zip: input.shippingZip ?? null,
      shipping_service: input.shippingService ?? null,
      address: input.address ?? null,
    },
  });
}

export type CreatePaymentResult = {
  provider: PaymentProviderKey;
  checkout_url: string;
  transaction_id: string | null;
  status: string;
  currency: string;
  total: number;
};

export function createPayment(input: {
  orderId: string;
  checkoutToken: string;
  provider: PaymentProviderKey;
  returnUrl?: string;
  cancelUrl?: string;
}) {
  return call<CreatePaymentResult>("create_payment", {
    auth: false,
    body: {
      order_id: input.orderId,
      checkout_token: input.checkoutToken,
      provider: input.provider,
      ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
      ...(input.cancelUrl ? { cancel_url: input.cancelUrl } : {}),
    },
  });
}

export type PaymentStatusResult = {
  order_id: string;
  total: number;
  currency: string;
  payment_status: string;
  payment_provider: PaymentProviderKey | null;
};

export function getPaymentStatus(input: { orderId: string; checkoutToken: string }) {
  return call<PaymentStatusResult>("payment_status", {
    method: "GET",
    auth: false,
    query: { order_id: input.orderId, token: input.checkoutToken },
  });
}

/* ── Vendedor (autenticado) ──────────────────────────────────────────── */

export type ProviderStatusResult = {
  currency: string;
  encryption_configured: boolean;
  environment: string;
  providers: PaymentConnectionView[];
};

export function getProviderStatus(catalogId: string) {
  return call<ProviderStatusResult>("status", {
    method: "GET",
    query: { catalog_id: catalogId },
  });
}

export function connectProvider(catalogId: string, provider: PaymentProviderKey) {
  return call<{ url: string; provider: PaymentProviderKey }>("connect", {
    body: { catalog_id: catalogId, provider },
  });
}

export function disconnectProvider(catalogId: string, provider: PaymentProviderKey) {
  return call<Record<string, never>>("disconnect", {
    body: { catalog_id: catalogId, provider },
  });
}

export function verifyProvider(catalogId: string, provider: PaymentProviderKey) {
  return call<{ verified: boolean; connection?: PaymentConnectionView }>("verify", {
    body: { catalog_id: catalogId, provider },
  });
}

export function setProviderEnabled(
  catalogId: string,
  provider: PaymentProviderKey,
  enabled: boolean,
) {
  return call<{ connection: PaymentConnectionView }>("set_enabled", {
    body: { catalog_id: catalogId, provider, enabled },
  });
}

export function listTransactions(catalogId: string) {
  return call<{ transactions: PaymentTransaction[] }>("transactions", {
    method: "GET",
    query: { catalog_id: catalogId },
  });
}

export function refundTransaction(input: {
  transactionId: string;
  amount?: number;
  reason?: string;
}) {
  return call<{ status: string; amount: number; provider_refund_id: string | null }>("refund", {
    body: {
      transaction_id: input.transactionId,
      ...(input.amount === undefined ? {} : { amount: input.amount }),
      ...(input.reason ? { reason: input.reason } : {}),
    },
  });
}

export function refreshPayment(transactionId: string) {
  return call<{
    status: string;
    provider_status: string | null;
    captured_amount: number;
    refunded_amount: number;
    amount: number;
    currency: string;
  }>("refresh_payment", {
    body: { transaction_id: transactionId },
  });
}

export const PROVIDER_LABELS: Record<PaymentProviderKey, string> = {
  paypal: "PayPal",
  mercadopago: "Mercado Pago",
};

export function describePaymentStatus(status: string): string {
  switch (status) {
    case "pending":
      return "Aguardando pagamento";
    case "approved":
      return "Aprovado";
    case "authorized":
      return "Autorizado";
    case "captured":
      return "Pago";
    case "failed":
      return "Recusado";
    case "cancelled":
      return "Cancelado";
    case "refunded":
      return "Reembolsado";
    case "partially_refunded":
      return "Reembolsado parcialmente";
    case "disputed":
      return "Em disputa";
    default:
      return status;
  }
}
