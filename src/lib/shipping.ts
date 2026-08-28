import { supabase } from "@/integrations/supabase/client";

export type ShippingQuoteItem = {
  key?: string;
  product_type?: "fisico" | "digital" | null;
  weight_grams: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  quantity: number;
  unit_price?: number;
};

export type MelhorEnvioQuote = {
  serviceId: string;
  name: string;
  price: number;
  delivery_min: number | null;
  delivery_max: number | null;
  delivery_text: string | null;
  agencyRequired: boolean;
  agency?: unknown;
  company?: unknown;
  collect: boolean;
};

export const META_FUNCTIONS_URL =
  `${import.meta.env["VITE_SUPABASE_URL"]}/functions/v1`;

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${session?.access_token ?? ""}`,
    apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
    "Content-Type": "application/json" as const,
  };
}

export type QuoteResult = {
  success: boolean;
  quotes?: MelhorEnvioQuote[];
  error?: string;
  error_type?: string;
  http_status?: number;
  message?: string;
  environment?: string;
  coverage?: string[];
  coverage_message?: string;
};

export async function quoteShipping(opts: {
  catalogId: string;
  destinationZip: string;
  items: ShippingQuoteItem[];
}): Promise<QuoteResult> {
  const headers = await authHeaders();
  const res = await fetch(
    `${META_FUNCTIONS_URL}/melhor-envio?action=quote`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        catalog_id: opts.catalogId,
        destination_zip: opts.destinationZip,
        items: opts.items.map((i) => ({
          id: i.key ?? "x",
          product_type: i.product_type ?? null,
          weight_grams: i.weight_grams ?? null,
          length_cm: i.length_cm ?? null,
          width_cm: i.width_cm ?? null,
          height_cm: i.height_cm ?? null,
          quantity: i.quantity,
          unit_price: i.unit_price ?? 0,
        })),
      }),
    },
  );
  const data = await res.json();
  if (data.error && data.error !== "not_connected" && data.error !== "no_origin") {
    return {
      success: false,
      error: data.error,
      error_type: data.error_type,
      http_status: data.http_status,
      message: data.message,
      environment: data.environment,
      coverage: data.coverage,
      coverage_message: data.coverage_message,
    };
  }
  if (!data.success) {
    return {
      success: false,
      error: data.error || data.message || "Não foi possível calcular o frete",
      error_type: data.error_type,
      http_status: data.http_status,
      message: data.message,
      environment: data.environment,
      coverage: data.coverage,
      coverage_message: data.coverage_message,
    };
  }
  return data as QuoteResult;
}

/* ── Admin / Melhor Envio helper calls ───────────────────────────── */

export type MEStatusResult = {
  success: boolean;
  error?: string;
  connected?: boolean;
  environment?: string;
  configured?: boolean;
  connectUrl?: string | null;
  sender?: {
    name: string;
    document: string;
    phone: string;
    email: string;
    street: string;
    number: string;
    complement: string;
    district: string;
    city: string;
    state: string;
    zip: string;
    complete: boolean;
  } | null;
};

export type MEConnectResult = { success: boolean; error?: string; url?: string };
export type MEStockResult = { success: boolean; error?: string; me_order_id?: string | null; data?: unknown };
export type MEProtocolResult = { success: boolean; error?: string; me_protocol?: string | null; data?: unknown };
export type MEPrintResult = { success: boolean; error?: string; url?: string | null; data?: unknown };
export type MEConstResult = { success: boolean; error?: string };

async function meCall<T>(
  action: string,
  body: Record<string, unknown>,
): Promise<T & { success: boolean; error?: string }> {
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetch(`${META_FUNCTIONS_URL}/melhor-envio?action=${action}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[melhor-envio] fetch falhou (${action}):`, err);
    return { success: false, error: `Erro de rede ao chamar o servidor. (${msg})` } as T & {
      success: boolean;
      error?: string;
    };
  }
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[melhor-envio] resposta inválida (${action}) status ${res.status}:`, err);
    return { success: false, error: `Resposta inválida do servidor (status ${res.status}).` } as T & {
      success: boolean;
      error?: string;
    };
  }
  if (data.error && typeof data.error === "string" && data.error !== "not_connected") {
    return { success: false, error: data.error, ...data } as T & { success: boolean; error?: string };
  }
  return data as T & { success: boolean; error?: string };
}

export const meApi = {
  status: (catalogId: string): Promise<MEStatusResult> =>
    meCall<MEStatusResult>("status", { catalog_id: catalogId }),
  connect: (catalogId: string): Promise<MEConnectResult> =>
    meCall<MEConnectResult>("connect", { catalog_id: catalogId }),
  disconnect: (catalogId: string): Promise<MEConstResult> =>
    meCall<MEConstResult>("disconnect", { catalog_id: catalogId }),
  saveSender: (catalogId: string, sender: Record<string, unknown>): Promise<MEStatusResult> =>
    meCall<MEStatusResult>("save_sender", { catalog_id: catalogId, ...sender }),
  cart: (catalogId: string, payload: Record<string, unknown>): Promise<MEStockResult> =>
    meCall<MEStockResult>("cart", { catalog_id: catalogId, ...payload }),
  checkout: (catalogId: string, meOrderId: string): Promise<MEProtocolResult> =>
    meCall<MEProtocolResult>("checkout", { catalog_id: catalogId, me_order_id: meOrderId }),
  generate: (catalogId: string, meOrderId: string): Promise<MEProtocolResult> =>
    meCall<MEProtocolResult>("generate", { catalog_id: catalogId, me_order_id: meOrderId }),
  print: (catalogId: string, meOrderId: string): Promise<MEPrintResult> =>
    meCall<MEPrintResult>("print", { catalog_id: catalogId, me_order_id: meOrderId }),
  tracking: (catalogId: string, meOrderId: string): Promise<MEConstResult> =>
    meCall<MEConstResult>("tracking", { catalog_id: catalogId, me_order_id: meOrderId }),
  agencies: (catalogId: string, query: Record<string, string>): Promise<MEConstResult> =>
    meCall<MEConstResult>("agencies", { catalog_id: catalogId, ...query }),
};
