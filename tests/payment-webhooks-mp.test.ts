import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  eventDecision,
  eventKeyFor,
  paymentIdForLookup,
} from "../supabase/functions/_shared/payments/lifecycle.ts";
import { mercadopagoProvider } from "../supabase/functions/_shared/payments/mercadopago.ts";
import {
  notificationResource,
  resolveTransaction,
} from "../supabase/functions/_shared/payments/resolution.ts";

/**
 * Webhook do Mercado Pago (auditoria C1, C2, C6, A1, A2).
 *
 * O fixture abaixo é o corpo real de uma notificação de pagamento do Checkout
 * Pro (`{ type: "payment", data: { id } }`). A assinatura é reconstruída com o
 * mesmo manifest que o Mercado Pago usa:
 *
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * O ponto central do teste: o `id` notificado é o do PAGAMENTO, enquanto a
 * transação guarda a PREFERÊNCIA — a resolução precisa consultar a API oficial.
 */

const WEBHOOK_SECRET = "mp-webhook-secret-de-teste";
const PAYMENT_ID = "1234567890";
const PREFERENCE_ID = "987654321";
const ORDER_ID = "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f";

/** Notificação real de pagamento aprovado. */
const PAYMENT_NOTIFICATION = {
  id: 1122334455,
  live_mode: false,
  type: "payment",
  date_created: "2026-11-16T12:00:00.000-03:00",
  application_id: 5555555555555555,
  user_id: 777777777,
  version: 1,
  api_version: "v1",
  action: "payment.updated",
  data: { id: PAYMENT_ID },
};

/** Notificação de merchant_order (não é evento de pagamento). */
const MERCHANT_ORDER_NOTIFICATION = {
  id: 99887766,
  live_mode: false,
  type: "merchant_order",
  action: "merchant_order.updated",
  data: { id: "4455667788" },
};

function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T> | T): Promise<T> | T {
  const global = globalThis as unknown as { Deno?: unknown };
  const had = Object.prototype.hasOwnProperty.call(global, "Deno");
  const previous = global.Deno;
  global.Deno = { env: { get: (key: string) => vars[key] } };
  const restore = () => {
    if (had) global.Deno = previous;
    else delete global.Deno;
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function sign(dataId: string, requestId: string, ts: string, secret = WEBHOOK_SECRET): string {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

function buildRequest(
  payload: Record<string, unknown>,
  options: {
    requestId?: string;
    ts?: string;
    signature?: string | null;
    dataId?: string;
  } = {},
) {
  const requestId = options.requestId ?? "req-abc-123";
  const ts = options.ts ?? "1763300000";
  const dataId = options.dataId ?? PAYMENT_ID;
  const signature =
    options.signature === undefined ? sign(dataId, requestId, ts) : options.signature;
  return {
    rawBody: JSON.stringify(payload),
    headers: {
      ...(signature === null ? {} : { "x-signature": signature }),
      "x-request-id": requestId,
    } as Record<string, string>,
    query: {} as Record<string, string>,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Verificação de assinatura
// ─────────────────────────────────────────────────────────────────────────────

test("notificação legítima do MP é aceita e identificada", async () => {
  const verification = await withEnv({ MP_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(buildRequest(PAYMENT_NOTIFICATION)),
  );

  assert.equal(verification.valid, true);
  assert.equal(verification.reason, undefined);
  assert.equal(verification.eventType, "payment");
  assert.equal(verification.providerPaymentId, PAYMENT_ID);
  assert.equal(verification.isTestEvent, false);
  assert.equal(verification.eventId, `payment:${PAYMENT_ID}:payment.updated`);
  assert.deepEqual(verification.payload, PAYMENT_NOTIFICATION);
});

test("assinatura adulterada é recusada antes de qualquer efeito", async () => {
  const verification = await withEnv({ MP_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(
      buildRequest(PAYMENT_NOTIFICATION, {
        signature: `ts=1763300000,v1=${"0".repeat(64)}`,
      }),
    ),
  );

  assert.equal(verification.valid, false);
  assert.equal(verification.reason, "Assinatura do webhook inválida.");
  assert.equal(verification.providerPaymentId, PAYMENT_ID);
});

test("segredo diferente invalida a assinatura", async () => {
  const forged = sign(PAYMENT_ID, "req-abc-123", "1763300000", "outro-segredo");
  const verification = await withEnv({ MP_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(buildRequest(PAYMENT_NOTIFICATION, { signature: forged })),
  );
  assert.equal(verification.valid, false);
});

test("assinatura ausente e segredo não configurado recusam o evento", async () => {
  const missing = await withEnv({ MP_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(buildRequest(PAYMENT_NOTIFICATION, { signature: null })),
  );
  assert.equal(missing.valid, false);
  assert.equal(missing.reason, "Assinatura ausente.");

  const unconfigured = await withEnv({}, () =>
    mercadopagoProvider.verifyWebhook(buildRequest(PAYMENT_NOTIFICATION)),
  );
  assert.equal(unconfigured.valid, false);
  assert.equal(unconfigured.reason, "MP_WEBHOOK_SECRET não configurado.");
});

test("payload inválido não derruba o handler", async () => {
  const verification = await withEnv({ MP_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook({
      rawBody: "{nao-e-json",
      headers: {},
      query: {},
    }),
  );
  assert.equal(verification.valid, false);
  assert.equal(verification.reason, "Payload inválido.");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Recurso notificado → transação
// ─────────────────────────────────────────────────────────────────────────────

test("payment id notificado não é a preferência guardada: resolve pela API oficial", async () => {
  const verification = await withEnv({ MP_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(buildRequest(PAYMENT_NOTIFICATION)),
  );
  assert.equal(verification.valid, true);

  const resource = notificationResource("mercadopago", verification.payload);
  assert.deepEqual(resource, {
    type: "payment",
    id: PAYMENT_ID,
    isPaymentResource: true,
  });

  // A transação criada no checkout guarda a PREFERÊNCIA, não o pagamento.
  const transaction = {
    id: "tx-1",
    order_id: ORDER_ID,
    provider_payment_id: null,
    provider_order_id: PREFERENCE_ID,
  };

  const calls: string[] = [];
  const resolved = await resolveTransaction({
    provider: "mercadopago",
    resource,
    payload: verification.payload,
    providerPaymentId: verification.providerPaymentId,
    deps: {
      byProviderPayment: async (id) => {
        calls.push(`provider_payment:${id}`);
        return null;
      },
      byOrder: async (id) => {
        calls.push(`order:${id}`);
        return id === ORDER_ID ? transaction : null;
      },
      byProviderOrder: async (id) => {
        calls.push(`provider_order:${id}`);
        return id === PREFERENCE_ID ? transaction : null;
      },
      resolveNotification: async (res) => {
        calls.push(`official:${res.type}:${res.id}`);
        return { externalReference: ORDER_ID, providerPaymentId: PAYMENT_ID };
      },
    },
  });

  assert.ok(resolved);
  assert.equal(resolved.via, "official_lookup");
  assert.equal(resolved.transaction.id, "tx-1");
  assert.equal(resolved.providerPaymentId, PAYMENT_ID);
  assert.deepEqual(calls, [
    `provider_payment:${PAYMENT_ID}`,
    `official:payment:${PAYMENT_ID}`,
    `order:${ORDER_ID}`,
  ]);

  // Consulta oficial precisa usar o PAYMENT ID, nunca a preferência.
  assert.equal(
    paymentIdForLookup({
      provider: "mercadopago",
      providerPaymentId: resolved.transaction.provider_payment_id,
      providerOrderId: resolved.transaction.provider_order_id,
      resourceType: resource.type,
      resourceId: resource.id,
      resolvedPaymentId: resolved.providerPaymentId,
    }),
    PAYMENT_ID,
  );
});

test("merchant_order escolhe o pagamento aprovado e não é evento de pagamento", () => {
  const resource = notificationResource("mercadopago", MERCHANT_ORDER_NOTIFICATION);
  assert.deepEqual(resource, {
    type: "merchant_order",
    id: "4455667788",
    isPaymentResource: false,
  });
});

test("evento sem transação correspondente não altera nada", async () => {
  const resource = notificationResource("mercadopago", PAYMENT_NOTIFICATION);
  const resolved = await resolveTransaction({
    provider: "mercadopago",
    resource,
    payload: PAYMENT_NOTIFICATION,
    providerPaymentId: PAYMENT_ID,
    deps: {
      byProviderPayment: async () => null,
      byOrder: async () => null,
      byProviderOrder: async () => null,
      resolveNotification: async () => ({
        externalReference: "00000000-0000-0000-0000-000000000000",
        providerPaymentId: PAYMENT_ID,
      }),
    },
  });
  assert.equal(resolved, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Evento falso antes do legítimo
// ─────────────────────────────────────────────────────────────────────────────

test("evento falso não ocupa a chave do evento legítimo", async () => {
  // Atacante adivinha o eventId e envia sem assinatura válida.
  const forged = await withEnv({ MP_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(
      buildRequest(PAYMENT_NOTIFICATION, { signature: "ts=1,v1=deadbeef" }),
    ),
  );
  assert.equal(forged.valid, false);

  const forgedKey = eventKeyFor({ valid: forged.valid, eventId: forged.eventId });
  assert.equal(forgedKey, `invalid:payment:${PAYMENT_ID}:payment.updated`);
  assert.equal(eventDecision({ valid: false, existing: false, processed: false }), "reject");

  // O evento legítimo, com a mesma id, ainda entra na fila.
  const legitimate = await withEnv({ MP_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(buildRequest(PAYMENT_NOTIFICATION)),
  );
  assert.equal(legitimate.valid, true);

  const legitimateKey = eventKeyFor({ valid: legitimate.valid, eventId: legitimate.eventId });
  assert.equal(legitimateKey, `payment:${PAYMENT_ID}:payment.updated`);
  assert.notEqual(legitimateKey, forgedKey);
  assert.equal(eventDecision({ valid: true, existing: false, processed: false }), "process");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Idempotência e reprocessamento
// ─────────────────────────────────────────────────────────────────────────────

test("evento já processado é duplicata; evento que falhou é reprocessado", () => {
  assert.equal(eventDecision({ valid: true, existing: true, processed: true }), "duplicate");
  assert.equal(eventDecision({ valid: true, existing: true, processed: false }), "reprocess");
  assert.equal(eventDecision({ valid: true, existing: false, processed: false }), "process");
});

test("chave de evento é estável entre entregas iguais", () => {
  const first = eventKeyFor({ valid: true, eventId: `payment:${PAYMENT_ID}:payment.updated` });
  const second = eventKeyFor({ valid: true, eventId: `payment:${PAYMENT_ID}:payment.updated` });
  assert.equal(first, second);
  assert.equal(eventKeyFor({ valid: false, eventId: "" }), "invalid:unknown");
});
