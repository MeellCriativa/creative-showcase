import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  blocksNewCharge,
  CHARGE_BLOCKING_STATUSES,
  paymentAttemptDecision,
} from "../supabase/functions/_shared/payments/lifecycle.ts";
import type { PaymentStatus } from "../supabase/functions/_shared/payments/types.ts";

/**
 * R-03 — bloqueio de cobrança indevida após pagamento/reembolso e consumo
 * obrigatório da sessão de checkout.
 *
 * As decisões puras são testadas diretamente; as garantias do handler
 * (consumo fatal, nenhum `checkout_url` sem consumo) são verificadas no código
 * real do Edge Function — o padrão já usado nas regressões da Etapa 1.
 */

const INDEX_URL = new URL("../supabase/functions/payments/index.ts", import.meta.url);
const PANEL_URL = new URL("../src/routes/painel.pagamentos.tsx", import.meta.url);

function source(url: URL): string {
  return readFileSync(url, "utf8");
}

/* ── Proteção contra nova cobrança ───────────────────────────────────────── */

test("R-03: pedido pago ou parcialmente reembolsado bloqueia nova cobrança", () => {
  const blocked: PaymentStatus[] = [
    "approved",
    "authorized",
    "captured",
    "partially_refunded",
    "refunded",
    "disputed",
  ];
  for (const status of blocked) {
    assert.equal(blocksNewCharge(status), true, status);
  }

  // Status que ainda permitem tentar pagar (nada foi cobrado).
  for (const status of ["pending", "failed", "cancelled"] as PaymentStatus[]) {
    assert.equal(blocksNewCharge(status), false, status);
  }

  assert.equal(blocksNewCharge(null), false);
  assert.equal(blocksNewCharge(undefined), false);
  assert.equal(blocksNewCharge("desconhecido"), false);
});

test("R-03: partially_refunded está na lista oficial de bloqueio", () => {
  assert.ok(
    (CHARGE_BLOCKING_STATUSES as readonly string[]).includes("partially_refunded"),
  );
});

/* ── Consumo da sessão de checkout ──────────────────────────────────────── */

test("R-03: sessão já consumida sem cobrança ativa é recusada", () => {
  assert.equal(
    paymentAttemptDecision({
      hasValidToken: true,
      sessionConsumed: true,
      hasActiveTransaction: false,
    }),
    "reject_consumed",
  );
});

test("R-03: token inválido nunca cria cobrança", () => {
  assert.equal(
    paymentAttemptDecision({
      hasValidToken: false,
      sessionConsumed: false,
      hasActiveTransaction: false,
    }),
    "reject_token",
  );
});

test("R-03: retry legítimo de cobrança ativa reusa a mesma cobrança", () => {
  assert.equal(
    paymentAttemptDecision({
      hasValidToken: true,
      sessionConsumed: false,
      hasActiveTransaction: true,
    }),
    "reuse",
  );
  assert.equal(
    paymentAttemptDecision({
      hasValidToken: true,
      sessionConsumed: true,
      hasActiveTransaction: true,
    }),
    "reuse",
  );
});

test("R-03: sessão nova é consumida e libera uma única cobrança", () => {
  assert.equal(
    paymentAttemptDecision({
      hasValidToken: true,
      sessionConsumed: false,
      hasActiveTransaction: false,
    }),
    "create",
  );
});

/**
 * Simula o `UPDATE ... where consumed_at is null` atômico do banco.
 *
 * Duas requisições simultâneas disputam a mesma sessão: só uma vence.
 */
function createSessionGate() {
  let consumed = false;
  return {
    get consumed(): boolean {
      return consumed;
    },
    tryConsume(): boolean {
      if (consumed) return false;
      consumed = true;
      return true;
    },
  };
}

test("R-03: duas solicitações simultâneas não liberam duas cobranças", () => {
  const gate = createSessionGate();
  const release = (): "checkout_url" | "blocked" => {
    const decision = paymentAttemptDecision({
      hasValidToken: true,
      sessionConsumed: gate.consumed,
      hasActiveTransaction: false,
    });
    if (decision === "reject_consumed" || decision === "reject_token") return "blocked";
    if (decision === "reuse") return "checkout_url";
    return gate.tryConsume() ? "checkout_url" : "blocked";
  };

  // Duas chamadas "ao mesmo tempo", ambas antes de qualquer transação existir.
  assert.deepEqual([release(), release()], ["checkout_url", "blocked"]);
  assert.equal(gate.consumed, true);
});

test("R-03: falha ao consumir a sessão não libera checkout_url", () => {
  const gate = createSessionGate();
  const release = (consumeFails: boolean): "checkout_url" | "blocked" => {
    if (consumeFails) return "blocked";
    return gate.tryConsume() ? "checkout_url" : "blocked";
  };

  // Erro de banco e timeout no consumo têm o mesmo efeito: nada é liberado.
  assert.equal(release(true), "blocked");
  assert.equal(release(true), "blocked");
  assert.equal(gate.consumed, false);
});

/* ── Garantias no código do handler (regressão estática) ────────────────── */

test("R-03: o handler usa a lista central de bloqueio (não a lista antiga)", () => {
  const index = source(INDEX_URL);
  assert.match(index, /if \(blocksNewCharge\(order\.payment_status\)\)/);
  assert.ok(
    !index.includes('["approved", "authorized", "captured", "refunded", "disputed"]'),
    "a lista antiga (sem partially_refunded) ainda está no handler",
  );
});

test("R-03: consumo da sessão acontece antes de registrar a transação", () => {
  const index = source(INDEX_URL);
  const consume = index.indexOf("const consumed = await consumeCheckoutSession(order.id, token);");
  const create = index.indexOf("const transaction = await createTransaction({");
  assert.ok(consume > -1, "consumo da sessão não encontrado");
  assert.ok(create > -1, "criação da transação não encontrada");
  assert.ok(consume < create, "a transação foi registrada antes do consumo da sessão");
});

test("R-03: falha no consumo é fatal (sem aviso silencioso)", () => {
  const index = source(INDEX_URL);
  assert.ok(
    !index.includes('console.warn("[payments] sessão não consumida"'),
    "o consumo voltou a ser apenas um aviso",
  );
  assert.match(
    index,
    /if \(!consumed\.ok\) \{[\s\S]{0,400}throw new HttpError\(\s*503/,
    "falha de consumo precisa interromper com 503",
  );
});

test("R-03: o reuso de cobrança ativa também exige sessão consumida", () => {
  const index = source(INDEX_URL);
  const reuse = index.indexOf('if (attempt === "reuse" && active)');
  const consume = index.indexOf("await consumeCheckoutSession(order.id, token)", reuse);
  const url = index.indexOf("checkout_url: active.checkout_url", reuse);
  assert.ok(reuse > -1);
  assert.ok(consume > reuse, "reuso não consome a sessão");
  assert.ok(url > consume, "checkout_url liberado antes do consumo");
});

test("R-01: o handler não soma reembolso ao saldo sem comprovar", () => {
  const index = source(INDEX_URL);
  assert.ok(
    !index.includes("refunded + result.amount"),
    "o saldo voltou a ser incrementado com base na resposta do provedor",
  );
  assert.ok(
    !index.includes("Math.round((amount - refunded) * 100) / 100"),
    "cálculo de saldo com duas casas fixas ainda presente",
  );
  assert.match(index, /claimRefundOperation\(/);
  assert.match(index, /refundProviderKey\(/);
  assert.match(index, /computeRefundState\(/);
});

test("R-02: o painel usa unidades mínimas e envia operation_id", () => {
  const panel = source(PANEL_URL);
  assert.ok(
    !panel.includes("Math.round((Number(tx.amount) - Number(tx.refunded_amount)) * 100) / 100"),
    "painel ainda calcula saldo com duas casas fixas",
  );
  assert.match(panel, /toMinorUnits\(/);
  assert.match(panel, /fromMinorUnits\(/);
  assert.match(panel, /hasSubUnitPrecision\(/);
  assert.match(panel, /operationId/);
  assert.match(panel, /newRefundOperationId\(\)/);
});
