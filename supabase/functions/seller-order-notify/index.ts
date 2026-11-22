/**
 * Dispara a notificação de novo pedido ao vendedor de forma best-effort.
 *
 * Usado pelo caminho de fallback em que o navegador insere o pedido
 * diretamente (quando o backend de pagamentos não está disponível).
 * A reserva atômica `claim_seller_order_email` impede disparos duplicados.
 */
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/payments/db.ts";
import { notifySellerNewOrder } from "../_shared/seller_notifications.ts";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let orderId = String(body.orderId ?? body.order_id ?? "").trim();
    if (!orderId) {
      const catalogId = String(body.catalog_id ?? body.catalogId ?? "").trim();
      const customerName = String(body.customer_name ?? body.customerName ?? "").trim();
      if (!UUID.test(catalogId) || !customerName) {
        return json({ ok: false, error: "invalid_request" }, 400);
      }
      // Caminho do insert anônimo: o navegador não tem SELECT em orders.
      const db = adminClient();
      const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recent } = await db
        .from("orders")
        .select("id")
        .eq("catalog_id", catalogId)
        .eq("customer_name", customerName)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      orderId = String(recent?.id ?? "");
    }
    if (!UUID.test(orderId)) return json({ ok: false, error: "order_not_found" }, 404);

    await notifySellerNewOrder(orderId);
    return json({ ok: true });
  } catch (error) {
    console.error("[seller-order-notify]", error);
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
