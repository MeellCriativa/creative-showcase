import assert from "node:assert/strict";
import test from "node:test";

import {
  detectDivergence,
  eventDecision,
  eventKeyFor,
  fixedWindowRateLimit,
  mergeRefundState,
  paymentAttemptDecision,
  roundAmount,
} from "../supabase/functions/_shared/payments/lifecycle.ts";
import {
  addAmounts,
  currencyDecimals,
  providerAmount,
  providerAmountString,
} from "../supabase/functions/_shared/payments/money.ts";

/**
 * Idempotência e integridade financeira (auditoria A1, A2, A3, A4, M1, M2, M5).
 *
 * Tudo aqui é decisão pura: nenhuma chamada de rede, nenhum banco. O objetivo é
 * garantir que repetir a mesma operação nunca cobre, reembolse ou registre duas
 * vezes.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Eventos de webhook
// ─────────────────────────────────────────────────────────────────────────────

test("evento repetido não é processado duas vezes", () => {
  const key = eventKeyFor({ valid: true, eventId: "payment:1:payment.updated" });
  assert.equal(key, "payment:1:payment.updated");

  // 1ª entrega
  assert.equal(eventDecision({ valid: true, existing: false, processed: false }), "process");
  // 2ª entrega (já processado)
  assert.equal(eventDecision({ valid: true, existing: true, processed: true }), "duplicate");
});

test("evento com falha é reprocessado, não perdido", () => {
  assert.equal(eventDecision({ valid: true, existing: true, processed: false }), "reprocess");
});

test("evento com assinatura inválida nunca é processado", () => {
  assert.equal(eventDecision({ valid: false, existing: false, processed: false }), "reject");
  // Mesmo que exista uma linha com a mesma chave, não há efeito.
  assert.equal(eventDecision({ valid: false, existing: true, processed: false }), "reject");
});

test("chave de evento inválido não colide com a do evento legítimo", () => {
  const legit = eventKeyFor({ valid: true, eventId: "payment:42:payment.updated" });
  const forged = eventKeyFor({ valid: false, eventId: "payment:42:payment.updated" });
  assert.notEqual(legit, forged);
  assert.equal(forged, "invalid:payment:42:payment.updated");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Reembolsos
// ─────────────────────────────────────────────────────────────────────────────

test("reembolso é monotônico: consulta não apaga o que já foi reembolsado", () => {
  const merged = mergeRefundState({
    totalAmount: 100,
    currentRefunded: 30,
    currentStatus: "partially_refunded",
    snapshotRefunded: 0,
    snapshotStatus: "captured",
  });
  assert.equal(merged.refundedAmount, 30);
  assert.equal(merged.status, "partially_refunded");
  assert.equal(merged.regressed, true);
});

test("reembolso total fecha o status como refunded", () => {
  const merged = mergeRefundState({
    totalAmount: 100,
    currentRefunded: 0,
    currentStatus: "captured",
    snapshotRefunded: 100,
    snapshotStatus: "captured",
  });
  assert.equal(merged.refundedAmount, 100);
  assert.equal(merged.status, "refunded");
});

test("reembolso parcial mantém partially_refunded", () => {
  const merged = mergeRefundState({
    totalAmount: 100,
    currentRefunded: 0,
    currentStatus: "captured",
    snapshotRefunded: 40,
    snapshotStatus: "captured",
  });
  assert.equal(merged.status, "partially_refunded");
  assert.equal(merged.refundedAmount, 40);
});

test("reembolso seguido de consulta não permite reembolsar de novo", () => {
  // 1. reembolso aprovado de 100
  const afterRefund = mergeRefundState({
    totalAmount: 100,
    currentRefunded: 0,
    currentStatus: "captured",
    snapshotRefunded: 100,
    snapshotStatus: "refunded",
  });
  assert.equal(afterRefund.refundedAmount, 100);
  assert.equal(afterRefund.status, "refunded");

  // 2. consulta oficial devolve "capturado, 0 reembolsado" (PayPal fazia isso)
  const afterRefresh = mergeRefundState({
    totalAmount: 100,
    currentRefunded: afterRefund.refundedAmount,
    currentStatus: afterRefund.status,
    snapshotRefunded: 0,
    snapshotStatus: "captured",
  });
  assert.equal(afterRefresh.refundedAmount, 100);
  assert.equal(afterRefresh.status, "refunded");

  // 3. o valor restante para reembolso continua zero
  assert.equal(100 - afterRefresh.refundedAmount, 0);
});

test("disputa tem precedência sobre reembolso", () => {
  const merged = mergeRefundState({
    totalAmount: 100,
    currentRefunded: 20,
    currentStatus: "partially_refunded",
    snapshotRefunded: 20,
    snapshotStatus: "disputed",
  });
  assert.equal(merged.status, "disputed");
  assert.equal(merged.refundedAmount, 20);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Uma cobrança por pedido
// ─────────────────────────────────────────────────────────────────────────────

test("duas tentativas de pagamento no mesmo pedido reutilizam a cobrança", () => {
  assert.equal(
    paymentAttemptDecision({ hasValidToken: true, sessionConsumed: false, hasActiveTransaction: true }),
    "reuse",
  );
  assert.equal(
    paymentAttemptDecision({ hasValidToken: true, sessionConsumed: true, hasActiveTransaction: true }),
    "reuse",
  );
});

test("token de uso único não cria segunda cobrança", () => {
  assert.equal(
    paymentAttemptDecision({ hasValidToken: true, sessionConsumed: true, hasActiveTransaction: false }),
    "reject_consumed",
  );
});

test("token inválido é recusado antes de qualquer efeito", () => {
  assert.equal(
    paymentAttemptDecision({ hasValidToken: false, sessionConsumed: false, hasActiveTransaction: false }),
    "reject_token",
  );
});

test("primeira tentativa cria a cobrança", () => {
  assert.equal(
    paymentAttemptDecision({ hasValidToken: true, sessionConsumed: false, hasActiveTransaction: false }),
    "create",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Divergência pedido × provedor
// ─────────────────────────────────────────────────────────────────────────────

test("divergência de valor é detectada com tolerância de 1 unidade mínima", () => {
  const exact = detectDivergence({
    expectedAmount: 125,
    expectedCurrency: "BRL",
    snapshotAmount: 125,
    snapshotCurrency: "BRL",
    decimals: 2,
  });
  assert.equal(exact.hasDivergence, false);
  assert.equal(exact.difference, 0);

  const cent = detectDivergence({
    expectedAmount: 125,
    expectedCurrency: "BRL",
    snapshotAmount: 125.01,
    snapshotCurrency: "BRL",
    decimals: 2,
  });
  assert.equal(cent.hasDivergence, false, "1 centavo é arredondamento aceitável");

  const wrong = detectDivergence({
    expectedAmount: 125,
    expectedCurrency: "BRL",
    snapshotAmount: 12.5,
    snapshotCurrency: "BRL",
    decimals: 2,
  });
  assert.equal(wrong.hasDivergence, true);
  assert.equal(wrong.amountMismatch, true);
  assert.equal(wrong.difference, -112.5);
});

test("divergência de moeda é detectada", () => {
  const result = detectDivergence({
    expectedAmount: 125,
    expectedCurrency: "BRL",
    snapshotAmount: 125,
    snapshotCurrency: "USD",
    decimals: 2,
  });
  assert.equal(result.currencyMismatch, true);
  assert.equal(result.hasDivergence, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Rate limit (janela fixa)
// ─────────────────────────────────────────────────────────────────────────────

test("rate limit bloqueia acima do máximo e informa retry", () => {
  const windowMs = 60_000;
  const max = 2;
  const now = 1_000_000;

  const first = fixedWindowRateLimit({ state: null, now, windowMs, max });
  assert.equal(first.allowed, true);
  assert.equal(first.hits, 1);

  const second = fixedWindowRateLimit({ state: first, now: now + 100, windowMs, max });
  assert.equal(second.allowed, true);
  assert.equal(second.hits, 2);

  const third = fixedWindowRateLimit({ state: second, now: now + 200, windowMs, max });
  assert.equal(third.allowed, false);
  assert.equal(third.hits, 3);
  assert.ok(third.retryAfterMs > 0);
  assert.ok(third.retryAfterMs <= windowMs);
});

test("rate limit reinicia quando a janela expira", () => {
  const windowMs = 60_000;
  const state = { hits: 10, windowStart: 1_000_000 };
  const result = fixedWindowRateLimit({
    state,
    now: 1_000_000 + windowMs,
    windowMs,
    max: 5,
  });
  assert.equal(result.allowed, true);
  assert.equal(result.hits, 1);
  assert.equal(result.windowStart, 1_060_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Precisão monetária
// ─────────────────────────────────────────────────────────────────────────────

test("precisão interna preserva moedas de 3 casas", () => {
  assert.equal(roundAmount(1.234567), 1.234567);
  assert.equal(roundAmount(0.1 + 0.2), 0.3);
  assert.equal(currencyDecimals("BRL"), 2);
  assert.equal(currencyDecimals("JPY"), 0);
  assert.equal(currencyDecimals("KWD"), 3);
});

test("valores enviados ao provedor respeitam as casas da moeda", () => {
  assert.equal(providerAmountString(125, "BRL"), "125.00");
  assert.equal(providerAmountString(11500, "JPY"), "11500");
  assert.equal(providerAmountString(15.75, "KWD"), "15.750");
  assert.equal(providerAmount(1.239, "BRL"), 1.24);
  assert.equal(providerAmount(1.234, "BRL"), 1.23);
});

test("soma em unidades mínimas evita artefatos de ponto flutuante", () => {
  assert.equal(addAmounts([19.99, 19.99, 19.99], "BRL"), 59.97);
  assert.equal(addAmounts([0.1, 0.2], "BRL"), 0.3);
  assert.equal(addAmounts([5250, 5250], "JPY"), 10500);
});
