/**
 * Orquestração de reembolsos — auditoria 2.1.3 (F-01, F-03, F-06A).
 *
 * Este módulo concentra o fluxo que antes vivia no handler e por isso não podia
 * ser exercitado por testes reais (o handler importa Deno/esm.sh). Todas as
 * dependências são injetadas: banco, provedor, relógio e log.
 *
 * Garantias implementadas aqui:
 *
 *  F-01 (identidade persistente da operação)
 *   • o `operation_id` e a CHAVE de idempotência são persistidos antes de
 *     chamar o provedor; retry/reload/logout/timeout reusam os mesmos valores;
 *   • a chave persistida vence a derivada (sobrevive à troca de
 *     `provider_payment_id`);
 *   • enquanto existir operação ambígua (pending) para a transação, uma NOVA
 *     operação é recusada com os dados da pendência para retry;
 *   • estados distintos: aprovado, pendente, recusado, cancelado, desconhecido
 *     e "provedor confirmou / persistência local falhou".
 *
 *  F-03 (reembolso duplicado do provedor)
 *   • a linha redundante é CANCELADA sem copiar o `provider_refund_id` da linha
 *     original (isso violava o índice único e deixava a linha presa em pending);
 *   • a operação original é preservada; erros de persistência são verificados.
 *
 *  F-06A (falha fechada)
 *   • nunca devolve sucesso financeiro definitivo sem que o ledger E a
 *     transação tenham sido persistidos;
 *   • se o provedor executou o reembolso e a gravação local falhou, devolve
 *     `local_persist_failed` + `provider_executed: true` (sem repetir reembolso).
 *
 * Módulo puro de I/O: importável no Node para testes com mocks.
 */
import {
  computeRefundState,
  isSnapshotEntry,
  newRefundOperationId,
  normalizeRefundOperationId,
  planRefund,
  reconcilePendingRefunds,
  refundProviderKey,
  type RefundLedgerEntry,
  type RefundState,
} from "./refunds.ts";
import type { PaymentProviderKey, PaymentStatus, RefundResult } from "./types.ts";

/* ── Tipos de linha (formato do banco) ───────────────────────────────────── */

export type RefundRecord = {
  id: string;
  transaction_id: string;
  catalog_id?: string | null;
  amount: number;
  status: string;
  provider_refund_id: string | null;
  operation_id?: string | null;
  entry_kind?: string | null;
  idempotency_key?: string | null;
  requested_by?: string | null;
  created_at?: string | null;
  last_error?: string | null;
};

export type RefundTransaction = {
  id: string;
  order_id: string;
  catalog_id: string;
  provider: PaymentProviderKey;
  status: PaymentStatus;
  provider_status?: string | null;
  amount: number;
  currency: string | null;
  provider_payment_id: string | null;
  provider_order_id: string | null;
  refunded_amount?: number | null;
};

export type OfficialRefunded = {
  /** Total oficial informado pelo provedor. */
  amount: number | null;
  /** `false` = desconhecido (não pode confirmar nem aprovar nada). */
  known: boolean;
};

export type PersistResult = {
  ok: boolean;
  error?: string;
  /** Conflito conhecido do banco (índice único). */
  conflict?: "provider_refund_id" | "pending" | "operation" | "schema_missing";
};

export type RefundClaimInput = {
  transactionId: string;
  catalogId: string;
  provider: PaymentProviderKey;
  amount: number;
  reason: string | null;
  requestedBy: string | null;
  operationId: string;
  idempotencyKey: string;
  /** Só linhas `pending` recebem `dedupe_key` (guarda de ambiguidade). */
  dedupeKey: string | null;
};

export type RefundClaimResult =
  | { ok: true; row: RefundRecord; created: boolean }
  | {
      ok: false;
      code: "operation_exists" | "pending_exists" | "schema_missing" | "error";
      message?: string;
      row?: RefundRecord | null;
    };

export type RefundUpdatePatch = {
  status?: string;
  providerRefundId?: string | null;
  amount?: number;
  idempotencyKey?: string | null;
  clearDedupeKey?: boolean;
  lastError?: string | null;
  lastAttemptAt?: string | null;
};

export type RefundFlowDeps = {
  listRefunds(transactionId: string): Promise<RefundRecord[]>;
  findRefundByOperation(
    transactionId: string,
    operationId: string,
  ): Promise<RefundRecord | null>;
  findRefundByProviderId(
    provider: PaymentProviderKey,
    providerRefundId: string,
  ): Promise<RefundRecord | null>;
  listPendingRefunds(transactionId: string): Promise<RefundRecord[]>;
  claimRefundOperation(input: RefundClaimInput): Promise<RefundClaimResult>;
  updateRefundRecord(refundId: string, patch: RefundUpdatePatch): Promise<PersistResult>;
  updateTransaction(input: {
    transactionId: string;
    status: PaymentStatus;
    providerStatus: string | null;
    refundedAmount: number;
  }): Promise<PersistResult>;
  syncOrderPayment(input: {
    orderId: string;
    provider: PaymentProviderKey;
    status: PaymentStatus;
    transactionId: string;
  }): Promise<PersistResult>;
  readOfficialRefunded(
    transaction: RefundTransaction,
    providerPaymentId: string,
  ): Promise<OfficialRefunded>;
  refund(input: {
    providerPaymentId: string;
    amount: number;
    currency: string;
    reason: string | null;
    idempotencyKey: string;
  }): Promise<RefundResult>;
  /**
   * Consulta de um reembolso existente (reconciliação). NUNCA cria reembolso.
   */
  queryRefund?(providerRefundId: string): Promise<RefundResult | null>;
  log?(event: string, detail?: unknown): void;
};

/* ── Resultado ───────────────────────────────────────────────────────────── */

export type PendingOperationView = {
  operationId: string | null;
  amount: number;
  providerRefundId: string | null;
  /** `true` quando o provedor já confirmou o envio (aguarda confirmação). */
  providerAcknowledged: boolean;
};

export type RefundOutcome =
  | {
      ok: true;
      httpStatus: number;
      status: "approved" | "pending" | "failed" | "cancelled";
      amount: number;
      providerRefundId: string | null;
      paymentStatus: PaymentStatus;
      pending: boolean;
      reused: boolean;
      operationId: string;
      state: RefundState;
    }
  | {
      ok: false;
      httpStatus: number;
      code: string;
      message: string;
      operationId: string | null;
      retryable: boolean;
      /**
       * `true` quando o provedor EXECUTOU (ou pode ter executado) o reembolso e
       * somente a gravação local falhou. O painel nunca deve induzir repetição.
       */
      providerExecuted: boolean;
      pendingOperation?: PendingOperationView;
    };

function toLedger(rows: RefundRecord[]): RefundLedgerEntry[] {
  return rows.map((row) => ({
    id: row.id,
    amount: Number(row.amount ?? 0),
    status: row.status,
    providerRefundId: row.provider_refund_id,
    operationId: row.operation_id ?? null,
    createdAt: row.created_at ?? null,
    entryKind: row.entry_kind ?? null,
    requestedBy: row.requested_by ?? null,
  }));
}

function pendingView(row: RefundRecord): PendingOperationView {
  return {
    operationId: row.operation_id ?? null,
    amount: Number(row.amount ?? 0),
    providerRefundId: row.provider_refund_id,
    providerAcknowledged: !!row.provider_refund_id,
  };
}

function errorOutcome(input: {
  httpStatus: number;
  code: string;
  message: string;
  operationId?: string | null;
  retryable?: boolean;
  providerExecuted?: boolean;
  pendingOperation?: PendingOperationView;
}): RefundOutcome {
  return {
    ok: false,
    httpStatus: input.httpStatus,
    code: input.code,
    message: input.message,
    operationId: input.operationId ?? null,
    retryable: input.retryable ?? false,
    providerExecuted: input.providerExecuted ?? false,
    ...(input.pendingOperation ? { pendingOperation: input.pendingOperation } : {}),
  };
}

function approvedOutcome(input: {
  operationId: string;
  row: RefundRecord;
  state: RefundState;
  reused: boolean;
}): RefundOutcome {
  return {
    ok: true,
    httpStatus: 200,
    status: "approved",
    amount: Number(input.row.amount ?? 0),
    providerRefundId: input.row.provider_refund_id,
    paymentStatus: input.state.status,
    pending: false,
    reused: input.reused,
    operationId: input.operationId,
    state: input.state,
  };
}

function pendingOutcome(input: {
  operationId: string;
  row: RefundRecord;
  state: RefundState;
  reused: boolean;
}): RefundOutcome {
  return {
    ok: true,
    httpStatus: 200,
    status: "pending",
    amount: Number(input.row.amount ?? 0),
    providerRefundId: input.row.provider_refund_id,
    paymentStatus: input.state.status,
    pending: true,
    reused: input.reused,
    operationId: input.operationId,
    state: input.state,
  };
}

/* ── Estado consolidado + persistência ───────────────────────────────────── */

async function loadState(input: {
  deps: RefundFlowDeps;
  transaction: RefundTransaction;
  official: OfficialRefunded;
  currentStatus: PaymentStatus;
}): Promise<{ state: RefundState; ledger: RefundRecord[] }> {
  const ledger = await input.deps.listRefunds(input.transaction.id);
  const state = computeRefundState({
    totalAmount: Number(input.transaction.amount ?? 0),
    currency: input.transaction.currency,
    ledger: toLedger(ledger),
    snapshotRefunded: input.official.amount,
    snapshotKnown: input.official.known,
    // Piso monotônico: uma resposta incompleta do provedor nunca faz o saldo
    // já persistido regredir (F-06B).
    currentRefunded: Number(input.transaction.refunded_amount ?? 0),
    currentStatus: input.currentStatus,
  });
  return { state, ledger };
}

async function persistState(input: {
  deps: RefundFlowDeps;
  transaction: RefundTransaction;
  state: RefundState;
}): Promise<PersistResult> {
  const written = await input.deps.updateTransaction({
    transactionId: input.transaction.id,
    status: input.state.status,
    providerStatus: input.transaction.provider_status ?? null,
    refundedAmount: input.state.refundedAmount,
  });
  if (!written.ok) return written;

  // Espelho no pedido é secundário: a transação é a fonte da verdade. Uma
  // falha aqui é registrada, mas não invalida o reembolso já persistido.
  const mirrored = await input.deps.syncOrderPayment({
    orderId: input.transaction.order_id,
    provider: input.transaction.provider,
    status: input.state.status,
    transactionId: input.transaction.id,
  });
  if (!mirrored.ok) {
    input.deps.log?.("order_sync_failed", {
      transaction: input.transaction.id,
      error: mirrored.error,
    });
  }
  return { ok: true };
}

/* ── Execução do reembolso ───────────────────────────────────────────────── */

export async function executeRefund(
  deps: RefundFlowDeps,
  input: {
    transaction: RefundTransaction;
    operationId?: unknown;
    requestedAmount?: number | null;
    reason?: string | null;
    requestedBy?: string | null;
    providerPaymentId: string;
  },
): Promise<RefundOutcome> {
  const { transaction } = input;

  const rawOperationId = input.operationId;
  const providedOperationId = normalizeRefundOperationId(rawOperationId);
  const hasRaw =
    rawOperationId !== undefined &&
    rawOperationId !== null &&
    String(rawOperationId).trim() !== "";
  if (hasRaw && !providedOperationId) {
    return errorOutcome({
      httpStatus: 400,
      code: "invalid_operation_id",
      message: "operation_id inválido.",
    });
  }
  const operationId = providedOperationId ?? newRefundOperationId();

  const existing = await deps.findRefundByOperation(transaction.id, operationId);
  const pendingRows = await deps.listPendingRefunds(transaction.id);
  const otherPending = pendingRows.filter(
    (row) => row.id !== existing?.id && !isSnapshotEntry(toLedgerRow(row)),
  );

  // ── Retry da MESMA operação ────────────────────────────────────────────
  if (existing) {
    if (existing.status === "approved") {
      const { state } = await loadState({
        deps,
        transaction,
        official: { amount: null, known: false },
        currentStatus: transaction.status,
      });
      // F-06A: a operação está no ledger, mas o espelho na transação pode ter
      // falhado na primeira tentativa. Reconcilia antes de confirmar de novo.
      const persisted = await persistState({ deps, transaction, state });
      if (!persisted.ok) {
        return errorOutcome({
          httpStatus: 503,
          code: "local_persist_failed",
          message:
            "O reembolso está registrado, mas o saldo local não foi atualizado. Atualize o pagamento para reconciliar.",
          operationId,
          retryable: true,
          providerExecuted: true,
          pendingOperation: {
            operationId,
            amount: Number(existing.amount ?? 0),
            providerRefundId: existing.provider_refund_id,
            providerAcknowledged: true,
          },
        });
      }
      return approvedOutcome({ operationId, row: existing, state, reused: true });
    }
    if (existing.status === "cancelled") {
      return errorOutcome({
        httpStatus: 409,
        code: "operation_cancelled",
        message: "Esta operação de reembolso já foi encerrada. Inicie uma nova operação.",
        operationId,
      });
    }
    if (existing.status === "failed") {
      // Reenviar a MESMA chave devolveria a mesma recusa. Uma tentativa nova
      // exige um operation_id novo (nunca reaproveitar a chave recusada).
      return errorOutcome({
        httpStatus: 409,
        code: "operation_refused",
        message:
          "O provedor recusou esta operação. Inicie uma nova tentativa de reembolso.",
        operationId,
      });
    }
    if (existing.provider_refund_id) {
      const { state } = await loadState({
        deps,
        transaction,
        official: { amount: null, known: false },
        currentStatus: transaction.status,
      });
      return pendingOutcome({ operationId, row: existing, state, reused: true });
    }
    // Pendente SEM id do provedor = resultado desconhecido. Retry reusa a
    // MESMA chave persistida (F-01) — nunca cria outra operação.
    if (otherPending.length > 0) {
      return errorOutcome({
        httpStatus: 409,
        code: "ambiguous_operations",
        message:
          "Existem operações de reembolso sem confirmação. Verifique no provedor antes de continuar.",
        operationId,
        pendingOperation: pendingView(existing),
      });
    }

    // F-06A/F-01: ANTES de reenviar ao provedor, tenta provar pelo TOTAL
    // OFICIAL que o reembolso já foi executado. Se provar, aprova localmente e
    // NÃO chama o provedor de novo (nenhum reembolso novo é criado).
    const recoveryPaymentId = String(input.providerPaymentId ?? "").trim();
    if (recoveryPaymentId) {
      const officialBefore = await deps.readOfficialRefunded(transaction, recoveryPaymentId);
      if (officialBefore.known) {
        const recovered = await reconcileTransactionRefunds(deps, {
          transaction,
          official: officialBefore,
          currentStatus: transaction.status,
        });
        if (recovered.ok) {
          const refreshed = await deps.findRefundByOperation(transaction.id, operationId);
          if (refreshed?.status === "approved") {
            return approvedOutcome({
              operationId,
              row: refreshed,
              state: recovered.state,
              reused: true,
            });
          }
          if (refreshed?.status === "failed" || refreshed?.status === "cancelled") {
            return errorOutcome({
              httpStatus: 409,
              code: "operation_refused",
              message:
                "O provedor recusou esta operação. Inicie uma nova tentativa de reembolso.",
              operationId,
            });
          }
        }
      }
    }
  }

  // ── Nova operação bloqueada enquanto houver pendência ambígua ──────────
  if (!existing && otherPending.length > 0) {
    const blocker = otherPending[0]!;
    return errorOutcome({
      httpStatus: 409,
      code: blocker.provider_refund_id ? "pending_confirmation" : "pending_operation",
      message: blocker.provider_refund_id
        ? "Já existe um reembolso aguardando confirmação do provedor. Verifique antes de reembolsar de novo."
        : "A tentativa anterior ficou sem confirmação. Retome a mesma operação antes de criar outra.",
      operationId,
      retryable: true,
      pendingOperation: pendingView(blocker),
    });
  }

  const providerPaymentId = String(input.providerPaymentId ?? "").trim();
  if (!providerPaymentId) {
    return errorOutcome({
      httpStatus: 409,
      code: "provider_payment_missing",
      message: "Pagamento ainda não identificado no provedor.",
      operationId,
    });
  }

  const official = await deps.readOfficialRefunded(transaction, providerPaymentId);
  const ledger = await deps.listRefunds(transaction.id);

  const plan = planRefund({
    totalAmount: Number(transaction.amount ?? 0),
    currency: transaction.currency,
    requestedAmount: existing
      ? Number(existing.amount)
      : input.requestedAmount === undefined || input.requestedAmount === null
        ? null
        : Number(input.requestedAmount),
    ledger: toLedger(ledger),
    snapshotRefunded: official.amount,
    snapshotKnown: official.known,
    currentStatus: transaction.status,
    operationId,
  });
  if (!plan.ok) {
    const httpStatus =
      plan.code === "invalid_amount" ||
      plan.code === "precision" ||
      plan.code === "invalid_operation_id"
        ? 400
        : 409;
    return errorOutcome({ httpStatus, code: plan.code, message: plan.reason, operationId });
  }

  // ── Reserva persistente ANTES do provedor (F-01) ───────────────────────
  let row = existing;
  const idempotencyKey = refundProviderKey({ providerPaymentId, operationId });

  if (!row) {
    const claim = await deps.claimRefundOperation({
      transactionId: transaction.id,
      catalogId: transaction.catalog_id,
      provider: transaction.provider,
      amount: plan.amount,
      reason: input.reason ?? null,
      requestedBy: input.requestedBy ?? null,
      operationId,
      idempotencyKey,
      // A linha nasce pendente: uma única pendência por transação.
      dedupeKey: transaction.id,
    });

    if (!claim.ok) {
      if (claim.code === "schema_missing") {
        return errorOutcome({
          httpStatus: 503,
          code: "schema_missing",
          message:
            "A estrutura de reembolsos ainda não foi atualizada. Nenhum reembolso foi enviado.",
          operationId,
        });
      }
      if (claim.code === "pending_exists") {
        const blocker = claim.row ?? otherPending[0] ?? null;
        return errorOutcome({
          httpStatus: 409,
          code: "pending_operation",
          message:
            "Já existe uma operação de reembolso pendente. Retome-a antes de criar outra.",
          operationId,
          retryable: true,
          ...(blocker ? { pendingOperation: pendingView(blocker) } : {}),
        });
      }
      if (claim.code === "operation_exists" && claim.row) {
        const raced = claim.row;
        // Corrida com outra requisição da MESMA operação: cada estado tem uma
        // resposta própria — nunca devolvemos "pendente" para uma recusa.
        if (raced.status === "failed") {
          return errorOutcome({
            httpStatus: 409,
            code: "operation_refused",
            message:
              "O provedor recusou esta operação. Inicie uma nova tentativa de reembolso.",
            operationId,
          });
        }
        if (raced.status === "cancelled") {
          return errorOutcome({
            httpStatus: 409,
            code: "operation_cancelled",
            message: "Esta operação de reembolso já foi encerrada. Inicie uma nova operação.",
            operationId,
          });
        }
        if (raced.status === "approved") {
          const { state } = await loadState({
            deps,
            transaction,
            official: { amount: null, known: false },
            currentStatus: transaction.status,
          });
          // F-06A: garante que o espelho da transação reflita a operação.
          const persisted = await persistState({ deps, transaction, state });
          if (!persisted.ok) {
            return errorOutcome({
              httpStatus: 503,
              code: "local_persist_failed",
              message:
                "O reembolso está registrado, mas o saldo local não foi atualizado. Atualize o pagamento para reconciliar.",
              operationId,
              retryable: true,
              providerExecuted: true,
              pendingOperation: pendingView(raced),
            });
          }
          return approvedOutcome({ operationId, row: raced, state, reused: true });
        }
        const { state } = await loadState({
          deps,
          transaction,
          official: { amount: null, known: false },
          currentStatus: transaction.status,
        });
        return pendingOutcome({ operationId, row: raced, state, reused: true });
      }
      return errorOutcome({
        httpStatus: 503,
        code: "claim_failed",
        message: "Não foi possível registrar a operação de reembolso. Nada foi enviado.",
        operationId,
        retryable: true,
      });
    }

    row = claim.row;
  }

  // A chave persistida vence a derivada: sobrevive até a mudança do id do
  // pagamento no provedor (F-01).
  const stableKey = row.idempotency_key?.trim() || idempotencyKey;

  let result: RefundResult;
  try {
    result = await deps.refund({
      providerPaymentId,
      amount: plan.amount,
      currency: plan.currency,
      reason: input.reason ?? null,
      idempotencyKey: stableKey,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log?.("provider_unconfirmed", { transaction: transaction.id, operationId, message });
    // Resultado desconhecido: a linha continua pendente com a MESMA chave.
    const noted = await deps.updateRefundRecord(row.id, {
      idempotencyKey: stableKey,
      lastError: `provider_unconfirmed: ${message}`.slice(0, 500),
      lastAttemptAt: new Date().toISOString(),
    });
    if (!noted.ok) {
      deps.log?.("pending_note_failed", { refund: row.id, error: noted.error });
    }
    return errorOutcome({
      httpStatus: 502,
      code: "provider_unconfirmed",
      message:
        "O provedor não confirmou o reembolso. Retome a mesma operação — ela não será reembolsada duas vezes.",
      operationId,
      retryable: true,
      pendingOperation: {
        operationId,
        amount: Number(row.amount ?? plan.amount),
        providerRefundId: row.provider_refund_id,
        providerAcknowledged: false,
      },
    });
  }

  // ── Reembolso de OUTRA operação (F-03) ─────────────────────────────────
  const duplicate = result.providerRefundId
    ? await deps.findRefundByProviderId(transaction.provider, result.providerRefundId)
    : null;
  if (duplicate && duplicate.id !== row.id) {
    // NUNCA copiar o provider_refund_id para esta linha: o índice único é do
    // reembolso original e a cópia deixava a linha presa em `pending`.
    const cancelled = await deps.updateRefundRecord(row.id, {
      status: "cancelled",
      clearDedupeKey: true,
      lastError: "duplicate_provider_refund",
      lastAttemptAt: new Date().toISOString(),
    });
    if (!cancelled.ok) {
      return errorOutcome({
        httpStatus: 503,
        code: "local_persist_failed",
        message:
          "O provedor já havia executado este reembolso, mas não foi possível encerrar a operação duplicada. Verifique antes de tentar de novo.",
        operationId,
        retryable: true,
        providerExecuted: true,
        pendingOperation: pendingView(row),
      });
    }

    const { state } = await loadState({
      deps,
      transaction,
      official,
      currentStatus: transaction.status,
    });
    const persisted = await persistState({ deps, transaction, state });
    if (!persisted.ok) {
      return errorOutcome({
        httpStatus: 503,
        code: "local_persist_failed",
        message:
          "O reembolso já foi executado pelo provedor, mas o estado local não foi atualizado. Verifique no provedor antes de tentar de novo.",
        operationId,
        retryable: true,
        providerExecuted: true,
      });
    }

    return {
      ok: true,
      httpStatus: 200,
      status: duplicate.status === "pending" ? "pending" : "approved",
      amount: Number(duplicate.amount ?? 0),
      providerRefundId: result.providerRefundId,
      paymentStatus: state.status,
      pending: duplicate.status === "pending",
      reused: true,
      operationId,
      state,
    };
  }

  // ── Persistência da linha ANTES de qualquer resposta de sucesso ────────
  const saved = await deps.updateRefundRecord(row.id, {
    status: result.status,
    providerRefundId: result.providerRefundId,
    amount: result.amount,
    idempotencyKey: stableKey,
    clearDedupeKey: true,
    lastError: null,
    lastAttemptAt: new Date().toISOString(),
  });
  if (!saved.ok) {
    const providerExecuted = result.status === "approved";
    return errorOutcome({
      httpStatus: 503,
      code: saved.conflict === "provider_refund_id" ? "duplicate_provider_refund" : "local_persist_failed",
      message: providerExecuted
        ? "O provedor confirmou o reembolso, mas o registro local falhou. NÃO reembolse novamente: atualize o pagamento para reconciliar."
        : "O provedor recebeu o reembolso, mas o registro local falhou. Atualize o pagamento antes de tentar de novo.",
      operationId,
      retryable: true,
      providerExecuted,
      pendingOperation: {
        operationId,
        amount: Number(row.amount ?? plan.amount),
        providerRefundId: result.providerRefundId,
        providerAcknowledged: result.status !== "failed",
      },
    });
  }

  // Recusa do provedor: nada entrou no saldo, mas a operação foi encerrada.
  if (result.status === "failed" || result.status === "cancelled") {
    const { state } = await loadState({
      deps,
      transaction,
      official,
      currentStatus: transaction.status,
    });
    const persisted = await persistState({ deps, transaction, state });
    if (!persisted.ok) {
      return errorOutcome({
        httpStatus: 503,
        code: "local_persist_failed",
        message:
          "O provedor recusou o reembolso, mas o estado local não foi atualizado. Atualize o pagamento.",
        operationId,
        retryable: true,
      });
    }
    return {
      ok: true,
      httpStatus: 200,
      status: result.status,
      amount: 0,
      providerRefundId: result.providerRefundId,
      paymentStatus: state.status,
      pending: false,
      reused: false,
      operationId,
      state,
    };
  }

  // ── Saldo recalculado do ledger + total oficial ────────────────────────
  const officialAfter =
    result.status === "approved"
      ? await deps.readOfficialRefunded(transaction, providerPaymentId)
      : { amount: official.amount, known: official.known };
  const effectiveOfficial: OfficialRefunded = officialAfter.known
    ? officialAfter
    : official;

  const { state } = await loadState({
    deps,
    transaction,
    official: effectiveOfficial,
    currentStatus: transaction.status,
  });
  const persisted = await persistState({ deps, transaction, state });
  if (!persisted.ok) {
    return errorOutcome({
      httpStatus: 503,
      code: "local_persist_failed",
      message:
        "O reembolso foi executado pelo provedor, mas o saldo local não foi atualizado. NÃO reembolse novamente: atualize o pagamento para reconciliar.",
      operationId,
      retryable: true,
      providerExecuted: result.status === "approved",
      pendingOperation: {
        operationId,
        amount: Number(row.amount ?? plan.amount),
        providerRefundId: result.providerRefundId,
        providerAcknowledged: result.status !== "failed",
      },
    });
  }

  if (result.status === "pending") {
    return pendingOutcome({ operationId, row: { ...row, provider_refund_id: result.providerRefundId }, state, reused: false });
  }

  return {
    ok: true,
    httpStatus: 200,
    status: "approved",
    amount: result.amount,
    providerRefundId: result.providerRefundId,
    paymentStatus: state.status,
    pending: false,
    reused: false,
    operationId,
    state,
  };
}

function toLedgerRow(row: RefundRecord): RefundLedgerEntry {
  return {
    id: row.id,
    amount: Number(row.amount ?? 0),
    status: row.status,
    providerRefundId: row.provider_refund_id,
    operationId: row.operation_id ?? null,
    createdAt: row.created_at ?? null,
    entryKind: row.entry_kind ?? null,
    requestedBy: row.requested_by ?? null,
  };
}

/* ── Reconciliação (refresh) ─────────────────────────────────────────────── */

export type ReconcileResult = {
  ok: boolean;
  state: RefundState;
  approvedIds: string[];
  closedIds: string[];
  error?: string;
};

/**
 * Reconcilia pendências SEM executar reembolso:
 *  1. consulta cada pendente que tem id do provedor (quando disponível);
 *  2. aprova apenas o que o TOTAL OFICIAL comprova (ordem cronológica);
 *  3. encerra pendentes que o provedor declarou recusados/cancelados.
 *
 * F-06B: se o total oficial é desconhecido, NADA é aprovado.
 */
export async function reconcileTransactionRefunds(
  deps: RefundFlowDeps,
  input: {
    transaction: RefundTransaction;
    official: OfficialRefunded;
    currentStatus: PaymentStatus;
  },
): Promise<ReconcileResult> {
  const { transaction } = input;
  const before = await deps.listRefunds(transaction.id);
  const closedIds: string[] = [];

  if (deps.queryRefund) {
    for (const row of before) {
      if (row.status !== "pending" || !row.provider_refund_id) continue;
      let queried: RefundResult | null = null;
      try {
        queried = await deps.queryRefund(row.provider_refund_id);
      } catch (error) {
        deps.log?.("refund_query_failed", {
          refund: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      if (!queried) continue;
      if (queried.status === "approved") {
        const approved = await deps.updateRefundRecord(row.id, {
          status: "approved",
          amount: queried.amount || Number(row.amount ?? 0),
          clearDedupeKey: true,
          lastError: null,
        });
        if (!approved.ok) {
          return {
            ok: false,
            state: (
              await loadState({
                deps,
                transaction,
                official: input.official,
                currentStatus: input.currentStatus,
              })
            ).state,
            approvedIds: [],
            closedIds,
            error: approved.error ?? "persist_failed",
          };
        }
        closedIds.push(row.id);
        continue;
      }
      if (queried.status === "failed" || queried.status === "cancelled") {
        const closed = await deps.updateRefundRecord(row.id, {
          status: queried.status === "cancelled" ? "cancelled" : "failed",
          clearDedupeKey: true,
          lastError: `provider_${queried.status}`,
        });
        if (!closed.ok) {
          return {
            ok: false,
            state: (
              await loadState({
                deps,
                transaction,
                official: input.official,
                currentStatus: input.currentStatus,
              })
            ).state,
            approvedIds: [],
            closedIds,
            error: closed.error ?? "persist_failed",
          };
        }
        closedIds.push(row.id);
      }
    }
  }

  const ledger = await deps.listRefunds(transaction.id);
  const reconciliation = reconcilePendingRefunds({
    totalAmount: Number(transaction.amount ?? 0),
    currency: transaction.currency,
    ledger: toLedger(ledger),
    snapshotRefunded: input.official.amount,
    snapshotKnown: input.official.known,
    currentStatus: input.currentStatus,
  });

  const approvedIds: string[] = [];
  for (const refundId of reconciliation.approveIds) {
    const approved = await deps.updateRefundRecord(refundId, {
      status: "approved",
      clearDedupeKey: true,
      lastError: null,
    });
    if (!approved.ok) {
      return {
        ok: false,
        state: reconciliation.state,
        approvedIds,
        closedIds,
        error: approved.error ?? "persist_failed",
      };
    }
    approvedIds.push(refundId);
  }

  const finalLedger =
    approvedIds.length > 0 || closedIds.length > 0
      ? await deps.listRefunds(transaction.id)
      : ledger;
  const state = computeRefundState({
    totalAmount: Number(transaction.amount ?? 0),
    currency: transaction.currency,
    ledger: toLedger(finalLedger),
    snapshotRefunded: input.official.amount,
    snapshotKnown: input.official.known,
    // Piso: a aprovação acima NÃO usou este valor (não infla), mas o saldo
    // persistido nunca regride.
    currentRefunded: Number(transaction.refunded_amount ?? 0),
    currentStatus: input.currentStatus,
  });

  const persisted = await persistState({ deps, transaction, state });
  if (!persisted.ok) {
    return {
      ok: false,
      state,
      approvedIds,
      closedIds,
      error: persisted.error ?? "persist_failed",
    };
  }

  return { ok: true, state, approvedIds, closedIds };
}
