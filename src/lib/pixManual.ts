/** Cliente da Edge Function de Pix manual (homologação/produção via runtime). */

import { PAYMENTS_FUNCTIONS_URL } from "./payments";
import { supabase } from "@/integrations/supabase/client";

export type PixPublicConfig = {
  success: boolean;
  available: boolean;
  mode: "key" | "qr" | "both";
  keyType: string | null;
  keyValue: string | null;
  holderName: string | null;
  qrName: string | null;
  qrUrl: string | null;
  error?: string;
};

export type PixOrderResult = {
  success: boolean;
  order_id: string;
  checkout_token: string;
  currency: string;
  subtotal: number;
  total: number;
  shipping_cost: number;
  items: Array<Record<string, unknown>>;
  pix: PixPublicConfig;
  error?: string;
};

async function callPix<T>(action: string, body: Record<string, unknown> = {}, auth = false): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
  };
  if (auth) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  }
  const response = await fetch(`${PAYMENTS_FUNCTIONS_URL}/pix-manual?action=${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok && !("error" in (payload as Record<string, unknown>))) {
    return { success: false, error: `HTTP ${response.status}` } as T;
  }
  return payload;
}

export function getPixConfig(input: { slug?: string; catalogId?: string }) {
  return callPix<PixPublicConfig>("config", {
    ...(input.slug ? { slug: input.slug } : {}),
    ...(input.catalogId ? { catalog_id: input.catalogId } : {}),
  });
}

export function createPixOrder(input: {
  catalogId: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  note?: string | null;
  items: Array<Record<string, unknown>>;
  deliveryMethod?: string | null;
  shippingZip?: string | null;
  shippingService?: string | null;
  address?: Record<string, string | null> | null;
}) {
  return callPix<PixOrderResult>("create_order", {
    catalog_id: input.catalogId,
    customer_name: input.customerName,
    customer_phone: input.customerPhone ?? null,
    customer_email: input.customerEmail ?? null,
    note: input.note ?? null,
    items: input.items,
    delivery_method: input.deliveryMethod ?? null,
    shipping_zip: input.shippingZip ?? null,
    shipping_service: input.shippingService ?? null,
    address: input.address ?? null,
  });
}

export function declarePixPaid(orderId: string, checkoutToken: string) {
  return callPix<{ success: boolean; payment_status?: string; message?: string; error?: string }>(
    "declare_paid",
    { order_id: orderId, checkout_token: checkoutToken },
  );
}

export function getPixOrderStatus(orderId: string, checkoutToken: string) {
  return callPix<{
    success: boolean;
    payment_status?: string;
    pix_declared_at?: string | null;
    pix_confirmed_at?: string | null;
    error?: string;
  }>("status", { order_id: orderId, checkout_token: checkoutToken });
}

export function confirmPixPayment(orderId: string) {
  return callPix<{ success: boolean; error?: string }>("confirm", { order_id: orderId }, true);
}
