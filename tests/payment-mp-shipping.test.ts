import assert from "node:assert/strict";
import test from "node:test";

import { computeChargeSplit } from "../supabase/functions/_shared/payments/lifecycle.ts";
import {
  buildPreferenceBody,
  mercadopagoProvider,
  mpChargeTotal,
  mpNotificationUrl,
} from "../supabase/functions/_shared/payments/mercadopago.ts";
import type { CreatePaymentInput } from "../supabase/functions/_shared/payments/types.ts";

/**
 * Frete no Checkout Pro (auditoria C3).
 *
 * O Mercado Pago cobra `itens + shipments.cost`. Antes da correção o frete era
 * simplesmente omitido: o comprador pagava só os produtos e o vendedor perdia
 * o valor do envio (ou a preferência era recusada).
 */

const ORDER_ID = "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f";

function paymentInput(overrides: Partial<CreatePaymentInput> = {}): CreatePaymentInput {
  return {
    catalogId: "cat-1",
    orderId: ORDER_ID,
    amount: 125,
    currency: "BRL",
    description: "Pedido de teste",
    items: [
      { name: "Camiseta", quantity: 2, unitPrice: 50 },
      { name: "Boné", quantity: 1, unitPrice: 15 },
    ],
    shippingAmount: 10,
    returnUrl: "https://loja.exemplo.com/c/loja?payment=return",
    cancelUrl: "https://loja.exemplo.com/c/loja?payment=cancel",
    externalReference: ORDER_ID,
    buyerEmail: null,
    ...overrides,
  };
}

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

// ─────────────────────────────────────────────────────────────────────────────
// 1. Corpo da preferência
// ─────────────────────────────────────────────────────────────────────────────

test("preferência envia o frete em shipments.cost", () => {
  const body = buildPreferenceBody(paymentInput(), mpNotificationUrl("https://projeto.supabase.co"));
  const shipments = body["shipments"] as Record<string, unknown>;

  assert.equal(shipments["cost"], 10);
  assert.equal(shipments["mode"], "not_specified");

  const metadata = body["metadata"] as Record<string, unknown>;
  assert.equal(metadata["shipping_cost"], 10);
  assert.equal(metadata["order_total"], 125);
  assert.equal(metadata["order_id"], ORDER_ID);
  assert.equal(metadata["catalog_id"], "cat-1");

  const items = body["items"] as Record<string, unknown>[];
  assert.equal(items.length, 2);
  assert.equal(items[0]!["unit_price"], 50);
  assert.equal(items[1]!["quantity"], 1);
  assert.equal(body["external_reference"], ORDER_ID);
  assert.equal(body["notification_url"], "https://projeto.supabase.co/functions/v1/webhooks-mercadopago");
});

test("pedido sem frete não envia shipments", () => {
  const body = buildPreferenceBody(paymentInput({ amount: 115, shippingAmount: 0 }), "https://x/y");
  assert.equal(body["shipments"], undefined);
});

test("preferência recusa total diferente de itens + frete", () => {
  assert.throws(
    () => buildPreferenceBody(paymentInput({ amount: 120 }), "https://x/y"),
    /Cobrança recusada/,
  );
  // Frete negativo também é recusado.
  assert.throws(
    () => buildPreferenceBody(paymentInput({ amount: 115, shippingAmount: -10 }), "https://x/y"),
    /Cobrança recusada/,
  );
});

test("mpChargeTotal soma itens e frete em unidades mínimas", () => {
  assert.equal(mpChargeTotal(paymentInput()), 125);
  assert.equal(mpChargeTotal(paymentInput({ amount: 115, shippingAmount: 0 })), 115);

  // 19.99 × 3 + 0.02 = 59.99 (sem artefato de ponto flutuante).
  assert.equal(
    mpChargeTotal(
      paymentInput({
        amount: 59.99,
        shippingAmount: 0.02,
        items: [{ name: "Item", quantity: 3, unitPrice: 19.99 }],
      }),
    ),
    59.99,
  );
});

test("moeda de 3 casas fecha exatamente (KWD)", () => {
  const input = paymentInput({
    currency: "KWD",
    amount: 15.75,
    shippingAmount: 0.75,
    items: [{ name: "Item", quantity: 3, unitPrice: 5 }],
  });
  const body = buildPreferenceBody(input, "https://x/y");
  const shipments = body["shipments"] as Record<string, unknown>;
  assert.equal(shipments["cost"], 0.75);
  assert.equal(mpChargeTotal(input), 15.75);
});

test("moeda sem centavos (JPY) não ganha casas decimais", () => {
  const input = paymentInput({
    currency: "JPY",
    amount: 11500,
    shippingAmount: 1000,
    items: [{ name: "Item", quantity: 2, unitPrice: 5250 }],
  });
  const body = buildPreferenceBody(input, "https://x/y");
  const items = body["items"] as Record<string, unknown>[];
  assert.equal(items[0]!["unit_price"], 5250);
  assert.equal((body["shipments"] as Record<string, unknown>)["cost"], 1000);
});

test("computeChargeSplit nunca cobra valor diferente do pedido", () => {
  const split = computeChargeSplit({
    items: [{ quantity: 2, unitPrice: 50 }],
    shippingAmount: 10,
    expectedTotal: 110,
    decimals: 2,
  });
  assert.equal(split.ok, true);
  if (split.ok) {
    assert.equal(split.itemTotal, 100);
    assert.equal(split.shipping, 10);
    assert.equal(split.totalMinor, 11000);
  }

  const mismatch = computeChargeSplit({
    items: [{ quantity: 2, unitPrice: 50 }],
    shippingAmount: 10,
    expectedTotal: 109.99,
    decimals: 2,
  });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, "amount_mismatch");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Chamada real ao provedor (fetch simulado)
// ─────────────────────────────────────────────────────────────────────────────

test("createPayment envia shipments.cost e chave de idempotência do pedido", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; body: Record<string, unknown> | null; headers: Record<string, string> }[] =
    [];

  (globalThis as unknown as { fetch: unknown }).fetch = async (
    input: unknown,
    init: RequestInit = {},
  ) => {
    calls.push({
      url: String(input),
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    return new Response(
      JSON.stringify({
        id: "987654321",
        init_point: "https://www.mercadopago.com.br/checkout/prod",
        sandbox_init_point: "https://sandbox.mercadopago.com.br/checkout/prod",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const result = await withEnv(
      {
        SUPABASE_URL: "https://projeto.supabase.co",
        MP_ENV: "sandbox",
      },
      () =>
        mercadopagoProvider.createPayment(
          {
            accessToken: "seller-token",
            refreshToken: null,
            expiresAt: null,
            scopes: [],
            externalAccountId: "123",
            externalAccountLabel: "loja@exemplo.com",
            merchantId: "123",
            capabilities: {},
          },
          paymentInput(),
        ),
    );

    assert.equal(calls.length, 1);
    const call = calls[0]!;
    assert.equal(call.url, "https://api.mercadopago.com/checkout/preferences");
    assert.equal(call.headers["X-Idempotency-Key"], ORDER_ID);
    assert.deepEqual((call.body!["shipments"] as Record<string, unknown>)["cost"], 10);
    assert.equal((call.body!["metadata"] as Record<string, unknown>)["shipping_cost"], 10);
    // Sandbox: a URL devolvida é a de sandbox.
    assert.equal(result.checkoutUrl, "https://sandbox.mercadopago.com.br/checkout/prod");
    assert.equal(result.status, "pending");
    assert.equal(result.providerOrderId, "987654321");
    assert.equal(result.providerPaymentId, null);
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = original;
  }
});

test("createPayment propaga a recusa do provedor", async () => {
  const original = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async () =>
    new Response(JSON.stringify({ message: "invalid_amount" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });

  try {
    await assert.rejects(
      () =>
        withEnv({ SUPABASE_URL: "https://projeto.supabase.co" }, () =>
          mercadopagoProvider.createPayment(
            {
              accessToken: "seller-token",
              refreshToken: null,
              expiresAt: null,
              scopes: [],
              externalAccountId: "123",
              externalAccountLabel: "loja@exemplo.com",
              merchantId: "123",
              capabilities: {},
            },
            paymentInput(),
          ),
        ),
      /invalid_amount/,
    );
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = original;
  }
});
