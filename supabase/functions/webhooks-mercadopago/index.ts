/**
 * Webhook do Mercado Pago (endpoint independente).
 *
 * Valida a assinatura `x-signature` (HMAC-SHA256 do manifest
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com
 * MERCADOPAGO_WEBHOOK_SECRET)
 * antes de qualquer efeito. Idempotência por (provider, event_id) e
 * confirmação do pagamento sempre via `GET /v1/payments/{id}`.
 *
 * Deploy: esta função precisa de `verify_jwt = false`.
 */
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { handleWebhook } from "../_shared/payments/webhooks.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const rawBody = await req.text();
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const query: Record<string, string> = {};
    new URL(req.url).searchParams.forEach((value, key) => {
      query[key] = value;
    });

    const outcome = await handleWebhook({
      provider: "mercadopago",
      request: { headers, rawBody, query },
    });

    return new Response(JSON.stringify(outcome.body), {
      status: outcome.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[webhooks-mercadopago]", error);
    return new Response(JSON.stringify({ success: false, error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
