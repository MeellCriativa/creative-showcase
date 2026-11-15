/**
 * Webhook do PayPal (endpoint independente).
 *
 * Valida a assinatura com a API oficial `/v1/notifications/verify-webhook-signature`
 * (usando PAYPAL_WEBHOOK_ID) antes de qualquer efeito. Idempotência por
 * (provider, event_id) e confirmação do pagamento sempre via API oficial.
 *
 * Deploy: esta função precisa de `verify_jwt = false` (o PayPal não envia JWT
 * do Supabase). Nada é simulado quando as credenciais estão ausentes.
 */
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { handleWebhook } from "../_shared/payments/webhooks.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (req.method !== "POST") {
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
      provider: "paypal",
      request: { headers, rawBody, query },
    });

    return new Response(JSON.stringify(outcome.body), {
      status: outcome.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[webhooks-paypal]", error);
    return new Response(JSON.stringify({ success: false, error: "internal_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
