import assert from "node:assert/strict";
import test from "node:test";

import {
  executeRefund,
  reconcileTransactionRefunds,
  type OfficialRefunded,
  type RefundClaimInput,
  type RefundClaimResult,
  type RefundFlowDeps,
  type RefundOutcome,
  type RefundRecord,
  type RefundTransaction,
  type RefundUpdatePatch,
} from "../supabase/functions/_shared/payments/refund-flow.ts";
import type {
  PaymentProviderKey,
  PaymentStatus,
  RefundResult,
} from "../supabase/functions/_shared/payments/types.ts";

/**
 * 2.1.3 — F-01 / F-02 / F-03 / F-06A / F-06B.
 *
 * Estes testes exercitam o HANDLER REAL de reembolso (`executeRefund`) e a
 * reconciliação real (`reconcileTransactionRefunds`) contra um banco em memória
 * que reproduz as restrições do Postgres:
 *
 *   • `operation_id` único por transação;
 *   • `provider_refund_id` único (índice único);
 *   • `dedupe_key` único enquanto `status = 'pending'` (uma pendência por
 *     transação — o índice parcial da migration);
 *   • falhas de I/O injetáveis (para provar o comportamento fail-closed).
 *
 * O provedor é um mock STATEFUL: a mesma chave de idempotência devolve o MESMO
 * reembolso, exatamente como Mercado Pago/PayPal fazem. Nenhuma rede, nenhum
 * dinheiro real.
 */

/* ── Identificadores ─────────────────────────────────────────────────────── */

const TX_ID = "11111111-1111-4111-8111-111111111111";

let opSequence = 0;
function op(): string {
  opSequence += 1;
  return `00000000-0000-4000-8000-${String(opSequence).padStart(12, "0")}`;
}

/* ── Banco em memória ────────────────────────────────────────────────────── */

type Row = RefundRecord & { dedupe_key?: string | null };

type UpdateHook = (row: Row, patch: RefundUpdatePatch) => boolean;

class FakeStore {
  rows: Row[] = [];
  seq = 0;
  official: OfficialRefunded = { amount: 0, known: true };
  claimError: RefundClaimResult | null = null;
  onRefundUpdate: UpdateHook | null = null;
  failTransactionUpdates = 0;
  transactionUpdates: Array<{ refundedAmount: number; status: PaymentStatus }> = [];
  orderSyncs = 0;
  transaction: RefundTransaction;

  constructor(input: Partial<RefundTransaction> & { id: string }) {
    this.transaction = {
      id: input.id,
      order_id: input.order_id ?? "order-1",
      catalog_id: input.catalog_id ?? "catalog-1",
      provider: input.provider ?? "mercadopago",
      status: input.status ?? "captured",
      provider_status: input.provider_status ?? "approved",
      amount: input.amount ?? 100,
      currency: input.currency ?? "BRL",
      provider_payment_id: input.provider_payment_id ?? "mp-payment-1",
      provider_order_id: input.provider_order_id ?? null,
      refunded_amount: input.refunded_amount ?? 0,
    };
  }

  private clock(): string {
    this.seq += 1;
    return new Date(1_700_000_000_000 + this.seq * 1_000).toISOString();
  }

  seed(row: Partial<Row> & { amount: number }): Row {
    const full: Row = {
      id: row.id ?? `seed-${this.rows.length + 1}`,
      transaction_id: row.transaction_id ?? this.transaction.id,
      catalog_id: this.transaction.catalog_id,
      amount: row.amount,
      status: row.status ?? "approved",
      provider_refund_id: row.provider_refund_id ?? null,
      operation_id: row.operation_id ?? null,
      entry_kind: row.entry_kind === undefined ? "operation" : row.entry_kind,
      idempotency_key: row.idempotency_key ?? null,
      requested_by: row.requested_by === undefined ? "seller-1" : row.requested_by,
      created_at: row.created_at ?? this.clock(),
      last_error: row.last_error ?? null,
      dedupe_key: row.dedupe_key ?? null,
    };
    this.rows.push(full);
    return full;
  }

  pending(): Row[] {
    return this.rows.filter((row) => row.status === "pending");
  }

  byOperation(operationId: string): Row | undefined {
    return this.rows.find((row) => row.operation_id === operationId);
  }

  deps(provider: FakeProvider): RefundFlowDeps {
    return {
      listRefunds: async (transactionId) =>
        this.rows
          .filter((row) => row.transaction_id === transactionId)
          .slice()
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
      findRefundByOperation: async (transactionId, operationId) =>
        this.rows.find(
          (row) => row.transaction_id === transactionId && row.operation_id === operationId,
        ) ?? null,
      findRefundByProviderId: async (_provider: PaymentProviderKey, providerRefundId) =>
        this.rows.find((row) => row.provider_refund_id === providerRefundId) ?? null,
      listPendingRefunds: async (transactionId) =>
        this.rows
          .filter((row) => row.transaction_id === transactionId && row.status === "pending")
          .slice()
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
      claimRefundOperation: async (claim: RefundClaimInput): Promise<RefundClaimResult> => {
        if (this.claimError) return this.claimError;

        const existing = this.rows.find(
          (row) =>
            row.transaction_id === claim.transactionId &&
            row.operation_id === claim.operationId,
        );
        if (existing) return { ok: false, code: "operation_exists", row: existing };

        if (claim.dedupeKey) {
          const blocker = this.rows.find(
            (row) =>
              row.transaction_id === claim.transactionId &&
              row.status === "pending" &&
              row.dedupe_key === claim.dedupeKey,
          );
          if (blocker) return { ok: false, code: "pending_exists", row: blocker };
        }

        const row: Row = {
          id: `refund-${this.rows.length + 1}`,
          transaction_id: claim.transactionId,
          catalog_id: claim.catalogId,
          amount: claim.amount,
          status: "pending",
          provider_refund_id: null,
          operation_id: claim.operationId,
          entry_kind: "operation",
          idempotency_key: claim.idempotencyKey,
          requested_by: claim.requestedBy,
          created_at: this.clock(),
          last_error: null,
          dedupe_key: claim.dedupeKey,
        };
        this.rows.push(row);
        return { ok: true, row, created: true };
      },
      updateRefundRecord: async (refundId, patch) => {
        const row = this.rows.find((candidate) => candidate.id === refundId);
        if (!row) return { ok: false, error: "refund row not found" };
        if (this.onRefundUpdate?.(row, patch)) {
          return { ok: false, error: "refund update failed (injected)" };
        }
        if (patch.providerRefundId) {
          const clash = this.rows.find(
            (candidate) =>
              candidate.id !== refundId &&
              candidate.provider_refund_id === patch.providerRefundId,
          );
          if (clash) {
            // Reproduz o índice único de `provider_refund_id`.
            return {
              ok: false,
              conflict: "provider_refund_id",
              error: "duplicate key value violates unique constraint",
            };
          }
        }
        if (patch.status !== undefined) row.status = patch.status;
        if (patch.providerRefundId !== undefined) row.provider_refund_id = patch.providerRefundId;
        if (patch.amount !== undefined) row.amount = patch.amount;
        if (patch.idempotencyKey !== undefined) row.idempotency_key = patch.idempotencyKey;
        if (patch.lastError !== undefined) row.last_error = patch.lastError;
        if (patch.clearDedupeKey) row.dedupe_key = null;
        return { ok: true };
      },
      updateTransaction: async (input) => {
        if (this.failTransactionUpdates > 0) {
          this.failTransactionUpdates -= 1;
          return { ok: false, error: "transaction update failed (injected)" };
        }
        this.transactionUpdates.push({
          refundedAmount: input.refundedAmount,
          status: input.status,
        });
        this.transaction.refunded_amount = input.refundedAmount;
        this.transaction.status = input.status;
        return { ok: true };
      },
      syncOrderPayment: async () => {
        this.orderSyncs += 1;
        return { ok: true };
      },
      readOfficialRefunded: async () => ({ ...this.official }),
      refund: (request) => provider.refund(request),
      queryRefund: (providerRefundId) => provider.query(providerRefundId),
      log: () => {},
    };
  }
}

/* ── Provedor stateful (idempotente por chave) ───────────────────────────── */

type RefundRequest = {
  providerPaymentId: string;
  amount: number;
  currency: string;
  reason: string | null;
  idempotencyKey: string;
};

class FakeProvider {
  calls: RefundRequest[] = [];
  /** Reembolsos efetivamente criados (uma vez por chave nova). */
  executions: RefundResult[] = [];
  fixedRefundId: string | null = null;
  nextStatus: "approved" | "pending" | "failed" = "approved";
  onCall: ((request: RefundRequest) => void) | null = null;
  onExecute: ((result: RefundResult, request: RefundRequest) => void) | null = null;

  private byKey = new Map<string, RefundResult>();
  private byRefundId = new Map<string, RefundResult>();
  private counter = 0;
  private timeoutOnce = false;

  timeOutOnce(): void {
    this.timeoutOnce = true;
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    this.calls.push({ ...request });
    this.onCall?.(request);

    if (this.timeoutOnce) {
      this.timeoutOnce = false;
      throw new Error("provider timeout");
    }

    const replay = this.byKey.get(request.idempotencyKey);
    if (replay) return replay;

    if (this.fixedRefundId) {
      const existing = this.byRefundId.get(this.fixedRefundId);
      if (existing) {
        this.byKey.set(request.idempotencyKey, existing);
        return existing;
      }
    }

    this.counter += 1;
    const result: RefundResult = {
      providerRefundId: this.fixedRefundId ?? `re_${this.counter}`,
      status: this.nextStatus,
      amount: this.nextStatus === "failed" ? 0 : request.amount,
      raw: {},
    };
    this.byKey.set(request.idempotencyKey, result);
    if (result.providerRefundId) this.byRefundId.set(result.providerRefundId, result);
    if (result.status === "approved" || result.status === "pending") {
      this.executions.push(result);
    }
    this.onExecute?.(result, request);
    return result;
  }

  async query(providerRefundId: string): Promise<RefundResult | null> {
    return this.byRefundId.get(providerRefundId) ?? null;
  }

  distinctRefundIds(): string[] {
    return [...new Set(this.executions.map((result) => String(result.providerRefundId)))];
  }
}

function newRig(input: Partial<RefundTransaction> = {}) {
  const store = new FakeStore({ id: TX_ID, amount: 100, ...input });
  const provider = new FakeProvider();
  return { store, provider, deps: store.deps(provider) };
}

function refundRequest(
  store: FakeStore,
  provider: FakeProvider,
  input: { operationId?: string; amount?: number | null },
): Promise<RefundOutcome> {
  return executeRefund(store.deps(provider), {
    transaction: store.transaction,
    operationId: input.operationId,
    requestedAmount: input.amount ?? null,
    reason: "teste",
    requestedBy: "seller-1",
    providerPaymentId: String(store.transaction.provider_payment_id ?? ""),
  });
}

function expectOk(outcome: RefundOutcome): asserts outcome is Extract<RefundOutcome, { ok: true }> {
  if (!outcome.ok) assert.fail(`esperava sucesso, veio ${outcome.code}: ${outcome.message}`);
}

function expectFail(outcome: RefundOutcome): asserts outcome is Extract<RefundOutcome, { ok: false }> {
  if (outcome.ok) assert.fail(`esperava falha, veio sucesso (${outcome.status})`);
}

/* ── F-01: identidade persistente ────────────────────────────────────────── */

test("F-01: persiste operation_id e chave ANTES de chamar o provedor", async () => {
  const { store, provider } = newRig({ amount: 100 });
  const operationId = op();

  let persistedAtCall: Row | null = null;
  provider.onCall = () => {
    const row = store.byOperation(operationId);
    // Cópia: a linha é mutada depois (approved) pelo fluxo.
    persistedAtCall = row ? { ...row } : null;
  };

  const outcome = await refundRequest(store, provider, { operationId, amount: 40 });
  expectOk(outcome);

  assert.ok(persistedAtCall, "a linha precisa existir antes da chamada ao provedor");
  const row = persistedAtCall as Row;
  assert.equal(row.status, "pending");
  assert.equal(row.operation_id, operationId);
  assert.equal(row.idempotency_key, provider.calls[0]!.idempotencyKey);
  assert.equal(row.dedupe_key, TX_ID, "guarda de ambiguidade gravada na reserva");
  assert.match(String(row.idempotency_key), new RegExp(operationId));
  assert.equal(outcome.state.refundedAmount, 40);
});

test("F-01: sem operation_id o SERVIDOR gera e persiste uma identidade estável", async () => {
  const { store, provider } = newRig({ amount: 100 });

  const outcome = await refundRequest(store, provider, { amount: 25 });
  expectOk(outcome);

  assert.equal(store.rows.length, 1);
  const row = store.rows[0]!;
  assert.match(String(row.operation_id), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(provider.calls[0]!.idempotencyKey, row.idempotency_key);
});

test("F-01: timeout não perde a operação; retry reusa a MESMA chave", async () => {
  const { store, provider } = newRig({ amount: 100 });
  store.official = { amount: null, known: false };
  const operationId = op();
  provider.timeOutOnce();

  const first = await refundRequest(store, provider, { operationId, amount: 40 });
  expectFail(first);
  assert.equal(first.code, "provider_unconfirmed");
  assert.equal(first.retryable, true);
  assert.equal(first.providerExecuted, false);
  assert.equal(first.pendingOperation?.operationId, operationId);
  assert.equal(first.pendingOperation?.providerAcknowledged, false);

  const persisted = store.byOperation(operationId);
  assert.equal(persisted?.status, "pending");
  assert.ok(persisted?.idempotency_key, "chave sobrevive ao timeout");

  const second = await refundRequest(store, provider, { operationId, amount: 40 });
  expectOk(second);
  assert.equal(second.status, "approved");
  assert.equal(provider.calls.length, 2);
  assert.equal(provider.calls[0]!.idempotencyKey, provider.calls[1]!.idempotencyKey);
  assert.equal(provider.distinctRefundIds().length, 1, "um único reembolso real");

  const third = await refundRequest(store, provider, { operationId });
  expectOk(third);
  assert.equal(third.reused, true);
  assert.equal(provider.calls.length, 2, "retry de operação concluída não chama o provedor");
});

test("F-01: nova operação é recusada enquanto houver pendência ambígua", async () => {
  const { store, provider } = newRig({ amount: 100 });
  store.official = { amount: null, known: false };
  const operationId = op();
  provider.timeOutOnce();

  const first = await refundRequest(store, provider, { operationId, amount: 40 });
  expectFail(first);

  const blocked = await refundRequest(store, provider, { operationId: op(), amount: 40 });
  expectFail(blocked);
  assert.equal(blocked.code, "pending_operation");
  assert.equal(blocked.retryable, true);
  assert.equal(blocked.pendingOperation?.operationId, operationId);
  assert.equal(provider.calls.length, 1, "nada novo foi enviado ao provedor");

  // A pendência NUNCA é liberada sozinha por reload/tempo.
  assert.equal(store.pending().length, 1);
});

test("F-01: pendência reconhecida pelo provedor não é reenviada", async () => {
  const { store, provider } = newRig({ amount: 100 });
  provider.nextStatus = "pending";
  const operationId = op();

  const first = await refundRequest(store, provider, { operationId, amount: 40 });
  expectOk(first);
  assert.equal(first.status, "pending");
  assert.equal(first.pending, true);
  assert.equal(first.providerRefundId, "re_1");

  const retry = await refundRequest(store, provider, { operationId });
  expectOk(retry);
  assert.equal(retry.status, "pending");
  assert.equal(retry.reused, true);
  assert.equal(provider.calls.length, 1, "retry não reenvia reembolso pendente");

  const other = await refundRequest(store, provider, { operationId: op(), amount: 40 });
  expectFail(other);
  assert.equal(other.code, "pending_confirmation");
  assert.equal(other.pendingOperation?.operationId, operationId);
  assert.equal(provider.calls.length, 1);
});

test("F-01: recusa encerra a operação; nova tentativa usa operação nova", async () => {
  const { store, provider } = newRig({ amount: 100 });
  provider.nextStatus = "failed";
  const refused = op();

  const first = await refundRequest(store, provider, { operationId: refused, amount: 40 });
  expectOk(first);
  assert.equal(first.status, "failed");
  assert.equal(first.amount, 0);

  const replay = await refundRequest(store, provider, { operationId: refused, amount: 40 });
  expectFail(replay);
  assert.equal(replay.code, "operation_refused");
  assert.equal(provider.calls.length, 1);

  provider.nextStatus = "approved";
  const fresh = await refundRequest(store, provider, { operationId: op(), amount: 40 });
  expectOk(fresh);
  assert.equal(fresh.status, "approved");
  assert.equal(provider.calls.length, 2);
  assert.notEqual(provider.calls[0]!.idempotencyKey, provider.calls[1]!.idempotencyKey);
});

test("F-01: operação inválida falha fechado antes do provedor", async () => {
  const { store, provider } = newRig({ amount: 100 });

  const invalid = await executeRefund(store.deps(provider), {
    transaction: store.transaction,
    operationId: "não-é-uuid",
    requestedAmount: 40,
    providerPaymentId: "mp-payment-1",
  });
  expectFail(invalid);
  assert.equal(invalid.httpStatus, 400);
  assert.equal(invalid.code, "invalid_operation_id");
  assert.equal(provider.calls.length, 0);

  const tooMuch = await refundRequest(store, provider, { operationId: op(), amount: 150 });
  expectFail(tooMuch);
  assert.equal(tooMuch.code, "exceeds_balance");
  assert.equal(provider.calls.length, 0);
});

test("F-01: schema ausente falha fechado (503) sem chamar o provedor", async () => {
  const { store, provider } = newRig({ amount: 100 });
  store.claimError = { ok: false, code: "schema_missing", message: "column does not exist" };

  const outcome = await refundRequest(store, provider, { operationId: op(), amount: 40 });
  expectFail(outcome);
  assert.equal(outcome.httpStatus, 503);
  assert.equal(outcome.code, "schema_missing");
  assert.equal(provider.calls.length, 0);
  assert.equal(store.rows.length, 0);
});

test("F-01: concorrência — duas operações de mesmo valor executam UM reembolso", async () => {
  const { store, provider } = newRig({ amount: 100 });
  store.official = { amount: null, known: false };

  const [first, second] = await Promise.all([
    refundRequest(store, provider, { operationId: op(), amount: 30 }),
    refundRequest(store, provider, { operationId: op(), amount: 30 }),
  ]);

  const approved = [first, second].filter((outcome) => outcome.ok && outcome.status === "approved");
  const blocked = [first, second].filter((outcome) => !outcome.ok);
  assert.equal(approved.length, 1);
  assert.equal(blocked.length, 1);
  assert.ok(
    !blocked[0]!.ok &&
      (blocked[0]!.code === "pending_operation" || blocked[0]!.code === "pending_confirmation"),
  );
  assert.equal(provider.calls.length, 1, "o índice de pendência impede o segundo envio");
  assert.equal(provider.distinctRefundIds().length, 1);
});

test("F-01: duas operações legítimas de MESMO valor são executadas separadamente", async () => {
  const { store, provider } = newRig({ amount: 100 });
  provider.onExecute = (result) => {
    store.official = {
      amount: Number(store.official.amount ?? 0) + result.amount,
      known: true,
    };
  };

  const first = await refundRequest(store, provider, { operationId: op(), amount: 30 });
  expectOk(first);
  assert.equal(first.status, "approved");

  const second = await refundRequest(store, provider, { operationId: op(), amount: 30 });
  expectOk(second);
  assert.equal(second.status, "approved");

  assert.equal(provider.calls.length, 2);
  assert.notEqual(provider.calls[0]!.idempotencyKey, provider.calls[1]!.idempotencyKey);
  assert.equal(provider.distinctRefundIds().length, 2);
  assert.equal(store.transaction.refunded_amount, 60);
  assert.equal(second.state.refundedAmount, 60);
});

/* ── F-02: snapshots do provedor não são somáveis ────────────────────────── */

test("F-02: linha de snapshot do webhook não infla o saldo (30 + 30 ≠ 90)", async () => {
  const { store, provider, deps } = newRig({ amount: 100 });
  const operationId = op();

  // Reembolso real de 30 já aprovado.
  store.seed({
    id: "refund-real",
    amount: 30,
    status: "approved",
    provider_refund_id: "re_real",
    operation_id: operationId,
    entry_kind: "operation",
    requested_by: "seller-1",
  });
  // Duas linhas anônimas do webhook antigo (F-02): espelhos do total oficial.
  store.seed({ id: "snapshot-1", amount: 30, status: "approved", entry_kind: "snapshot", requested_by: null });
  store.seed({ id: "snapshot-2", amount: 30, status: "approved", entry_kind: "snapshot", requested_by: null });

  const reconciled = await reconcileTransactionRefunds(deps, {
    transaction: store.transaction,
    official: { amount: 30, known: true },
    currentStatus: "captured",
  });

  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.state.refundedAmount, 30, "snapshots não somam dinheiro");
  assert.equal(reconciled.state.ledgerMinor, 3000);
  assert.equal(provider.calls.length, 0);
  assert.equal(store.rows.length, 3, "histórico permanece auditável");
});

test("F-02: snapshot legado sem entry_kind é reconhecido pela estrutura", async () => {
  const { store, deps } = newRig({ amount: 100 });
  store.seed({
    id: "refund-real",
    amount: 30,
    status: "approved",
    provider_refund_id: "re_real",
    operation_id: op(),
    requested_by: "seller-1",
  });
  // Código antigo: aprovado, sem id do provedor, sem operação, sem solicitante.
  store.seed({
    id: "legacy-webhook",
    amount: 30,
    status: "approved",
    entry_kind: null,
    provider_refund_id: null,
    operation_id: null,
    requested_by: null,
  });

  const reconciled = await reconcileTransactionRefunds(deps, {
    transaction: store.transaction,
    official: { amount: 30, known: true },
    currentStatus: "captured",
  });

  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.state.refundedAmount, 30);
});

test("F-02: webhook duplicado não aprova pendência sozinho", async () => {
  const { store, deps } = newRig({ amount: 100 });
  store.seed({
    id: "pending-1",
    amount: 40,
    status: "pending",
    operation_id: op(),
    entry_kind: "operation",
    requested_by: "seller-1",
    dedupe_key: TX_ID,
  });

  // Total oficial ainda não reflete o reembolso pendente.
  const reconciled = await reconcileTransactionRefunds(deps, {
    transaction: store.transaction,
    official: { amount: 0, known: true },
    currentStatus: "captured",
  });

  assert.equal(reconciled.ok, true);
  assert.deepEqual(reconciled.approvedIds, []);
  assert.equal(store.rows[0]!.status, "pending");
  assert.equal(reconciled.state.refundedAmount, 0);
});

/* ── F-03: reembolso duplicado do provedor ───────────────────────────────── */

test("F-03: duplicata cancela a linha redundante sem copiar provider_refund_id", async () => {
  const { store, provider } = newRig({ amount: 100 });
  const original = store.seed({
    id: "refund-original",
    amount: 40,
    status: "approved",
    provider_refund_id: "re_dup",
    operation_id: op(),
    requested_by: "seller-1",
  });
  store.official = { amount: 40, known: true };
  provider.fixedRefundId = "re_dup";

  const operationId = op();
  const outcome = await refundRequest(store, provider, { operationId, amount: 40 });
  expectOk(outcome);
  assert.equal(outcome.status, "approved");
  assert.equal(outcome.reused, true);
  assert.equal(outcome.providerRefundId, "re_dup");
  assert.equal(outcome.state.refundedAmount, 40, "não soma duas vezes o mesmo reembolso");

  const redundant = store.byOperation(operationId);
  assert.ok(redundant);
  assert.equal(redundant!.status, "cancelled");
  assert.equal(redundant!.provider_refund_id, null, "NUNCA copia o id do reembolso original");
  assert.equal(redundant!.dedupe_key, null);

  assert.equal(original.status, "approved");
  assert.equal(original.provider_refund_id, "re_dup");
  assert.equal(store.pending().length, 0, "nenhuma pendência presa");
});

test("F-03: falha ao cancelar a duplicata NÃO devolve sucesso", async () => {
  const { store, provider } = newRig({ amount: 100 });
  store.seed({
    id: "refund-original",
    amount: 40,
    status: "approved",
    provider_refund_id: "re_dup",
    operation_id: op(),
    requested_by: "seller-1",
  });
  store.official = { amount: 40, known: true };
  provider.fixedRefundId = "re_dup";

  const operationId = op();
  let failures = 1;
  store.onRefundUpdate = (row, patch) => {
    if (row.operation_id === operationId && patch.status === "cancelled" && failures > 0) {
      failures -= 1;
      return true;
    }
    return false;
  };

  const failed = await refundRequest(store, provider, { operationId, amount: 40 });
  expectFail(failed);
  assert.equal(failed.httpStatus, 503);
  assert.equal(failed.code, "local_persist_failed");
  assert.equal(failed.providerExecuted, true, "o provedor já havia executado");
  assert.equal(failed.retryable, true);

  const stuck = store.byOperation(operationId);
  assert.equal(stuck?.status, "pending", "não finge que cancelou");
  assert.equal(stuck?.provider_refund_id, null);

  // Retry da MESMA operação resolve a duplicata sem novo reembolso.
  const retried = await refundRequest(store, provider, { operationId });
  expectOk(retried);
  assert.equal(retried.status, "approved");
  assert.equal(retried.reused, true);
  assert.equal(store.byOperation(operationId)?.status, "cancelled");
  assert.equal(store.pending().length, 0);
  assert.equal(provider.distinctRefundIds().length, 1, "nenhum reembolso novo");
});

/* ── F-06A: falha fechada na persistência ────────────────────────────────── */

test("F-06A: falha ao gravar a linha devolve local_persist_failed e recupera sem novo reembolso", async () => {
  const { store, provider, deps } = newRig({ amount: 100 });
  store.official = { amount: 0, known: true };
  const operationId = op();

  let failures = 1;
  store.onRefundUpdate = (row, patch) => {
    if (row.operation_id === operationId && patch.status === "approved" && failures > 0) {
      failures -= 1;
      return true;
    }
    return false;
  };

  const outcome = await refundRequest(store, provider, { operationId, amount: 40 });
  expectFail(outcome);
  assert.equal(outcome.httpStatus, 503);
  assert.equal(outcome.code, "local_persist_failed");
  assert.equal(outcome.providerExecuted, true);
  assert.equal(outcome.retryable, true);
  assert.equal(outcome.pendingOperation?.providerRefundId, "re_1");

  const row = store.byOperation(operationId);
  assert.equal(row?.status, "pending", "sem sucesso definitivo sem estado gravado");
  assert.equal(row?.provider_refund_id, null);
  assert.equal(provider.calls.length, 1);

  // Recuperação: o total oficial agora comprova o reembolso. O retry aprova
  // localmente e NÃO chama o provedor de novo.
  store.official = { amount: 40, known: true };
  const recovered = await refundRequest(store, provider, { operationId });
  expectOk(recovered);
  assert.equal(recovered.status, "approved");
  assert.equal(recovered.reused, true);
  assert.equal(provider.calls.length, 1, "nenhum reembolso novo na recuperação");
  assert.equal(store.byOperation(operationId)?.status, "approved");
  assert.equal(store.transaction.refunded_amount, 40);

  // Sanidade: a reconciliação do painel também não reembolsa.
  const refreshed = await reconcileTransactionRefunds(deps, {
    transaction: store.transaction,
    official: store.official,
    currentStatus: "captured",
  });
  assert.equal(refreshed.ok, true);
  assert.equal(provider.calls.length, 1);
});

test("F-06A: falha ao gravar a transação é reportada e recuperável", async () => {
  const { store, provider, deps } = newRig({ amount: 100 });
  store.official = { amount: 0, known: true };
  store.failTransactionUpdates = 1;

  const outcome = await refundRequest(store, provider, { operationId: op(), amount: 40 });
  expectFail(outcome);
  assert.equal(outcome.code, "local_persist_failed");
  assert.equal(outcome.providerExecuted, true);
  assert.equal(outcome.retryable, true);

  // A linha foi gravada; só o espelho da transação falhou.
  assert.equal(store.rows[0]!.status, "approved");
  assert.equal(store.transaction.refunded_amount, 0);

  store.official = { amount: 40, known: true };
  const recovered = await reconcileTransactionRefunds(deps, {
    transaction: store.transaction,
    official: store.official,
    currentStatus: "captured",
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.state.refundedAmount, 40);
  assert.equal(store.transaction.refunded_amount, 40);
  assert.equal(provider.calls.length, 1, "reconciliação nunca executa reembolso");
});

test("F-06A: retry de operação aprovada reconcilia o espelho sem novo reembolso", async () => {
  const { store, provider } = newRig({ amount: 100 });
  const operationId = op();
  store.seed({
    id: "refund-aprovado",
    amount: 40,
    status: "approved",
    provider_refund_id: "re_1",
    operation_id: operationId,
    idempotency_key: "refund:mp-payment-1:" + operationId,
    requested_by: "seller-1",
  });
  store.official = { amount: 40, known: true };

  const retry = await refundRequest(store, provider, { operationId });
  expectOk(retry);
  assert.equal(retry.status, "approved");
  assert.equal(retry.reused, true);
  assert.equal(provider.calls.length, 0);
  assert.equal(store.transaction.refunded_amount, 40);
});

/* ── F-06B: total oficial desconhecido ───────────────────────────────────── */

test("F-06B: total oficial desconhecido NÃO aprova pendência", async () => {
  const { store, deps } = newRig({ amount: 100 });
  const operationId = op();
  store.seed({
    id: "pending-1",
    amount: 40,
    status: "pending",
    provider_refund_id: "re_pending",
    operation_id: operationId,
    requested_by: "seller-1",
    dedupe_key: TX_ID,
  });

  const reconciled = await reconcileTransactionRefunds(deps, {
    transaction: store.transaction,
    official: { amount: null, known: false },
    currentStatus: "captured",
  });

  assert.equal(reconciled.ok, true);
  assert.deepEqual(reconciled.approvedIds, []);
  assert.equal(reconciled.state.snapshotKnown, false);
  assert.equal(reconciled.state.refundedAmount, 0);
  assert.equal(store.rows[0]!.status, "pending", "nada foi confirmado sem prova oficial");
  assert.equal(store.transaction.refunded_amount, 0);
});

test("F-06B: total oficial desconhecido preserva o saldo já conhecido (piso monotônico)", async () => {
  const { store, deps } = newRig({ amount: 100 });
  store.transaction.refunded_amount = 30;
  store.transaction.status = "partially_refunded";
  store.seed({
    id: "refund-1",
    amount: 30,
    status: "approved",
    provider_refund_id: "re_1",
    operation_id: op(),
    requested_by: "seller-1",
  });

  const reconciled = await reconcileTransactionRefunds(deps, {
    transaction: store.transaction,
    official: { amount: null, known: false },
    currentStatus: "partially_refunded",
  });

  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.state.refundedAmount, 30, "o saldo não regride");
  assert.equal(reconciled.state.snapshotKnown, false);
});
