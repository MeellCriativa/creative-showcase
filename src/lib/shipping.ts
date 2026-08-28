import { supabase } from "@/integrations/supabase/client";

export type ShippingQuoteRequest = {
  originZip: string;
  destinationZip: string;
  items: {
    weight_grams: number | null;
    length_cm: number | null;
    width_cm: number | null;
    height_cm: number | null;
    quantity: number;
  }[];
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

export async function quoteShipping(
  request: ShippingQuoteRequest,
): Promise<{ success: boolean; quotes?: unknown[]; error?: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${META_FUNCTIONS_URL}/quote-shipping`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    return { success: false, error: data.error || "Não foi possível calcular o frete" };
  }
  return data;
}
