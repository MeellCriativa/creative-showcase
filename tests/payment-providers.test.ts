import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  PROVIDERS,
  PROVIDER_KEYS,
  getProvider,
  isProviderKey,
  providerEnvironment,
  providerLabel,
} from "../supabase/functions/_shared/payments/index.ts";
import { mapPayPalStatus, paypalProvider } from "../supabase/functions/_shared/payments/paypal.ts";
import {
  mapMercadoPagoStatus,
  mercadopagoProvider,
} from "../supabase/functions/_shared/payments/mercadopago.ts";
import { PAYMENT_STATUSES } from "../supabase/functions/_shared/payments/types.ts";

/**
 * Contratos dos provedores (Etapa 2).
 *
 * Nada é simulado: sem credenciais reais, `isConfigured()` é false e os
 * webhooks recusam eventos. A aprovação comercial do PayPal não é fabricada.
 */

/** Executa `fn` com um `Deno.env` falso e restaura o global depois. */
function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const global = globalThis as unknown as { Deno?: unknown };
  const had = Object.prototype.hasOwnProperty.call(global, "Deno");
  const previous = global.Deno;
  global.Deno = { env: { get: (key: string) => vars[key] } };
  try {
    return fn();
  } finally {
    if (had) global.Deno = previous;
    else delete global.Deno;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Registro de provedores
// ─────────────────────────────────────────────────────────────────────────────

test("registro expõe exatamente PayPal e Mercado Pago", () => {
  assert.deepEqual([...PROVIDER_KEYS], ["paypal", "mercadopago"]);
  assert.deepEqual(Object.keys(PROVIDERS).sort(), ["mercadopago", "paypal"]);
});

test("cada provedor é identificado pela própria chave", () => {
  for (const key of PROVIDER_KEYS) {
    assert.equal(PROVIDERS[key].key, key);
  }
});

test("rótulos são os nomes comerciais", () => {
  assert.equal(providerLabel("paypal"), "PayPal");
  assert.equal(providerLabel("mercadopago"), "Mercado Pago");
  assert.equal(paypalProvider.label, "PayPal");
  assert.equal(mercadopagoProvider.label, "Mercado Pago");
});

test("isProviderKey só aceita os provedores implementados", () => {
  assert.equal(isProviderKey("paypal"), true);
  assert.equal(isProviderKey("mercadopago"), true);
  assert.equal(isProviderKey("stripe"), false);
  assert.equal(isProviderKey(""), false);
  assert.equal(isProviderKey(null), false);
  assert.equal(isProviderKey(undefined), false);
  assert.equal(isProviderKey(123), false);
});

test("getProvider devolve a implementação ou null", () => {
  assert.equal(getProvider("paypal"), paypalProvider);
  assert.equal(getProvider("mercadopago"), mercadopagoProvider);
  assert.equal(getProvider("cakto"), null);
  assert.equal(getProvider(null), null);
});

test("todos os provedores implementam a interface completa", () => {
  const required = [
    "isConfigured",
    "setupMessage",
    "buildAuthorizeUrl",
    "completeAuthorization",
    "refreshCredentials",
    "revoke",
    "verifyConnection",
    "createPayment",
    "getPayment",
    "capture",
    "refund",
    "verifyWebhook",
  ] as const;
  for (const key of PROVIDER_KEYS) {
    for (const method of required) {
      assert.equal(
        typeof (PROVIDERS[key] as unknown as Record<string, unknown>)[method],
        "function",
        `${key} não implementa ${method}`,
      );
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Configuração — nunca "aprovado" sem credenciais/habilitação
// ─────────────────────────────────────────────────────────────────────────────

test("sem variáveis de ambiente, nenhum provedor está configurado", () => {
  assert.equal(paypalProvider.isConfigured(), false);
  assert.equal(mercadopagoProvider.isConfigured(), false);
});

test("mensagem de setup explica a ausência de credenciais", () => {
  assert.match(paypalProvider.setupMessage() ?? "", /PayPal/);
  assert.match(mercadopagoProvider.setupMessage() ?? "", /Mercado Pago/);
});

test("PayPal com credenciais mas SEM Partner ID continua não configurado", () => {
  const configured = withEnv(
    { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" },
    () => paypalProvider.isConfigured(),
  );
  assert.equal(configured, false, "sem aprovação comercial não pode ficar configurado");

  const message = withEnv(
    { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret" },
    () => paypalProvider.setupMessage(),
  );
  assert.match(message ?? "", /aprovação comercial|Partner ID/i);
});

test("PayPal exige Client ID + Secret + Partner ID + Webhook ID", () => {
  const base = {
    PAYPAL_CLIENT_ID: "id",
    PAYPAL_CLIENT_SECRET: "secret",
    PAYPAL_PARTNER_ID: "PARTNER-123",
  };
  assert.equal(withEnv(base, () => paypalProvider.isConfigured()), false);
  assert.match(withEnv(base, () => paypalProvider.setupMessage()) ?? "", /webhook/i);

  const complete = { ...base, PAYPAL_WEBHOOK_ID: "WEBHOOK-123" };
  assert.equal(withEnv(complete, () => paypalProvider.isConfigured()), true);
  assert.equal(withEnv(complete, () => paypalProvider.setupMessage()), null);
});

test("Mercado Pago fica configurado com Client ID + Secret", () => {
  assert.equal(
    withEnv(
      { MP_CLIENT_ID: "id", MP_CLIENT_SECRET: "secret" },
      () => mercadopagoProvider.isConfigured(),
    ),
    true,
  );
  assert.equal(
    withEnv(
      { MP_CLIENT_ID: "id", MP_CLIENT_SECRET: "secret" },
      () => mercadopagoProvider.setupMessage(),
    ),
    null,
  );
  assert.equal(
    withEnv({ MP_CLIENT_ID: "id" }, () => mercadopagoProvider.isConfigured()),
    false,
  );
});

test("ambiente é sandbox por padrão e produção só com opt-in explícito", () => {
  assert.equal(providerEnvironment("paypal"), "sandbox");
  assert.equal(providerEnvironment("mercadopago"), "sandbox");
  assert.equal(
    withEnv({ PAYPAL_ENV: "production" }, () => providerEnvironment("paypal")),
    "production",
  );
  assert.equal(
    withEnv({ MP_ENV: "production" }, () => providerEnvironment("mercadopago")),
    "production",
  );
  assert.equal(
    withEnv({ PAYPAL_ENV: "qualquer" }, () => providerEnvironment("paypal")),
    "sandbox",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Mapas de status (estados mínimos)
// ─────────────────────────────────────────────────────────────────────────────

test("estados mínimos exigidos estão declarados", () => {
  assert.deepEqual([...PAYMENT_STATUSES], [
    "pending",
    "approved",
    "authorized",
    "captured",
    "failed",
    "cancelled",
    "refunded",
    "partially_refunded",
    "disputed",
  ]);
});

test("mapa do PayPal cobre os estados do Orders/Payments API", () => {
  const cases: Array<[string, string]> = [
    ["COMPLETED", "captured"],
    ["APPROVED", "authorized"],
    ["CREATED", "pending"],
    ["SAVED", "pending"],
    ["PAYER_ACTION_REQUIRED", "pending"],
    ["VOIDED", "cancelled"],
    ["DECLINED", "failed"],
    ["FAILED", "failed"],
    ["REFUNDED", "refunded"],
    ["PARTIALLY_REFUNDED", "partially_refunded"],
    ["DISPUTED", "disputed"],
    ["CHARGEBACK", "disputed"],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(mapPayPalStatus(raw), expected, `PayPal ${raw}`);
  }
});

test("mapa do PayPal normaliza caixa e trata desconhecido como pending", () => {
  assert.equal(mapPayPalStatus("completed"), "captured");
  assert.equal(mapPayPalStatus("REFUNDED"), "refunded");
  assert.equal(mapPayPalStatus(null), "pending");
  assert.equal(mapPayPalStatus(undefined), "pending");
  assert.equal(mapPayPalStatus("ALGO_NOVO"), "pending");
});

test("mapa do Mercado Pago cobre os status de pagamento", () => {
  assert.equal(mapMercadoPagoStatus("approved"), "captured");
  assert.equal(mapMercadoPagoStatus("authorized"), "authorized");
  assert.equal(mapMercadoPagoStatus("in_process"), "pending");
  assert.equal(mapMercadoPagoStatus("pending"), "pending");
  assert.equal(mapMercadoPagoStatus("rejected"), "failed");
  assert.equal(mapMercadoPagoStatus("cancelled"), "cancelled");
  assert.equal(mapMercadoPagoStatus("refunded"), "refunded");
  assert.equal(mapMercadoPagoStatus("charged_back"), "disputed");
  assert.equal(mapMercadoPagoStatus("APPROVED"), "captured");
  assert.equal(mapMercadoPagoStatus(null), "pending");
});

test("reembolso parcial/total é derivado dos valores do Mercado Pago", () => {
  assert.equal(mapMercadoPagoStatus("approved", 0, 100), "captured");
  assert.equal(mapMercadoPagoStatus("approved", 30, 100), "partially_refunded");
  assert.equal(mapMercadoPagoStatus("approved", 100, 100), "refunded");
  assert.equal(mapMercadoPagoStatus("approved", 100, 0), "captured");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Webhooks — assinatura oficial antes de qualquer efeito
// ─────────────────────────────────────────────────────────────────────────────

test("PayPal recusa payload inválido antes de qualquer chamada de rede", async () => {
  const result = await paypalProvider.verifyWebhook({
    headers: {},
    rawBody: "não é json",
    query: {},
  });
  assert.equal(result.valid, false);
  assert.equal(result.isTestEvent, false);
  assert.match(result.reason ?? "", /Payload inválido/);
});

test("PayPal sem PAYPAL_WEBHOOK_ID recusa o evento", async () => {
  const result = await paypalProvider.verifyWebhook({
    headers: {},
    rawBody: JSON.stringify({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED" }),
    query: {},
  });
  assert.equal(result.valid, false);
  assert.equal(result.eventId, "WH-1");
  assert.equal(result.eventType, "PAYMENT.CAPTURE.COMPLETED");
  assert.match(result.reason ?? "", /PAYPAL_WEBHOOK_ID/);
});

test("Mercado Pago recusa payload inválido", async () => {
  const result = await mercadopagoProvider.verifyWebhook({
    headers: {},
    rawBody: "{quebrado",
    query: {},
  });
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /Payload inválido/);
});

test("Mercado Pago sem MP_WEBHOOK_SECRET recusa o evento", async () => {
  const result = await mercadopagoProvider.verifyWebhook({
    headers: {},
    rawBody: JSON.stringify({ type: "payment", data: { id: "123" } }),
    query: {},
  });
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /MERCADOPAGO_WEBHOOK_SECRET/);
});

/** Monta um `x-signature` válido exatamente como o Mercado Pago envia. */
function mpSignature(secret: string, dataId: string, requestId: string, ts: string): string {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

test("Mercado Pago aceita assinatura HMAC válida de pagamento", async () => {
  const secret = "segredo-de-teste-mp";
  const ts = String(Math.floor(Date.now() / 1000));
  const requestId = "req-1";
  const dataId = "ABC123";
  const result = await withEnv({ MP_WEBHOOK_SECRET: secret }, () =>
    mercadopagoProvider.verifyWebhook({
      headers: {
        "x-signature": mpSignature(secret, dataId, requestId, ts),
        "x-request-id": requestId,
      },
      rawBody: JSON.stringify({ type: "payment", action: "payment.created", data: { id: dataId } }),
      query: {},
    }),
  );
  assert.equal(result.valid, true);
  assert.equal(result.isTestEvent, false);
  assert.equal(result.providerPaymentId, dataId);
  assert.equal(result.eventId, `payment:${dataId}:req-1`);
});

test("Mercado Pago recusa assinatura inválida (não confia no corpo)", async () => {
  const secret = "segredo-de-teste-mp";
  const result = await withEnv({ MP_WEBHOOK_SECRET: secret }, () =>
    mercadopagoProvider.verifyWebhook({
      headers: {
        "x-signature": mpSignature("outro-segredo", "ABC123", "req-1", String(Math.floor(Date.now() / 1000))),
        "x-request-id": "req-1",
      },
      rawBody: JSON.stringify({ type: "payment", data: { id: "ABC123" } }),
      query: {},
    }),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /Assinatura do webhook inválida/);
});

test("Mercado Pago recusa quando a assinatura está ausente", async () => {
  const result = await withEnv({ MP_WEBHOOK_SECRET: "s" }, () =>
    mercadopagoProvider.verifyWebhook({
      headers: {},
      rawBody: JSON.stringify({ type: "payment", data: { id: "ABC123" } }),
      query: {},
    }),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /Assinatura ausente/);
});

test("Mercado Pago aceita notificação apenas por query string (IPN)", async () => {
  const secret = "segredo-de-teste-mp";
  const result = await withEnv({ MP_WEBHOOK_SECRET: secret }, () =>
    mercadopagoProvider.verifyWebhook({
      headers: {
        "x-signature": mpSignature(secret, "999", "req-2", String(Math.floor(Date.now() / 1000))),
        "x-request-id": "req-2",
      },
      rawBody: "",
      query: { topic: "payment", id: "999" },
    }),
  );
  assert.equal(result.valid, true);
  assert.equal(result.providerPaymentId, "999");
  assert.equal(result.eventType, "payment");
});

test("evento que não é de pagamento é sinalizado como ignorável", async () => {
  const secret = "segredo-de-teste-mp";
  const result = await withEnv({ MP_WEBHOOK_SECRET: secret }, () =>
    mercadopagoProvider.verifyWebhook({
      headers: {
        "x-signature": mpSignature(secret, "evt-1", "req-3", String(Math.floor(Date.now() / 1000))),
        "x-request-id": "req-3",
      },
      rawBody: JSON.stringify({ type: "test", data: { id: "evt-1" } }),
      query: {},
    }),
  );
  // Assinatura válida, mas o evento não é de pagamento → sem efeito financeiro.
  assert.equal(result.valid, true);
  assert.equal(result.isTestEvent, true);
  assert.equal(result.providerPaymentId, null);
});

test("merchant_order válido não é tratado como pagamento", async () => {
  const secret = "segredo-de-teste-mp";
  const result = await withEnv({ MP_WEBHOOK_SECRET: secret }, () =>
    mercadopagoProvider.verifyWebhook({
      headers: {
        "x-signature": mpSignature(secret, "ord-1", "req-4", String(Math.floor(Date.now() / 1000))),
        "x-request-id": "req-4",
      },
      rawBody: JSON.stringify({ type: "merchant_order", data: { id: "ord-1" } }),
      query: {},
    }),
  );
  assert.equal(result.valid, true);
  assert.equal(result.eventType, "merchant_order");
  // Sem id de pagamento, o handler responde 200 sem alterar pedido/transação.
  assert.equal(result.providerPaymentId, null);
});

test("evento de pagamento com assinatura inválida continua recusado", async () => {
  const secret = "segredo-de-teste-mp";
  const result = await withEnv({ MP_WEBHOOK_SECRET: secret }, () =>
    mercadopagoProvider.verifyWebhook({
      headers: {
        "x-signature": mpSignature(secret, "ord-1", "req-3", String(Math.floor(Date.now() / 1000))),
        "x-request-id": "req-3",
      },
      rawBody: JSON.stringify({ type: "payment", data: { id: "OUTRO-ID" } }),
      query: {},
    }),
  );
  assert.equal(result.valid, false);
  assert.equal(result.isTestEvent, false);
});
