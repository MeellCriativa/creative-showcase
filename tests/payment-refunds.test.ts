import assert from "node:assert/strict";
import test from "node:test";

import {
  computeRefundState,
  newRefundOperationId,
  normalizeRefundOperationId,
  planRefund,
  reconcilePendingRefunds,
  refundLedgerTotals,
  refundProviderKey,
  refundStatusFor,
  type RefundLedgerEntry,
} from "../supabase/functions/_shared/payments/refunds.ts";
import {
  fromMinorUnits,
  hasSubUnitPrecision,
  toMinorUnits,
} from "../src/lib/currency.ts";

/**
 * R-01 (idempotência de reembolsos) e R-02 (precisão monetária).
 *
 * Tudo aqui é matemática pura: o "provedor" é simulado pelo ledger em memória,
 * exatamente como o backend o consome (`payment_refunds`). Nenhuma chamada de
 * rede, nenhum banco.
 */

let sequence = 0;
/** UUID válido e determinístico para os testes. */
function operationId(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function refundRow(
  input: Partial<RefundLedgerEntry> & { amount: number },
): RefundLedgerEntry {
  return { status: "approved", ...input };
}

function state(input: {
  total: number;
  currency: string;
  ledger: RefundLedgerEntry[];
  snapshot?: number | null;
  current?: "captured" | "partially_refunded" | "refunded" | "disputed";
}) {
  return computeRefundState({
    totalAmount: input.total,
    currency: input.currency,
    ledger: input.ledger,
    snapshotRefunded: input.snapshot ?? null,
    currentStatus: input.current ?? "captured",
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
 * R-01 — operações distintas de mesmo valor
 * ──────────────────────────────────────────────────────────────────────────── */

test("R-01: dois reembolsos legítimos de R$ 30 somam R$ 60", () => {
  const currency = "BRL";
  let ledger: RefundLedgerEntry[] = [];

  const first = planRefund({
    totalAmount: 60,
    currency,
    requestedAmount: 30,
    ledger,
    currentStatus: "captured",
    operationId: operationId(),
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.amount, 30);
  assert.equal(first.remainingMinor, 6000);
  ledger = [
    ...ledger,
    refundRow({
      amount: first.amount,
      operationId: first.operationId,
      providerRefundId: "MP-REFUND-1",
    }),
  ];

  const afterFirst = state({ total: 60, currency, ledger });
  assert.equal(afterFirst.refundedAmount, 30);
  assert.equal(afterFirst.status, "partially_refunded");

  const second = planRefund({
    totalAmount: 60,
    currency,
    requestedAmount: 30,
    ledger,
    currentStatus: afterFirst.status,
    operationId: operationId(),
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  // Mesmo valor, operação DIFERENTE → chave diferente.
  assert.notEqual(second.operationId, first.operationId);
  ledger = [
    ...ledger,
    refundRow({
      amount: second.amount,
      operationId: second.operationId,
      providerRefundId: "MP-REFUND-2",
    }),
  ];

  const afterSecond = state({ total: 60, currency, ledger });
  assert.equal(afterSecond.refundedAmount, 60);
  assert.equal(afterSecond.status, "refunded");
  assert.equal(afterSecond.remainingMinor, 0);
});

test("R-01: retry da MESMA operação não duplica o saldo", () => {
  const currency = "BRL";
  const op = operationId();
  const ledger = [
    refundRow({ amount: 30, operationId: op, providerRefundId: "MP-1" }),
    // Retry: o provedor devolveu o mesmo reembolso e o registro foi repetido.
    refundRow({ amount: 30, operationId: op, providerRefundId: "MP-1" }),
  ];

  const result = state({ total: 60, currency, ledger });
  assert.equal(result.refundedAmount, 30);
  assert.equal(result.status, "partially_refunded");
});

test("R-01: resposta repetida do provedor não duplica o registro", () => {
  const currency = "USD";
  const ledger = [
    refundRow({ amount: 20, operationId: operationId(), providerRefundId: "PP-REFUND-9" }),
    // Duas operações apontando para o MESMO reembolso do provedor (retry que
    // perdeu a reserva local): o dinheiro só saiu uma vez.
    refundRow({ amount: 20, operationId: operationId(), providerRefundId: "PP-REFUND-9" }),
  ];

  const result = state({ total: 100, currency, ledger });
  assert.equal(result.refundedAmount, 20);
});

test("R-01: mesmo id de operação com ids de provedor diferentes conta uma vez", () => {
  const op = operationId();
  const ledger = [
    refundRow({ amount: 10, operationId: op, providerRefundId: "A" }),
    refundRow({ amount: 10, operationId: op, providerRefundId: "B" }),
  ];

  const totals = refundLedgerTotals(ledger, "BRL");
  assert.equal(totals.approvedMinor, 1000);
  assert.equal(totals.approved.length, 1);
});

test("R-01: timeout seguido de retry não soma duas vezes", () => {
  const currency = "BRL";
  const op = operationId();

  // 1ª tentativa: linha reservada como pending (o provedor não respondeu).
  const pending: RefundLedgerEntry = refundRow({
    amount: 30,
    status: "pending",
    operationId: op,
    providerRefundId: null,
  });
  let ledger = [pending];

  const afterTimeout = state({ total: 60, currency, ledger });
  assert.equal(afterTimeout.refundedAmount, 0);
  assert.equal(afterTimeout.status, "captured");

  // Retry com a MESMA operação: o backend reusa o valor reservado na linha
  // pendente (não o saldo livre), então o provedor devolve o mesmo reembolso.
  const retry = planRefund({
    totalAmount: 60,
    currency,
    requestedAmount: 30,
    ledger,
    currentStatus: "captured",
    operationId: op,
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.amount, 30);

  ledger = [
    refundRow({
      amount: 30,
      status: "approved",
      operationId: op,
      providerRefundId: "MP-RETRY-1",
    }),
  ];
  const afterRetry = state({ total: 60, currency, ledger });
  assert.equal(afterRetry.refundedAmount, 30);
});

test("R-01: reembolso pendente só entra no saldo quando aprovado", () => {
  const currency = "BRL";
  const op = operationId();
  const pending = refundRow({
    amount: 25,
    status: "pending",
    operationId: op,
    providerRefundId: "MP-PENDING",
  });

  const before = state({ total: 100, currency, ledger: [pending] });
  assert.equal(before.refundedAmount, 0);
  assert.equal(before.remainingAmount, 100);

  const approved = refundRow({
    amount: 25,
    status: "approved",
    operationId: op,
    providerRefundId: "MP-PENDING",
  });
  const after = state({ total: 100, currency, ledger: [approved] });
  assert.equal(after.refundedAmount, 25);
  assert.equal(after.status, "partially_refunded");
});

test("R-01: reembolso recusado não altera o saldo", () => {
  const currency = "BRL";
  const ledger = [
    refundRow({
      amount: 40,
      status: "failed",
      operationId: operationId(),
      providerRefundId: null,
    }),
    refundRow({
      amount: 15,
      status: "cancelled",
      operationId: operationId(),
      providerRefundId: "MP-CANCELLED",
    }),
  ];

  const result = state({ total: 100, currency, ledger });
  assert.equal(result.refundedAmount, 0);
  assert.equal(result.remainingAmount, 100);
});

test("R-01: webhook duplicado (mesmo reembolso) não infla o saldo", () => {
  const currency = "BRL";
  const ledger = [
    refundRow({ amount: 50, operationId: operationId(), providerRefundId: "MP-WH-1" }),
    refundRow({ amount: 50, operationId: null, providerRefundId: "MP-WH-1" }),
    refundRow({ amount: 50, operationId: null, providerRefundId: "MP-WH-1" }),
  ];

  const result = state({ total: 100, currency, ledger });
  assert.equal(result.refundedAmount, 50);
  assert.equal(result.status, "partially_refunded");
});

test("R-01: refresh após reembolso parcial e total", () => {
  const currency = "BRL";
  const partial = [
    refundRow({ amount: 30, operationId: operationId(), providerRefundId: "MP-1" }),
  ];

  const partialState = state({ total: 100, currency, ledger: partial, snapshot: 30 });
  assert.equal(partialState.refundedAmount, 30);
  assert.equal(partialState.status, "partially_refunded");
  assert.equal(partialState.remainingAmount, 70);

  const totalLedger = [
    ...partial,
    refundRow({ amount: 70, operationId: operationId(), providerRefundId: "MP-2" }),
  ];
  const totalState = state({ total: 100, currency, ledger: totalLedger, snapshot: 100 });
  assert.equal(totalState.refundedAmount, 100);
  assert.equal(totalState.status, "refunded");
  assert.equal(totalState.remainingMinor, 0);
});

test("R-01: provedor informando menos que o ledger não faz o saldo regredir", () => {
  const ledger = [
    refundRow({ amount: 30, operationId: operationId(), providerRefundId: "MP-1" }),
  ];

  const result = state({
    total: 100,
    currency: "BRL",
    ledger,
    snapshot: 0,
    current: "partially_refunded",
  });
  assert.equal(result.refundedAmount, 30);
  assert.equal(result.status, "partially_refunded");
});

test("R-01: total oficial maior que o ledger complementa (sem somar)", () => {
  const ledger = [
    refundRow({ amount: 20, operationId: operationId(), providerRefundId: "MP-1" }),
  ];

  // O provedor confirma 45 (20 do ledger + 25 que o webhook não registrou).
  const result = state({ total: 100, currency: "BRL", ledger, snapshot: 45 });
  assert.equal(result.refundedAmount, 45);
});

test("R-01: saldo nunca passa do valor da transação", () => {
  const ledger = [
    refundRow({ amount: 80, operationId: operationId(), providerRefundId: "MP-1" }),
  ];

  const result = state({ total: 100, currency: "BRL", ledger, snapshot: 500 });
  assert.equal(result.refundedAmount, 100);
  assert.equal(result.remainingMinor, 0);
  assert.equal(result.status, "refunded");
});

test("R-01: PayPal e Mercado Pago compartilham a mesma regra de saldo", () => {
  for (const provider of ["paypal", "mercadopago"] as const) {
    const ledger = [
      refundRow({
        amount: 30,
        operationId: operationId(),
        providerRefundId: `${provider}-1`,
      }),
      refundRow({
        amount: 30,
        operationId: operationId(),
        providerRefundId: `${provider}-2`,
      }),
    ];
    const result = state({ total: 100, currency: "BRL", ledger });
    assert.equal(result.refundedAmount, 60, provider);
    assert.equal(result.status, "partially_refunded", provider);
  }
});

test("R-01: chave do provedor é estável no retry e distinta por operação", () => {
  const retryA = refundProviderKey({
    providerPaymentId: "1234567890",
    operationId: "11111111-1111-4111-8111-111111111111",
  });
  const retryB = refundProviderKey({
    providerPaymentId: "1234567890",
    operationId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(retryA, retryB);

  const other = refundProviderKey({
    providerPaymentId: "1234567890",
    operationId: "22222222-2222-4222-8222-222222222222",
  });
  assert.notEqual(retryA, other);

  // Mesmo valor/operação em pagamentos diferentes nunca colide.
  const anotherPayment = refundProviderKey({
    providerPaymentId: "CAPTURE-999",
    operationId: "11111111-1111-4111-8111-111111111111",
  });
  assert.notEqual(retryA, anotherPayment);

  // Limite do PayPal-Request-Id (108 caracteres).
  const long = refundProviderKey({
    providerPaymentId: "X".repeat(120),
    operationId: "33333333-3333-4333-8333-333333333333",
  });
  assert.ok(long.length <= 108, `chave longa demais: ${long.length}`);
});

test("R-01: identificador de operação é validado e gerado como UUID", () => {
  assert.equal(normalizeRefundOperationId("not-a-uuid"), null);
  assert.equal(normalizeRefundOperationId(""), null);
  assert.equal(normalizeRefundOperationId(null), null);

  const generated = newRefundOperationId();
  assert.equal(normalizeRefundOperationId(generated), generated.toLowerCase());
});

test("R-01: limite máximo de reembolso não pode ser ultrapassado", () => {
  const ledger = [
    refundRow({ amount: 40, operationId: operationId(), providerRefundId: "MP-1" }),
  ];

  const tooMuch = planRefund({
    totalAmount: 100,
    currency: "BRL",
    requestedAmount: 70,
    ledger,
    currentStatus: "partially_refunded",
    operationId: operationId(),
  });
  assert.equal(tooMuch.ok, false);
  if (tooMuch.ok) return;
  assert.equal(tooMuch.code, "exceeds_balance");

  const exact = planRefund({
    totalAmount: 100,
    currency: "BRL",
    requestedAmount: 60,
    ledger,
    currentStatus: "partially_refunded",
    operationId: operationId(),
  });
  assert.equal(exact.ok, true);
  if (!exact.ok) return;
  assert.equal(exact.amount, 60);
  assert.equal(exact.full, true);
});

test("R-01: valor omitido usa o saldo restante", () => {
  const ledger = [
    refundRow({ amount: 12.34, operationId: operationId(), providerRefundId: "MP-1" }),
  ];

  const plan = planRefund({
    totalAmount: 100,
    currency: "BRL",
    requestedAmount: null,
    ledger,
    currentStatus: "partially_refunded",
    operationId: operationId(),
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.amount, 87.66);
});

test("R-01: pagamento totalmente reembolsado não aceita nova operação", () => {
  const ledger = [
    refundRow({ amount: 100, operationId: operationId(), providerRefundId: "MP-1" }),
  ];

  const plan = planRefund({
    totalAmount: 100,
    currency: "BRL",
    requestedAmount: 10,
    ledger,
    currentStatus: "refunded",
    operationId: operationId(),
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.code, "nothing_left");
});

/* ─────────────────────────────────────────────────────────────────────────────
 * R-01 — conciliação de pendentes (refresh/webhook)
 * ──────────────────────────────────────────────────────────────────────────── */

test("R-01: conciliação aprova apenas o que o provedor comprova", () => {
  const first = operationId();
  const second = operationId();
  const ledger = [
    refundRow({
      id: "refund-1",
      amount: 30,
      status: "pending",
      operationId: first,
      createdAt: "2026-11-18T10:00:00.000Z",
    }),
    refundRow({
      id: "refund-2",
      amount: 30,
      status: "pending",
      operationId: second,
      createdAt: "2026-11-18T10:05:00.000Z",
    }),
  ];

  // O provedor confirma só 30 → apenas o primeiro pendente é aprovado.
  const partial = reconcilePendingRefunds({
    totalAmount: 100,
    currency: "BRL",
    ledger,
    snapshotRefunded: 30,
    currentStatus: "captured",
  });
  assert.deepEqual(partial.approveIds, ["refund-1"]);
  assert.equal(partial.state.refundedAmount, 30);

  // O provedor confirma 60 → os dois são aprovados.
  const total = reconcilePendingRefunds({
    totalAmount: 100,
    currency: "BRL",
    ledger,
    snapshotRefunded: 60,
    currentStatus: "captured",
  });
  assert.deepEqual(total.approveIds, ["refund-1", "refund-2"]);
  assert.equal(total.state.refundedAmount, 60);
});

test("R-01: conciliação sem confirmação do provedor não aprova nada", () => {
  const ledger = [
    refundRow({
      id: "refund-1",
      amount: 30,
      status: "pending",
      operationId: operationId(),
      createdAt: "2026-11-18T10:00:00.000Z",
    }),
  ];

  const result = reconcilePendingRefunds({
    totalAmount: 100,
    currency: "BRL",
    ledger,
    snapshotRefunded: 0,
    currentStatus: "captured",
  });
  assert.deepEqual(result.approveIds, []);
  assert.equal(result.state.refundedAmount, 0);
});

/* ─────────────────────────────────────────────────────────────────────────────
 * R-02 — precisão monetária por moeda
 * ──────────────────────────────────────────────────────────────────────────── */

test("R-02: JPY não tem casas decimais", () => {
  assert.equal(toMinorUnits(1000, "JPY"), 1000);
  assert.equal(fromMinorUnits(500, "JPY"), 500);

  let ledger: RefundLedgerEntry[] = [];
  const first = planRefund({
    totalAmount: 1000,
    currency: "JPY",
    requestedAmount: 500,
    ledger,
    currentStatus: "captured",
    operationId: operationId(),
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.amount, 500);
  ledger = [
    refundRow({ amount: first.amount, operationId: first.operationId, providerRefundId: "JP-1" }),
  ];

  const second = planRefund({
    totalAmount: 1000,
    currency: "JPY",
    requestedAmount: null,
    ledger,
    currentStatus: "partially_refunded",
    operationId: operationId(),
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.amount, 500);

  const result = state({
    total: 1000,
    currency: "JPY",
    ledger: [
      ...ledger,
      refundRow({ amount: 500, operationId: second.operationId, providerRefundId: "JP-2" }),
    ],
  });
  assert.equal(result.refundedAmount, 1000);
  assert.equal(result.status, "refunded");
});

test("R-02: JPY rejeita fração de iene", () => {
  const plan = planRefund({
    totalAmount: 1000,
    currency: "JPY",
    requestedAmount: 100.5,
    ledger: [],
    currentStatus: "captured",
    operationId: operationId(),
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.code, "precision");
  assert.equal(hasSubUnitPrecision(100.5, "JPY"), true);
  assert.equal(hasSubUnitPrecision(100, "JPY"), false);
});

test("R-02: BRL e USD usam duas casas", () => {
  for (const currency of ["BRL", "USD"] as const) {
    assert.equal(toMinorUnits(30.01, currency), 3001);
    assert.equal(fromMinorUnits(3001, currency), 30.01);

    const plan = planRefund({
      totalAmount: 100,
      currency,
      requestedAmount: 30.01,
      ledger: [],
      currentStatus: "captured",
      operationId: operationId(),
    });
    assert.equal(plan.ok, true, currency);
    if (!plan.ok) return;
    assert.equal(plan.amount, 30.01);
    assert.equal(plan.requestedMinor, 3001);

    // Precisão mínima aceita.
    const minimum = planRefund({
      totalAmount: 100,
      currency,
      requestedAmount: 0.01,
      ledger: [],
      currentStatus: "captured",
      operationId: operationId(),
    });
    assert.equal(minimum.ok, true, currency);
    if (!minimum.ok) return;
    assert.equal(minimum.amount, 0.01);

    // Abaixo da unidade mínima é recusado.
    const subUnit = planRefund({
      totalAmount: 100,
      currency,
      requestedAmount: 0.005,
      ledger: [],
      currentStatus: "captured",
      operationId: operationId(),
    });
    assert.equal(subUnit.ok, false, currency);
    if (subUnit.ok) return;
    assert.equal(subUnit.code, "precision");
  }
});

test("R-02: KWD usa três casas", () => {
  assert.equal(toMinorUnits(1.234, "KWD"), 1234);
  assert.equal(fromMinorUnits(1234, "KWD"), 1.234);

  const first = planRefund({
    totalAmount: 1.234,
    currency: "KWD",
    requestedAmount: 0.123,
    ledger: [],
    currentStatus: "captured",
    operationId: operationId(),
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.amount, 0.123);

  const ledger = [
    refundRow({ amount: 0.123, operationId: first.operationId, providerRefundId: "KW-1" }),
  ];

  const second = planRefund({
    totalAmount: 1.234,
    currency: "KWD",
    requestedAmount: null,
    ledger,
    currentStatus: "partially_refunded",
    operationId: operationId(),
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.amount, 1.111);

  const result = state({
    total: 1.234,
    currency: "KWD",
    ledger: [
      ...ledger,
      refundRow({ amount: 1.111, operationId: second.operationId, providerRefundId: "KW-2" }),
    ],
  });
  assert.equal(result.refundedAmount, 1.234);
  assert.equal(result.status, "refunded");
  assert.equal(result.remainingMinor, 0);
});

test("R-02: KWD rejeita fração de filer", () => {
  assert.equal(hasSubUnitPrecision(1.2345, "KWD"), true);
  assert.equal(hasSubUnitPrecision(1.234, "KWD"), false);

  const plan = planRefund({
    totalAmount: 2,
    currency: "KWD",
    requestedAmount: 1.2345,
    ledger: [],
    currentStatus: "captured",
    operationId: operationId(),
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.code, "precision");
});

test("R-02: reembolso parcial e total em KWD", () => {
  const partial = state({
    total: 10,
    currency: "KWD",
    ledger: [refundRow({ amount: 2.5, operationId: operationId(), providerRefundId: "K1" })],
  });
  assert.equal(partial.refundedAmount, 2.5);
  assert.equal(partial.remainingAmount, 7.5);

  const total = state({
    total: 10,
    currency: "KWD",
    ledger: [
      refundRow({ amount: 2.5, operationId: operationId(), providerRefundId: "K1" }),
      refundRow({ amount: 7.5, operationId: operationId(), providerRefundId: "K2" }),
    ],
  });
  assert.equal(total.refundedAmount, 10);
  assert.equal(total.status, "refunded");
});

test("R-02: backend e painel calculam o mesmo saldo", () => {
  const cases = [
    { currency: "JPY", total: 5000, refunded: 1234 },
    { currency: "BRL", total: 100.01, refunded: 33.33 },
    { currency: "USD", total: 250.75, refunded: 0.75 },
    { currency: "KWD", total: 12.345, refunded: 4.567 },
  ] as const;

  for (const item of cases) {
    const ledger = [
      refundRow({
        amount: item.refunded,
        operationId: operationId(),
        providerRefundId: `X-${item.currency}`,
      }),
    ];
    const backend = state({ total: item.total, currency: item.currency, ledger });

    // Conta do painel: mesmas funções monetárias.
    const totalMinor = toMinorUnits(item.total, item.currency);
    const refundedMinor = toMinorUnits(item.refunded, item.currency);
    const panelRemaining = fromMinorUnits(totalMinor - refundedMinor, item.currency);

    assert.equal(backend.remainingAmount, panelRemaining, item.currency);
    assert.equal(backend.refundedAmount, fromMinorUnits(refundedMinor, item.currency));
  }
});

test("R-02: arredondamento não cria centavo fantasma", () => {
  // 0.1 + 0.2 em ponto flutuante é 0.30000000000000004.
  const ledger = [
    refundRow({ amount: 0.1, operationId: operationId(), providerRefundId: "R1" }),
    refundRow({ amount: 0.2, operationId: operationId(), providerRefundId: "R2" }),
  ];
  const result = state({ total: 1, currency: "BRL", ledger });
  assert.equal(result.refundedAmount, 0.3);
  assert.equal(result.remainingAmount, 0.7);
});

test("R-02: valores inválidos, negativos e zero são recusados", () => {
  const invalid = [0, -1, -0.01, Number.NaN, Number.POSITIVE_INFINITY];

  for (const amount of invalid) {
    const plan = planRefund({
      totalAmount: 100,
      currency: "BRL",
      requestedAmount: amount,
      ledger: [],
      currentStatus: "captured",
      operationId: operationId(),
    });
    assert.equal(plan.ok, false, String(amount));
    if (plan.ok) return;
    assert.equal(plan.code, "invalid_amount");
  }
});

test("R-02: operation_id inválido é recusado", () => {
  const plan = planRefund({
    totalAmount: 100,
    currency: "BRL",
    requestedAmount: 10,
    ledger: [],
    currentStatus: "captured",
    operationId: "123",
  });
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.equal(plan.code, "invalid_operation_id");
});

test("R-02: status é derivado do saldo e disputa é preservada", () => {
  assert.equal(
    refundStatusFor({ totalMinor: 10000, refundedMinor: 0, currentStatus: "captured" }),
    "captured",
  );
  assert.equal(
    refundStatusFor({ totalMinor: 10000, refundedMinor: 1, currentStatus: "captured" }),
    "partially_refunded",
  );
  assert.equal(
    refundStatusFor({ totalMinor: 10000, refundedMinor: 10000, currentStatus: "captured" }),
    "refunded",
  );
  assert.equal(
    refundStatusFor({ totalMinor: 10000, refundedMinor: 10000, currentStatus: "disputed" }),
    "disputed",
  );
});
