/**
 * Regras puras de reembolso (auditoria 2.1 — R-01 e R-02).
 *
 * Problemas corrigidos aqui:
 *
 *  • R-01: a chave de idempotência do provedor era derivada do VALOR
 *    (`refund-{capture}-{amount}`), então dois reembolsos legítimos de mesmo
 *    valor compartilhavam a chave e o segundo nunca era executado — pior, o
 *    saldo local podia ser incrementado duas vezes. Agora cada OPERAÇÃO tem um
 *    identificador próprio (`operation_id`), usado como chave no provedor e
 *    persistido para retries.
 *
 *  • R-01 (contabilidade): `refunded_amount` nunca mais é somado "no escuro".
 *    Ele é recalculado a partir do LEDGER de reembolsos aprovados (deduplicado
 *    por id do provedor/operação) e, no máximo, complementado pelo total
 *    oficial do provedor — sempre limitado ao valor da transação.
 *
 *  • R-02: toda a matemática usa unidades mínimas da moeda
 *    (`toMinorUnits`/`fromMinorUnits`), sem `* 100` fixo e sem tolerâncias de
 *    centavos. JPY (0), BRL/USD (2) e KWD (3) são tratados pela moeda real.
 *
 * Módulo puro: sem Deno, sem banco, sem rede — usado pelo Edge Function, pelo
 * painel e pelos testes locais.
 */
import {
  fromMinorUnits,
  getCurrency,
  hasSubUnitPrecision,
  resolveStoreCurrency,
  toMinorUnits,
} from "../../../../src/lib/currency.ts";
import type { PaymentStatus } from "./types.ts";

/** Linha de `payment_refunds` no formato que a contabilidade consome. */
export type RefundLedgerEntry = {
  id?: string | null;
  amount: number;
  /** `pending` | `approved` | `failed` | `cancelled` */
  status: string;
  providerRefundId?: string | null;
  operationId?: string | null;
  createdAt?: string | null;
  /**
   * `operation` = reembolso realmente executado por uma operação.
   * `snapshot` = espelho do total oficial do provedor, NUNCA somável.
   *
   * Correção da auditoria 2.1.3 (F-02): o webhook antigo gravava uma linha
   * `approved` anônima (`provider_refund_id` e `operation_id` nulos) a cada
   * aumento do total oficial. O ledger somava essa linha AO total oficial e o
   * saldo dobrava (30 → 60) quando webhook e painel corriam juntos.
   */
  entryKind?: string | null;
  requestedBy?: string | null;
};

/* ── Identificador da operação ───────────────────────────────────────────── */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Aceita apenas UUID (v4 ou não) — ids opacos, sem espaço nem path. */
export function normalizeRefundOperationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return UUID_PATTERN.test(id) ? id : null;
}

/**
 * Gera um id de operação novo.
 *
 * `crypto.randomUUID` existe no Deno, no navegador e no Node 19+. O fallback
 * mantém o módulo puro e testável em ambientes sem `crypto`.
 */
export function newRefundOperationId(): string {
  const globalCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID().toLowerCase();

  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    const index = Math.floor(Math.random() * 16);
    out += hex[index];
    if (i === 7 || i === 11 || i === 15 || i === 19) out += "-";
  }
  return out;
}

/**
 * Chave de idempotência enviada ao provedor.
 *
 * Estável para a MESMA operação (retry/timeout/duplo clique) e diferente para
 * operações distintas — mesmo que o valor seja idêntico.
 *
 * O `PayPal-Request-Id` tem limite de 108 caracteres, por isso o fallback com
 * hash quando o id do pagamento é excepcionalmente longo.
 */
export function refundProviderKey(input: {
  providerPaymentId: string;
  operationId: string;
}): string {
  const paymentId = String(input.providerPaymentId ?? "").trim();
  const operationId = String(input.operationId ?? "").trim().toLowerCase();
  const key = `refund:${paymentId}:${operationId}`;
  if (key.length <= 100) return key;
  return `refund:${paymentId.slice(0, 40)}:${hashId(`${paymentId}:${operationId}`)}`;
}

/** FNV-1a de 32 bits em hex — só para encurtar chaves longas, sem colisão prática. */
function hashId(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/* ── Ledger ──────────────────────────────────────────────────────────────── */

export type RefundLedgerTotals = {
  /** Soma dos reembolsos APROVADOS, em unidades mínimas. */
  approvedMinor: number;
  /** Soma dos reembolsos ainda pendentes (não entra no saldo). */
  pendingMinor: number;
  /** Uma entrada por reembolso real, já deduplicada. */
  approved: RefundLedgerEntry[];
  pending: RefundLedgerEntry[];
};

function normalizeStatus(status: unknown): string {
  return String(status ?? "").trim().toLowerCase();
}

/**
 * `true` quando a linha é apenas um ESPELHO do total oficial do provedor.
 *
 * Além da marca explícita (`entry_kind = 'snapshot'`), reconhece as linhas
 * anônimas gravadas pelo webhook antigo: aprovadas, sem id do provedor, sem
 * operação e sem solicitante. Elas nunca representam dinheiro adicional — o
 * total oficial já é aplicado em `snapshotRefunded`.
 *
 * A assinatura estrutural é necessária para que o defeito F-02 continue
 * corrigido mesmo antes da migration de ciclo de vida ser aplicada (código
 * antigo + migration nova, ou migration nova + código antigo).
 */
export function isSnapshotEntry(entry: RefundLedgerEntry): boolean {
  if (normalizeStatus(entry.entryKind) === "snapshot") return true;
  const providerId = String(entry.providerRefundId ?? "").trim();
  const operationId = String(entry.operationId ?? "").trim();
  const requestedBy = String(entry.requestedBy ?? "").trim();
  return (
    !providerId &&
    !operationId &&
    !requestedBy &&
    normalizeStatus(entry.status) === "approved"
  );
}

function entryAmountMinor(entry: RefundLedgerEntry, currency: string): number {
  const value = Number(entry.amount ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(0, toMinorUnits(value, currency));
}

/**
 * Agrupa linhas que representam o MESMO reembolso.
 *
 * Duas linhas podem descrever o mesmo reembolso quando compartilham o id do
 * provedor ou o id da operação (webhook + retry + reconciliação). Contar as
 * duas é exatamente o defeito R-01.
 */
function groupLedger(ledger: RefundLedgerEntry[]): RefundLedgerEntry[][] {
  const byProvider = new Map<string, number>();
  const byOperation = new Map<string, number>();
  const canonical: number[] = [];

  ledger.forEach((entry, index) => {
    const providerId = String(entry.providerRefundId ?? "").trim();
    const operationId = String(entry.operationId ?? "").trim().toLowerCase();
    let group = providerId ? byProvider.get(providerId) : undefined;
    if (group === undefined && operationId) group = byOperation.get(operationId);
    if (group === undefined) group = index;

    canonical[index] = group;
    if (providerId) byProvider.set(providerId, group);
    if (operationId) byOperation.set(operationId, group);
  });

  const groups = new Map<number, RefundLedgerEntry[]>();
  ledger.forEach((entry, index) => {
    const key = canonical[index] ?? index;
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  });
  return [...groups.values()];
}

/**
 * Totais do ledger: cada reembolso real conta UMA vez.
 *
 * Quando o mesmo reembolso aparece como `pending` e `approved`, o aprovado
 * vence (o dinheiro saiu de fato).
 */
export function refundLedgerTotals(
  ledger: RefundLedgerEntry[],
  currency: string | null | undefined,
): RefundLedgerTotals {
  const code = resolveStoreCurrency(currency);
  const totals: RefundLedgerTotals = {
    approvedMinor: 0,
    pendingMinor: 0,
    approved: [],
    pending: [],
  };

  // F-02: espelhos do total oficial nunca entram na soma.
  const operations = (Array.isArray(ledger) ? ledger : []).filter(
    (entry) => !isSnapshotEntry(entry),
  );

  for (const group of groupLedger(operations)) {
    const approved = group.find((entry) => normalizeStatus(entry.status) === "approved");
    if (approved) {
      totals.approved.push(approved);
      totals.approvedMinor += entryAmountMinor(approved, code);
      continue;
    }
    const pending = group.find((entry) => normalizeStatus(entry.status) === "pending");
    if (pending) {
      totals.pending.push(pending);
      totals.pendingMinor += entryAmountMinor(pending, code);
    }
  }

  return totals;
}

/* ── Estado consolidado (saldo + status) ─────────────────────────────────── */

export type RefundState = {
  currency: string;
  totalMinor: number;
  /** Soma do ledger aprovado. */
  ledgerMinor: number;
  /** Total oficial informado pelo provedor (0 quando desconhecido). */
  snapshotMinor: number;
  /**
   * `false` quando o provedor NÃO informou um total confiável.
   *
   * F-06B: `PARTIALLY_REFUNDED` no PayPal sem a lista oficial de refunds não
   * autoriza gravar `refundedAmount: 0` nem aprovar pendentes — o valor é
   * simplesmente desconhecido.
   */
  snapshotKnown: boolean;
  /** Saldo reembolsado efetivo (máximo entre ledger e provedor, limitado ao total). */
  refundedMinor: number;
  remainingMinor: number;
  refundedAmount: number;
  remainingAmount: number;
  status: PaymentStatus;
};

/**
 * Status financeiro derivado do saldo reembolsado.
 *
 * Nunca "regride" um pagamento já reembolsado para capturado só porque o
 * provedor omitiu o dado (mesma regra monotônica de `mergeRefundState`).
 */
export function refundStatusFor(input: {
  totalMinor: number;
  refundedMinor: number;
  currentStatus: PaymentStatus;
}): PaymentStatus {
  const total = Math.max(0, Math.round(input.totalMinor));
  const refunded = Math.max(0, Math.round(input.refundedMinor));
  // Disputa é soberana: nunca é sobrescrita por um reembolso.
  if (input.currentStatus === "disputed") return "disputed";
  if (total > 0 && refunded >= total) return "refunded";
  if (refunded > 0) return "partially_refunded";
  if (input.currentStatus === "refunded" || input.currentStatus === "partially_refunded") {
    return input.currentStatus;
  }
  return input.currentStatus;
}

/**
 * Consolida saldo reembolsado a partir do ledger e do estado oficial.
 *
 * O provedor é complemento (best-effort): se ele informar MAIS que o ledger, o
 * valor dele vale; se informar menos, o ledger prevalece. Em nenhum caso o
 * total passa do valor da transação.
 */
export function computeRefundState(input: {
  totalAmount: number;
  currency: string | null | undefined;
  ledger: RefundLedgerEntry[];
  snapshotRefunded?: number | null;
  /**
   * `false` = o provedor não informou total confiável (F-06B).
   * Padrão: conhecido quando um número foi fornecido.
   */
  snapshotKnown?: boolean;
  /**
   * Piso monotônico opcional: valor JÁ PERSISTIDO em `payment_transactions`.
   *
   * Evita que uma resposta incompleta do provedor (`PARTIALLY_REFUNDED` sem a
   * lista oficial, timeout, eventual consistency) faça o saldo regredir.
   *
   * IMPORTANTE (F-02): este piso NUNCA é passado para a decisão de aprovação de
   * pendências — ele não pode justificar confirmar dinheiro novo.
   */
  currentRefunded?: number | null;
  currentStatus: PaymentStatus;
}): RefundState {
  const currency = resolveStoreCurrency(input.currency);
  const totalMinor = Math.max(0, toMinorUnits(Number(input.totalAmount ?? 0), currency));
  const totals = refundLedgerTotals(input.ledger, currency);

  const rawSnapshot = Number(input.snapshotRefunded ?? 0);
  const snapshotKnown =
    input.snapshotKnown ?? (input.snapshotRefunded !== null && input.snapshotRefunded !== undefined);
  const snapshotMinor =
    snapshotKnown && Number.isFinite(rawSnapshot) && rawSnapshot > 0
      ? toMinorUnits(rawSnapshot, currency)
      : 0;

  const rawCurrent = Number(input.currentRefunded ?? 0);
  const currentMinor =
    Number.isFinite(rawCurrent) && rawCurrent > 0 ? toMinorUnits(rawCurrent, currency) : 0;

  const refundedMinor = Math.min(
    totalMinor,
    Math.max(0, Math.max(totals.approvedMinor, snapshotMinor, currentMinor)),
  );
  const remainingMinor = Math.max(0, totalMinor - refundedMinor);

  return {
    currency,
    totalMinor,
    ledgerMinor: totals.approvedMinor,
    snapshotMinor,
    snapshotKnown,
    refundedMinor,
    remainingMinor,
    refundedAmount: fromMinorUnits(refundedMinor, currency),
    remainingAmount: fromMinorUnits(remainingMinor, currency),
    status: refundStatusFor({
      totalMinor,
      refundedMinor,
      currentStatus: input.currentStatus,
    }),
  };
}

/* ── Plano de reembolso (validação) ──────────────────────────────────────── */

export type RefundPlan =
  | {
      ok: true;
      currency: string;
      operationId: string;
      totalMinor: number;
      refundedMinor: number;
      remainingMinor: number;
      requestedMinor: number;
      /** Valor a enviar ao provedor, já na precisão da moeda. */
      amount: number;
      /** `true` quando o valor pedido era o saldo inteiro. */
      full: boolean;
      snapshotMinor: number;
      /** `false` quando o total oficial do provedor é desconhecido. */
      snapshotKnown: boolean;
    }
  | {
      ok: false;
      code:
        | "invalid_operation_id"
        | "invalid_amount"
        | "precision"
        | "nothing_left"
        | "exceeds_balance";
      reason: string;
    };

/** Casas decimais da moeda (0, 2 ou 3). */
export function refundCurrencyDecimals(currency: string | null | undefined): number {
  return getCurrency(resolveStoreCurrency(currency)).decimals;
}

/**
 * Valida e converte o pedido de reembolso.
 *
 * Regras:
 *  • `operation_id` é obrigatório e precisa ser UUID;
 *  • valor ausente = saldo restante;
 *  • valor precisa ser finito, positivo e não ter precisão sub-unidade;
 *  • valor nunca pode passar do saldo restante (limite máximo).
 */
export function planRefund(input: {
  totalAmount: number;
  currency: string | null | undefined;
  requestedAmount?: number | null;
  ledger: RefundLedgerEntry[];
  snapshotRefunded?: number | null;
  snapshotKnown?: boolean;
  currentStatus: PaymentStatus;
  operationId: unknown;
}): RefundPlan {
  const operationId = normalizeRefundOperationId(input.operationId);
  if (!operationId) {
    return {
      ok: false,
      code: "invalid_operation_id",
      reason: "Identificador da operação de reembolso inválido.",
    };
  }

  const state = computeRefundState({
    totalAmount: input.totalAmount,
    currency: input.currency,
    ledger: input.ledger,
    snapshotRefunded: input.snapshotRefunded ?? null,
    snapshotKnown: input.snapshotKnown,
    currentStatus: input.currentStatus,
  });

  if (state.remainingMinor <= 0) {
    return {
      ok: false,
      code: "nothing_left",
      reason: "Este pagamento já foi totalmente reembolsado.",
    };
  }

  const hasRequested = input.requestedAmount !== undefined && input.requestedAmount !== null;
  const rawRequested = hasRequested ? Number(input.requestedAmount) : state.remainingAmount;

  if (!Number.isFinite(rawRequested) || rawRequested <= 0) {
    return { ok: false, code: "invalid_amount", reason: "Valor de reembolso inválido." };
  }
  if (hasSubUnitPrecision(rawRequested, state.currency)) {
    return {
      ok: false,
      code: "precision",
      reason: `O valor informado tem mais casas decimais do que a moeda ${state.currency} permite.`,
    };
  }

  const requestedMinor = Math.round(rawRequested * 10 ** refundCurrencyDecimals(state.currency));
  if (requestedMinor <= 0) {
    return { ok: false, code: "invalid_amount", reason: "Valor de reembolso inválido." };
  }
  if (requestedMinor > state.remainingMinor) {
    return {
      ok: false,
      code: "exceeds_balance",
      reason: "O valor excede o saldo reembolsável deste pagamento.",
    };
  }

  return {
    ok: true,
    currency: state.currency,
    operationId,
    totalMinor: state.totalMinor,
    refundedMinor: state.refundedMinor,
    remainingMinor: state.remainingMinor,
    requestedMinor,
    amount: fromMinorUnits(requestedMinor, state.currency),
    full: requestedMinor === state.remainingMinor,
    snapshotMinor: state.snapshotMinor,
    snapshotKnown: state.snapshotKnown,
  };
}

/* ── Reconciliação de pendentes ──────────────────────────────────────────── */

/**
 * Decide quais reembolsos `pending` já foram confirmados pelo provedor.
 *
 * O total oficial é a única prova aceitável: aprovamos pendentes em ordem
 * cronológica enquanto a soma couber no total informado. Nada é aprovado "em
 * bloco" só porque o saldo aumentou (defeito da conciliação anterior).
 */
export function reconcilePendingRefunds(input: {
  totalAmount: number;
  currency: string | null | undefined;
  ledger: RefundLedgerEntry[];
  snapshotRefunded?: number | null;
  snapshotKnown?: boolean;
  currentStatus: PaymentStatus;
}): { approveIds: string[]; approvedMinor: number; targetMinor: number; state: RefundState } {
  const state = computeRefundState({
    totalAmount: input.totalAmount,
    currency: input.currency,
    ledger: input.ledger,
    snapshotRefunded: input.snapshotRefunded ?? null,
    snapshotKnown: input.snapshotKnown,
    currentStatus: input.currentStatus,
  });
  const totals = refundLedgerTotals(input.ledger, state.currency);

  // F-06B: sem total oficial confiável NADA é aprovado. Aprovar "por saldo"
  // aqui foi exatamente o defeito que permitiu confirmar valor errado.
  if (!state.snapshotKnown) {
    return {
      approveIds: [],
      approvedMinor: totals.approvedMinor,
      targetMinor: totals.approvedMinor,
      state,
    };
  }

  const targetMinor = state.refundedMinor;
  let confirmed = totals.approvedMinor;
  const approveIds: string[] = [];

  const ordered = [...totals.pending].sort((a, b) =>
    String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")),
  );

  for (const entry of ordered) {
    const minor = entryAmountMinor(entry, state.currency);
    if (minor <= 0) continue;
    if (confirmed + minor > targetMinor) break;
    confirmed += minor;
    const id = String(entry.id ?? "").trim();
    if (id) approveIds.push(id);
  }

  return { approveIds, approvedMinor: confirmed, targetMinor, state };
}
