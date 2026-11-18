import assert from "node:assert/strict";
import test from "node:test";

import {
  canClaimCapture,
  mergeRefundState,
  shouldCapture,
} from "../supabase/functions/_shared/payments/lifecycle.ts";
import {
  buildOrderBody,
  mapPayPalStatus,
  paypalProvider,
  paypalSnapshotFromOrder,
} from "../supabase/functions/_shared/payments/paypal.ts";
import type { CreatePaymentInput } from "../supabase/functions/_shared/payments/types.ts";

/**
 * Captura do PayPal (auditoria C4, C5, M9).
 *
 * Antes destas correções a captura existia mas nunca era chamada: todo
 * pagamento ficava `authorized` e o dinheiro nunca era capturado. Os testes
 * abaixo simulam a API do PayPal (sem rede real, sem dinheiro real).
 */

const ENV = {
  PAYPAL_CLIENT_ID: "client-id-de-teste",
  PAYPAL_CLIENT_SECRET: "client-secret-de-teste",
  PAYPAL_PARTNER_ID: "PARTNER123",
  PAYPAL_ENV: "sandbox",
};

const CREDENTIALS = {
  accessToken: "platform-token",
  refreshToken: null,
  expiresAt: null,
  scopes: [],
  externalAccountId: "MERCHANT-1",
  externalAccountLabel: "loja@exemplo.com",
  merchantId: "MERCHANT-1",
  capabilities: {},
};

const ORDER_ID = "5O190127TN364715T";
const CAPTURE_ID = "3C679366HH908993F";

type StubResponse = { status?: number; body: unknown };
type StubHandler = (url: string, init: RequestInit) => StubResponse;

/** Substitui `fetch` global e registra as chamadas. */
function stubFetch(handler: StubHandler) {
  const original = globalThis.fetch;
  const calls: {
    url: string;
    method: string;
    body: string | null;
    headers: Record<string, string>;
  }[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    input: unknown,
    init: RequestInit = {},
  ) => {
    const url = String(input);
    calls.push({
      url,
      method: String(init.method ?? "GET"),
      body: typeof init.body === "string" ? init.body : null,
      headers: (init.headers ?? {}) as Record<string, string>,
    });
    const result = handler(url, init);
    return new Response(JSON.stringify(result.body), {
      status: result.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  return {
    calls,
    restore: () => {
      (globalThis as unknown as { fetch: unknown }).fetch = original;
    },
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

/** Ordem aprovada, ainda não capturada. */
const APPROVED_ORDER = {
  id: ORDER_ID,
  status: "APPROVED",
  purchase_units: [
    {
      reference_id: "pedido-1",
      custom_id: "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f",
      amount: { currency_code: "BRL", value: "125.00" },
      payments: {},
    },
  ],
};

/** Ordem já capturada. */
function capturedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER_ID,
    status: "COMPLETED",
    purchase_units: [
      {
        reference_id: "pedido-1",
        amount: { currency_code: "BRL", value: "125.00" },
        payments: {
          captures: [
            {
              id: CAPTURE_ID,
              status: "COMPLETED",
              amount: { currency_code: "BRL", value: "125.00" },
              ...overrides,
            },
          ],
        },
      },
    ],
  };
}

function capturePaymentInput(overrides: Partial<CreatePaymentInput> = {}): CreatePaymentInput {
  return {
    catalogId: "cat-1",
    orderId: "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f",
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
    externalReference: "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f",
    buyerEmail: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Corpo da ordem: frete no breakdown
// ─────────────────────────────────────────────────────────────────────────────

test("ordem PayPal envia frete no breakdown e total fechado", () => {
  const body = buildOrderBody(capturePaymentInput(), "MERCHANT-1");
  const unit = (body["purchase_units"] as Record<string, unknown>[])[0]!;
  const amount = unit["amount"] as Record<string, unknown>;
  const breakdown = amount["breakdown"] as Record<string, Record<string, string>>;

  assert.equal(amount["currency_code"], "BRL");
  assert.equal(amount["value"], "125.00");
  assert.equal(breakdown["item_total"]!["value"], "115.00");
  assert.equal(breakdown["shipping"]!["value"], "10.00");
  assert.deepEqual(unit["payee"], { merchant_id: "MERCHANT-1" });
  assert.equal(body["intent"], "CAPTURE");
});

test("ordem PayPal recusa total que não fecha com itens + frete", () => {
  assert.throws(
    () => buildOrderBody(capturePaymentInput({ amount: 120 }), "MERCHANT-1"),
    /Cobrança recusada/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Snapshot: status vem da CAPTURA, reembolso preservado
// ─────────────────────────────────────────────────────────────────────────────

test("snapshot de ordem capturada usa o id da captura e o da ordem", () => {
  const snapshot = paypalSnapshotFromOrder(capturedOrder(), ORDER_ID);
  assert.ok(snapshot);
  assert.equal(snapshot.providerPaymentId, CAPTURE_ID);
  assert.equal(snapshot.providerOrderId, ORDER_ID);
  assert.equal(snapshot.status, "captured");
  assert.equal(snapshot.capturedAmount, 125);
  assert.equal(snapshot.refundedAmount, 0);
});

test("ordem apenas aprovada não inventa captura", () => {
  const snapshot = paypalSnapshotFromOrder(APPROVED_ORDER, ORDER_ID);
  assert.ok(snapshot);
  assert.equal(snapshot.providerPaymentId, null);
  assert.equal(snapshot.providerOrderId, ORDER_ID);
  assert.equal(snapshot.status, "authorized");
  assert.equal(snapshot.capturedAmount, 0);
});

test("captura REFUNDED contabiliza o reembolso", () => {
  const snapshot = paypalSnapshotFromOrder(
    capturedOrder({ status: "REFUNDED" }),
    ORDER_ID,
  );
  assert.ok(snapshot);
  assert.equal(snapshot.status, "refunded");
  assert.equal(snapshot.refundedAmount, 125);
});

test("captura PARTIALLY_REFUNDED não apaga o reembolso já registrado", () => {
  const snapshot = paypalSnapshotFromOrder(
    capturedOrder({ status: "PARTIALLY_REFUNDED" }),
    ORDER_ID,
  );
  assert.ok(snapshot);
  assert.equal(snapshot.status, "partially_refunded");
  // O PayPal não informa o total reembolsado na captura: o merge é monotônico.
  assert.equal(snapshot.refundedAmount, 0);

  const merged = mergeRefundState({
    totalAmount: 125,
    currentRefunded: 50,
    currentStatus: "partially_refunded",
    snapshotRefunded: snapshot.refundedAmount,
    snapshotStatus: snapshot.status,
  });
  assert.equal(merged.refundedAmount, 50);
  assert.equal(merged.status, "partially_refunded");
  assert.equal(merged.regressed, true);
});

test("consulta do provedor não regride para capturado após reembolso", () => {
  const merged = mergeRefundState({
    totalAmount: 125,
    currentRefunded: 125,
    currentStatus: "refunded",
    snapshotRefunded: 0,
    snapshotStatus: "captured",
  });
  assert.equal(merged.refundedAmount, 125);
  assert.equal(merged.status, "refunded");
});

test("mapPayPalStatus cobre os estados usados na captura", () => {
  assert.equal(mapPayPalStatus("COMPLETED"), "captured");
  assert.equal(mapPayPalStatus("APPROVED"), "authorized");
  assert.equal(mapPayPalStatus("VOIDED"), "cancelled");
  assert.equal(mapPayPalStatus("DECLINED"), "failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Captura real (fetch simulado)
// ─────────────────────────────────────────────────────────────────────────────

test("capture chama /capture e devolve a captura confirmada", async () => {
  const stub = stubFetch((url) => {
    if (url.endsWith("/v1/oauth2/token")) return { body: { access_token: "platform-token" } };
    if (url.endsWith(`/v2/checkout/orders/${ORDER_ID}/capture`)) {
      return { body: capturedOrder() };
    }
    throw new Error(`URL inesperada: ${url}`);
  });

  try {
    const snapshot = await withEnv(ENV, () => paypalProvider.capture(CREDENTIALS, ORDER_ID));
    assert.ok(snapshot);
    assert.equal(snapshot.status, "captured");
    assert.equal(snapshot.providerPaymentId, CAPTURE_ID);
    assert.equal(snapshot.capturedAmount, 125);

    const captureCall = stub.calls.find((call) => call.url.endsWith("/capture"));
    assert.ok(captureCall, "a captura precisa ser chamada");
    assert.equal(captureCall.method, "POST");
    // Idempotência: a mesma chave para o mesmo pagamento (retry/duplo clique).
    assert.equal(captureCall.headers["PayPal-Request-Id"], `capture-${ORDER_ID}`);
  } finally {
    stub.restore();
  }
});

test("captura duplicada devolve a mesma captura em vez de erro", async () => {
  const stub = stubFetch((url, init) => {
    if (url.endsWith("/v1/oauth2/token")) return { body: { access_token: "platform-token" } };
    if (url.endsWith(`/v2/checkout/orders/${ORDER_ID}/capture`) && init.method === "POST") {
      return {
        status: 422,
        body: {
          name: "UNPROCESSABLE_ENTITY",
          details: [{ issue: "ORDER_ALREADY_CAPTURED" }],
        },
      };
    }
    if (url.endsWith(`/v2/checkout/orders/${ORDER_ID}`)) {
      return { body: capturedOrder() };
    }
    throw new Error(`URL inesperada: ${url}`);
  });

  try {
    const first = await withEnv(ENV, () => paypalProvider.capture(CREDENTIALS, ORDER_ID));
    const second = await withEnv(ENV, () => paypalProvider.capture(CREDENTIALS, ORDER_ID));

    assert.ok(first);
    assert.ok(second);
    assert.equal(first.providerPaymentId, CAPTURE_ID);
    assert.equal(second.providerPaymentId, CAPTURE_ID);
    assert.equal(first.status, "captured");
    assert.equal(second.status, "captured");
    assert.equal(stub.calls.filter((call) => call.url.endsWith("/capture")).length, 2);
  } finally {
    stub.restore();
  }
});

test("capture sem credenciais de plataforma não simula pagamento", async () => {
  const stub = stubFetch((url) => {
    throw new Error(`não deveria chamar a rede: ${url}`);
  });
  try {
    const snapshot = await withEnv({}, () => paypalProvider.capture(CREDENTIALS, ORDER_ID));
    assert.equal(snapshot, null);
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Decisões de captura
// ─────────────────────────────────────────────────────────────────────────────

test("shouldCapture só captura PayPal autorizado e ainda não capturado", () => {
  assert.equal(
    shouldCapture({ provider: "paypal", snapshotStatus: "authorized", transactionStatus: "pending" }),
    true,
  );
  assert.equal(
    shouldCapture({ provider: "paypal", snapshotStatus: "authorized", transactionStatus: "captured" }),
    false,
  );
  assert.equal(
    shouldCapture({ provider: "paypal", snapshotStatus: "captured", transactionStatus: "pending" }),
    false,
  );
  assert.equal(
    shouldCapture({ provider: "mercadopago", snapshotStatus: "authorized", transactionStatus: "pending" }),
    false,
  );
});

test("lease de captura impede duas capturas simultâneas", () => {
  const now = 1_000_000;
  assert.equal(canClaimCapture({ now, claimedAt: null, leaseMs: 60_000 }), true);
  assert.equal(canClaimCapture({ now, claimedAt: now - 1_000, leaseMs: 60_000 }), false);
  assert.equal(canClaimCapture({ now, claimedAt: now - 60_000, leaseMs: 60_000 }), true);
});
