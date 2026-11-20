/**
 * Testes das correções P0–P3 da auditoria Mercado Pago (20/11/2026).
 *
 * Todos são determinísticos: usam HMAC local, funções puras e leitura de
 * código-fonte. Nenhuma chamada de rede, nenhum banco e nenhuma cobrança.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  connectionEnvironmentMatches,
  detectDivergence,
  detectPaymentOwnershipMismatch,
  eventDecision,
  paymentAttemptDecision,
  paymentConfirmationGate,
} from "../supabase/functions/_shared/payments/lifecycle.ts";
import { mercadopagoProvider } from "../supabase/functions/_shared/payments/mercadopago.ts";

const ROOT = new URL("../", import.meta.url);
function source(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> | T {
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

/* ─────────────────────────────────────────────────────────────────────────────
 * P0 — escopo de resolveMpPaymentId
 * ───────────────────────────────────────────────────────────────────────────── */

test("P0: resolveMpPaymentId é declarada no escopo de módulo", () => {
  const code = source("supabase/functions/payments/index.ts");
  const declarations = code.match(/^[ \t]*async function resolveMpPaymentId\b/gm) ?? [];
  assert.equal(declarations.length, 1, "deve existir uma única declaração");
  assert.equal(
    declarations[0],
    "async function resolveMpPaymentId",
    "não pode ter indentação (declarada no escopo de módulo, não aninhada)",
  );

  const uses = code.match(/resolveMpPaymentId\(/g) ?? [];
  assert.equal(uses.length, 3, "declaração + 2 chamadas (payment_status e refresh_payment)");
});

test("P0: refreshPaymentAction chama resolveMpPaymentId fora da ação de status", () => {
  const code = source("supabase/functions/payments/index.ts");
  const refreshAt = code.indexOf("async function refreshPaymentAction");
  const callAt = code.indexOf("await resolveMpPaymentId(transaction, loaded.credentials)", refreshAt);
  assert.ok(refreshAt > 0, "refreshPaymentAction deve existir");
  assert.ok(callAt > refreshAt, "a chamada precisa estar dentro de refreshPaymentAction");

  const statusAt = code.indexOf("async function paymentStatusAction");
  const declarationAt = code.indexOf("async function resolveMpPaymentId(");
  assert.ok(declarationAt > 0 && declarationAt < statusAt, "declaração antes de paymentStatusAction");
});

/* ─────────────────────────────────────────────────────────────────────────────
 * P1 — assinatura do webhook com MERCADOPAGO_WEBHOOK_SECRET
 * ───────────────────────────────────────────────────────────────────────────── */

const NEW_SECRET = "mercadopago-webhook-secret-oficial";
const LEGACY_SECRET = "nome-antigo-que-nao-deve-vencer";
const PAYMENT_ID = "1234567890";

const NOTIFICATION = {
  id: 1122334455,
  live_mode: false,
  type: "payment",
  action: "payment.updated",
  data: { id: PAYMENT_ID },
};

function signatureFor(secret: string, requestId = "req-abc", ts = String(Math.floor(Date.now() / 1000))) {
  const manifest = `id:${PAYMENT_ID};request-id:${requestId};ts:${ts};`;
  return `ts=${ts},v1=${createHmac("sha256", secret).update(manifest).digest("hex")}`;
}

function request(signature?: string) {
  return {
    headers: {
      "x-request-id": "req-abc",
      ...(signature ? { "x-signature": signature } : {}),
    },
    rawBody: JSON.stringify(NOTIFICATION),
    query: {},
  };
}

test("P1: assinatura válida com MERCADOPAGO_WEBHOOK_SECRET é aceita", async () => {
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: NEW_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(request(signatureFor(NEW_SECRET))),
  );
  assert.equal(result.valid, true);
  assert.equal(result.providerPaymentId, PAYMENT_ID);
});

test("P1: assinatura inválida com o Secret correto é recusada", async () => {
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: NEW_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(request(signatureFor("segredo-errado"))),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /inválida/);
});

test("P1: notificação sem assinatura é recusada", async () => {
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: NEW_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(request()),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /ausente/);
});

test("P1: sem nenhum Secret configurado a notificação é recusada", async () => {
  const result = await withEnv({}, () =>
    mercadopagoProvider.verifyWebhook(request(signatureFor(NEW_SECRET))),
  );
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /WEBHOOK_SECRET/);
});

test("P1: o nome novo tem precedência sobre o legado", async () => {
  const vars = {
    MERCADOPAGO_WEBHOOK_SECRET: NEW_SECRET,
    MP_WEBHOOK_SECRET: LEGACY_SECRET,
  };
  const aceita = await withEnv(vars, () =>
    mercadopagoProvider.verifyWebhook(request(signatureFor(NEW_SECRET))),
  );
  const recusada = await withEnv(vars, () =>
    mercadopagoProvider.verifyWebhook(request(signatureFor(LEGACY_SECRET))),
  );
  assert.equal(aceita.valid, true);
  assert.equal(recusada.valid, false);
});

test("P1: o nome legado continua funcionando (compatibilidade)", async () => {
  const result = await withEnv({ MP_WEBHOOK_SECRET: LEGACY_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(request(signatureFor(LEGACY_SECRET))),
  );
  assert.equal(result.valid, true);
});

/* ─────────────────────────────────────────────────────────────────────────────
 * P2 — fail-closed financeiro
 * ───────────────────────────────────────────────────────────────────────────── */

const ORDER_ID = "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f";
const SELLER_ID = "777777777";

function cleanDivergence() {
  return detectDivergence({
    expectedAmount: 100,
    expectedCurrency: "BRL",
    snapshotAmount: 100,
    snapshotCurrency: "BRL",
    decimals: 2,
  });
}

function cleanOwnership() {
  return detectPaymentOwnershipMismatch({
    expectedOrderId: ORDER_ID,
    snapshotOrderId: ORDER_ID,
    expectedSellerId: SELLER_ID,
    snapshotSellerId: SELLER_ID,
    requireOrderReference: true,
    requireSellerAccount: true,
  });
}

test("P2: valores divergentes impedem a confirmação", () => {
  const gate = paymentConfirmationGate({
    divergence: detectDivergence({
      expectedAmount: 100,
      expectedCurrency: "BRL",
      snapshotAmount: 10,
      snapshotCurrency: "BRL",
      decimals: 2,
    }),
    ownership: cleanOwnership(),
  });
  assert.deepEqual(gate, { allow: false, reason: "amount_divergence" });
});

test("P2: moeda divergente impede a confirmação", () => {
  const gate = paymentConfirmationGate({
    divergence: detectDivergence({
      expectedAmount: 100,
      expectedCurrency: "BRL",
      snapshotAmount: 100,
      snapshotCurrency: "USD",
      decimals: 2,
    }),
    ownership: cleanOwnership(),
  });
  assert.deepEqual(gate, { allow: false, reason: "currency_divergence" });
});

test("P2: vendedor incorreto impede a confirmação", () => {
  const ownership = detectPaymentOwnershipMismatch({
    expectedOrderId: ORDER_ID,
    snapshotOrderId: ORDER_ID,
    expectedSellerId: SELLER_ID,
    snapshotSellerId: "999999999",
    requireOrderReference: true,
    requireSellerAccount: true,
  });
  assert.equal(ownership.sellerMismatch, true);
  assert.deepEqual(paymentConfirmationGate({ divergence: cleanDivergence(), ownership }), {
    allow: false,
    reason: "payment_ownership_mismatch",
  });
});

test("P2: pedido incorreto impede a confirmação", () => {
  const ownership = detectPaymentOwnershipMismatch({
    expectedOrderId: ORDER_ID,
    snapshotOrderId: "00000000-0000-0000-0000-000000000000",
    expectedSellerId: SELLER_ID,
    snapshotSellerId: SELLER_ID,
    requireOrderReference: true,
    requireSellerAccount: true,
  });
  assert.equal(ownership.orderMismatch, true);
  assert.deepEqual(paymentConfirmationGate({ divergence: cleanDivergence(), ownership }), {
    allow: false,
    reason: "payment_ownership_mismatch",
  });
});

test("P2: ausência de referência/vendedor na resposta oficial é fail-closed", () => {
  const ownership = detectPaymentOwnershipMismatch({
    expectedOrderId: ORDER_ID,
    snapshotOrderId: null,
    expectedSellerId: SELLER_ID,
    snapshotSellerId: undefined,
    requireOrderReference: true,
    requireSellerAccount: true,
  });
  assert.equal(ownership.missingOrderReference, true);
  assert.equal(ownership.missingSellerAccount, true);
  assert.equal(paymentConfirmationGate({ divergence: cleanDivergence(), ownership }).allow, false);
});

test("P2: dados oficiais coerentes liberam a confirmação", () => {
  assert.deepEqual(paymentConfirmationGate({
    divergence: cleanDivergence(),
    ownership: cleanOwnership(),
  }), { allow: true, reason: null });
});

test("P2: o snapshot do MP expõe referência e vendedor para validação", () => {
  const code = source("supabase/functions/_shared/payments/mercadopago.ts");
  assert.match(code, /externalReference: res\.body\.external_reference/);
  assert.match(code, /sellerAccountId: res\.body\.collector_id/);
});

test("P2: a validação roda antes de gravar transação/pedido", () => {
  const code = source("supabase/functions/_shared/payments/webhooks.ts");
  const gateAt = code.indexOf("if (!checked.gate.allow)");
  const updateAt = code.indexOf("const written = await updateTransaction({");
  const syncAt = code.indexOf("const synced = await syncOrderPayment({");
  assert.ok(gateAt > 0, "o gate fail-closed precisa existir");
  assert.ok(updateAt > gateAt && syncAt > gateAt, "nenhuma escrita pode vir antes do gate");
});

test("P2: pagamento duplicado continua bloqueado", () => {
  assert.equal(
    paymentAttemptDecision({
      hasValidToken: true,
      sessionConsumed: false,
      hasActiveTransaction: true,
    }),
    "reuse",
  );
  assert.equal(
    eventDecision({ valid: true, existing: true, processed: true }),
    "duplicate",
  );
});

/* ─────────────────────────────────────────────────────────────────────────────
 * P3 — isolamento Sandbox/Produção
 * ───────────────────────────────────────────────────────────────────────────── */

test("P3: conexão só é válida no mesmo ambiente do runtime", () => {
  assert.equal(connectionEnvironmentMatches("sandbox", "sandbox"), true);
  assert.equal(connectionEnvironmentMatches("production", "production"), true);
  assert.equal(connectionEnvironmentMatches("sandbox", "production"), false);
  assert.equal(connectionEnvironmentMatches("production", "sandbox"), false);
  assert.equal(connectionEnvironmentMatches(null, "sandbox"), false);
  assert.equal(connectionEnvironmentMatches("sandbox", null), false);
  assert.equal(connectionEnvironmentMatches(" SANDBOX ", "sandbox"), true);
});

test("P3: a checagem está ligada ao checkout, callback, webhook e loadCredentials", () => {
  const checkout = source("supabase/functions/payments/index.ts");
  const callback = source("supabase/functions/payments-callback/index.ts");
  const connections = source("supabase/functions/_shared/payments/connections.ts");
  const webhooks = source("supabase/functions/_shared/payments/webhooks.ts");

  assert.match(checkout, /connectionEnvironmentMatches\(connection\.environment/);
  assert.match(callback, /connectionEnvironmentMatches\(String\(payload\.env/);
  assert.match(connections, /connectionEnvironmentMatches\(connection\.environment/);
  assert.match(webhooks, /connectionEnvironmentMatches\(connection\.environment/);
});
