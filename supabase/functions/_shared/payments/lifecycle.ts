/**
 * Decisões financeiras puras (sem I/O) da Etapa 2.
 *
 * Tudo o que decide "capturar ou não", "reprocessar ou não", "reembolso
 * regrediu?" e "a cobrança fecha?" vive aqui — e por isso é testável sem
 * Deno, sem banco e sem rede.
 */
import type { PaymentProviderKey, PaymentStatus } from "./types.ts";

/** Precisão interna (6 casas cobre qualquer moeda ISO, inclusive as de 3). */
export function roundAmount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1_000_000) / 1_000_000;
}

export const EPSILON = 1e-6;

/* ── Cobrança: itens + frete = total ─────────────────────────────────────── */

export type ChargeSplitItem = { quantity: number; unitPrice: number };

export type ChargeSplit =
  | {
      ok: true;
      itemTotal: number;
      shipping: number;
      total: number;
      itemTotalMinor: number;
      shippingMinor: number;
      totalMinor: number;
    }
  | { ok: false; code: "empty_items" | "invalid_shipping" | "amount_mismatch"; reason: string };

/**
 * Fecha a conta que será enviada ao provedor.
 *
 * Regra: o provedor cobra `itens + frete`. Se essa soma não for exatamente o
 * total oficial do pedido, a cobrança é RECUSADA (nunca cobra valor errado).
 */
export function computeChargeSplit(input: {
  items: ChargeSplitItem[];
  shippingAmount: number;
  expectedTotal: number;
  decimals: number;
}): ChargeSplit {
  if (!Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, code: "empty_items", reason: "Pedido sem itens para cobrar." };
  }
  const factor = 10 ** Math.max(0, Math.min(3, input.decimals));
  const shipping = roundAmount(input.shippingAmount ?? 0);
  if (!Number.isFinite(shipping) || shipping < 0) {
    return { ok: false, code: "invalid_shipping", reason: "Frete inválido para cobrança." };
  }

  let itemTotalMinor = 0;
  for (const item of input.items) {
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice) || quantity <= 0 || unitPrice < 0) {
      return { ok: false, code: "empty_items", reason: "Item inválido para cobrança." };
    }
    itemTotalMinor += Math.round(unitPrice * factor) * Math.round(quantity);
  }

  const shippingMinor = Math.round(shipping * factor);
  const totalMinor = itemTotalMinor + shippingMinor;
  const expectedMinor = Math.round(roundAmount(input.expectedTotal) * factor);

  if (Math.abs(totalMinor - expectedMinor) > 0) {
    return {
      ok: false,
      code: "amount_mismatch",
      reason: "A soma dos itens com o frete não corresponde ao total do pedido.",
    };
  }

  return {
    ok: true,
    itemTotal: itemTotalMinor / factor,
    shipping: shippingMinor / factor,
    total: totalMinor / factor,
    itemTotalMinor,
    shippingMinor,
    totalMinor,
  };
}

/* ── Reembolsos: estado nunca regride ───────────────────────────────────── */

export type RefundStateInput = {
  totalAmount: number;
  currentRefunded: number;
  currentStatus: PaymentStatus;
  snapshotRefunded: number;
  snapshotStatus: PaymentStatus;
  /**
   * `false` quando o provedor não informa um total confiável (F-06B).
   * Nesse caso o valor local é preservado e NADA é confirmado.
   */
  snapshotKnown?: boolean;
};

export type RefundStateResult = {
  refundedAmount: number;
  status: PaymentStatus;
  /** `true` quando o provedor devolveu menos reembolso do que já sabíamos. */
  regressed: boolean;
  /** `false` quando o total informado não é confiável (desconhecido). */
  refundedAmountKnown: boolean;
};

/**
 * Combina o reembolso já registrado com o que o provedor informa.
 *
 * Correção da auditoria (C5): o PayPal devolvia `refundedAmount: 0` em toda
 * consulta, e o webhook/refresh sobrescrevia o histórico — permitindo reembolsar
 * o mesmo valor duas vezes. Aqui o valor é monotônico e o status é derivado.
 *
 * Correção 2.1.3 (F-06B): quando o provedor informa `PARTIALLY_REFUNDED` sem o
 * total oficial (`snapshotKnown = false`), o saldo NÃO vira 0: mantém o valor
 * já conhecido e marca `refundedAmountKnown = false`. Nenhuma pendência pode
 * ser aprovada a partir de um valor desconhecido.
 */
export function mergeRefundState(input: RefundStateInput): RefundStateResult {
  const current = roundAmount(Math.max(0, input.currentRefunded ?? 0));
  const snapshot = roundAmount(Math.max(0, input.snapshotRefunded ?? 0));
  const total = roundAmount(Math.max(0, input.totalAmount ?? 0));
  const snapshotKnown = input.snapshotKnown ?? true;

  if (!snapshotKnown) {
    // Status parcial/total continua válido (o provedor afirmou que houve
    // reembolso), mas o VALOR é desconhecido: preserva o que já sabíamos.
    const status: PaymentStatus =
      input.snapshotStatus === "disputed"
        ? "disputed"
        : input.snapshotStatus === "refunded" || input.snapshotStatus === "partially_refunded"
          ? input.snapshotStatus
          : input.currentStatus;
    return { refundedAmount: current, status, regressed: false, refundedAmountKnown: false };
  }

  const refundedAmount = roundAmount(Math.max(current, snapshot));
  const regressed = snapshot + EPSILON < current;

  if (input.snapshotStatus === "disputed") {
    return { refundedAmount, status: "disputed", regressed, refundedAmountKnown: true };
  }

  if (refundedAmount > EPSILON) {
    const fully = total > EPSILON && refundedAmount >= total - EPSILON;
    return {
      refundedAmount,
      status: fully ? "refunded" : "partially_refunded",
      regressed,
      refundedAmountKnown: true,
    };
  }

  // Sem reembolso conhecido: se já havíamos registrado um reembolso, não
  // aceitamos "voltar" para capturado só porque o provedor omitiu o dado.
  if (
    (input.currentStatus === "refunded" || input.currentStatus === "partially_refunded") &&
    refundedAmount <= EPSILON
  ) {
    return {
      refundedAmount: current,
      status: input.currentStatus,
      regressed: true,
      refundedAmountKnown: true,
    };
  }

  return {
    refundedAmount,
    status: input.snapshotStatus,
    regressed,
    refundedAmountKnown: true,
  };
}

/* ── Captura do PayPal ──────────────────────────────────────────────────── */

/** Só o PayPal precisa de captura explícita; o Checkout Pro captura sozinho. */
export function shouldCapture(input: {
  provider: PaymentProviderKey;
  snapshotStatus: PaymentStatus;
  transactionStatus: PaymentStatus;
}): boolean {
  if (input.provider !== "paypal") return false;
  if (input.snapshotStatus !== "authorized") return false;
  return input.transactionStatus !== "captured" &&
    input.transactionStatus !== "refunded" &&
    input.transactionStatus !== "partially_refunded" &&
    input.transactionStatus !== "disputed";
}

/**
 * Lease de captura: impede duas capturas simultâneas para a mesma transação.
 * A captura é idempotente no provedor, mas o lock evita chamadas duplicadas e
 * mantém o estado local consistente.
 */
export function canClaimCapture(input: {
  now: number;
  claimedAt: number | null;
  leaseMs: number;
}): boolean {
  if (input.claimedAt === null || !Number.isFinite(input.claimedAt)) return true;
  return input.now - input.claimedAt >= input.leaseMs;
}

/* ── Identificador de consulta no provedor ──────────────────────────────── */

/**
 * Id que deve ser usado em `getPayment`/`capture`.
 *
 * Correção da auditoria (C4): no PayPal o id consultável é o da ORDEM — a
 * captura devolve um id próprio (que guardamos em `provider_payment_id` para
 * reembolso). Se consultássemos a captura como se fosse ordem, a API
 * responderia 404 e o pagamento ficaria preso em `authorized`.
 */
export function providerLookupId(input: {
  provider: PaymentProviderKey;
  providerPaymentId: string | null;
  providerOrderId: string | null;
}): string | null {
  if (input.provider === "paypal") {
    return input.providerOrderId ?? input.providerPaymentId ?? null;
  }
  return input.providerPaymentId ?? input.providerOrderId ?? null;
}

/**
 * Id que deve ser consultado em `getPayment`/`capture`.
 *
 * Mercado Pago: id do PAGAMENTO (nunca a preferência — auditoria C2).
 * PayPal: id da ORDEM — a captura devolve um id próprio (guardado em
 * `provider_payment_id` para reembolso), mas quem se consulta é a ordem
 * (auditoria C4). Consultar a captura como ordem devolve 404.
 */
export function paymentIdForLookup(input: {
  provider: PaymentProviderKey;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  resourceType?: string;
  resourceId?: string;
  resolvedPaymentId?: string | null;
}): string | null {
  if (input.provider === "paypal") {
    return input.providerOrderId ?? input.providerPaymentId ?? input.resolvedPaymentId ?? null;
  }
  // P15.2: para MP, o id notificado/assinado é mais recente que o salvo na
  // transação. Consultar um id antigo poderia confirmar um pagamento obsoleto.
  if (input.resourceType === "payment" && input.resourceId) return input.resourceId;
  if (input.resolvedPaymentId) return input.resolvedPaymentId;
  return input.providerPaymentId ?? null;
}

/**
 * Isolamento entre vendedores.
 *
 * Quando o provedor informa a conta que gerou a notificação, a transação
 * atingida precisa pertencer à MESMA loja. Sem isso, uma conta conectada podia
 * alterar o pedido de outra loja apenas citando o id do pagamento.
 */
export function isCrossCatalogEvent(
  notificationCatalogId: string | null,
  transactionCatalogId: string | null,
): boolean {
  if (!notificationCatalogId || !transactionCatalogId) return false;
  return notificationCatalogId !== transactionCatalogId;
}

/* ── Eventos de webhook ─────────────────────────────────────────────────── */

export type EventDecision = "process" | "reprocess" | "duplicate" | "reject";

/**
 * Decide o que fazer com um evento já verificado.
 *
 * Correção da auditoria (C6 + A1 + A2):
 *  - assinatura inválida nunca entra na fila de processamento;
 *  - evento já processado é duplicata (200 sem efeito);
 *  - evento que falhou é reprocessado (não fica perdido para sempre).
 */
export function eventDecision(input: {
  valid: boolean;
  existing: boolean;
  processed: boolean;
}): EventDecision {
  if (!input.valid) return "reject";
  if (!input.existing) return "process";
  return input.processed ? "duplicate" : "reprocess";
}

/**
 * Chave de auditoria do evento.
 *
 * Eventos com assinatura inválida recebem um prefixo próprio: assim um POST
 * forjado (que adivinhe o id do evento legítimo) não ocupa a chave do evento
 * verdadeiro nem o impede de ser processado.
 */
export function eventKeyFor(input: { valid: boolean; eventId: string }): string {
  const id = String(input.eventId ?? "").trim();
  if (input.valid) return id || `unknown:${Date.now()}`;
  return `invalid:${id || "unknown"}`;
}

/* ── Tentativas de pagamento ────────────────────────────────────────────── */

/**
 * Status em que o pedido NÃO pode receber uma nova cobrança.
 *
 * Correção da auditoria (R-03): `partially_refunded` faltava na lista — um
 * pedido já pago, com reembolso parcial, aceitava uma nova cobrança cheia.
 * `pending` fica de fora de propósito: é a tentativa em andamento e o fluxo
 * idempotente devolve a mesma cobrança em vez de criar outra.
 */
export const CHARGE_BLOCKING_STATUSES: readonly PaymentStatus[] = [
  "approved",
  "authorized",
  "captured",
  "partially_refunded",
  "refunded",
  "disputed",
];

export function blocksNewCharge(status: string | null | undefined): boolean {
  const value = String(status ?? "").trim().toLowerCase();
  return (CHARGE_BLOCKING_STATUSES as readonly string[]).includes(value);
}

export type PaymentAttemptDecision = "reuse" | "create" | "reject_consumed" | "reject_token";

/**
 * Impede pagamento duplicado para o mesmo pedido.
 *
 * - já existe transação ativa → devolve a mesma cobrança (idempotente);
 * - não existe e o token já foi consumido → recusa (refaça o pedido);
 * - não existe e o token é válido → cria e consome.
 */
export function paymentAttemptDecision(input: {
  hasValidToken: boolean;
  sessionConsumed: boolean;
  hasActiveTransaction: boolean;
}): PaymentAttemptDecision {
  if (!input.hasValidToken) return "reject_token";
  if (input.hasActiveTransaction) return "reuse";
  if (input.sessionConsumed) return "reject_consumed";
  return "create";
}

/* ── Divergência entre pedido e provedor ────────────────────────────────── */

export type DivergenceResult = {
  hasDivergence: boolean;
  amountMismatch: boolean;
  currencyMismatch: boolean;
  difference: number;
};

/**
 * Compara o que o pedido esperava com o que o provedor confirma.
 * Tolerância de 1 unidade mínima (arredondamento de provedor), nada além.
 */
export function detectDivergence(input: {
  expectedAmount: number;
  expectedCurrency: string;
  snapshotAmount: number;
  snapshotCurrency: string;
  decimals: number;
}): DivergenceResult {
  const factor = 10 ** Math.max(0, Math.min(3, input.decimals));
  const expected = Math.round(roundAmount(input.expectedAmount) * factor);
  const received = Math.round(roundAmount(input.snapshotAmount) * factor);
  const difference = (received - expected) / factor;

  const amountMismatch =
    received > 0 && Math.abs(received - expected) > 1;
  const currencyMismatch =
    !!input.snapshotCurrency &&
    input.snapshotCurrency.toUpperCase() !== input.expectedCurrency.toUpperCase();

  return {
    hasDivergence: amountMismatch || currencyMismatch,
    amountMismatch,
    currencyMismatch,
    difference,
  };
}

/* ── Propriedade do pagamento (correção P2) ──────────────────────────────── */

export type OwnershipMismatch = {
  hasMismatch: boolean;
  orderMismatch: boolean;
  sellerMismatch: boolean;
  missingOrderReference: boolean;
  missingSellerAccount: boolean;
};

function normalizedId(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Confere, com dados da API OFICIAL, se o pagamento pertence ao pedido e ao
 * vendedor da transação local. Nunca usa o corpo do webhook como prova.
 *
 * `require*` habilita o comportamento fail-closed: quando o provedor deveria
 * informar o campo (Mercado Pago sempre informa) e não informou, não confirmamos.
 */
export function detectPaymentOwnershipMismatch(input: {
  expectedOrderId: string | null | undefined;
  snapshotOrderId: string | null | undefined;
  expectedSellerId: string | null | undefined;
  snapshotSellerId: string | null | undefined;
  requireOrderReference?: boolean;
  requireSellerAccount?: boolean;
}): OwnershipMismatch {
  const expectedOrder = normalizedId(input.expectedOrderId);
  const snapshotOrder = normalizedId(input.snapshotOrderId);
  const expectedSeller = normalizedId(input.expectedSellerId);
  const snapshotSeller = normalizedId(input.snapshotSellerId);

  const missingOrderReference = !snapshotOrder;
  const missingSellerAccount = !snapshotSeller;
  const orderMismatch = !!expectedOrder && !!snapshotOrder && expectedOrder !== snapshotOrder;
  const sellerMismatch = !!expectedSeller && !!snapshotSeller && expectedSeller !== snapshotSeller;

  return {
    orderMismatch,
    sellerMismatch,
    missingOrderReference,
    missingSellerAccount,
    hasMismatch:
      orderMismatch ||
      sellerMismatch ||
      (!!input.requireOrderReference && !!expectedOrder && missingOrderReference) ||
      (!!input.requireSellerAccount && !!expectedSeller && missingSellerAccount),
  };
}

/**
 * P4/P5 — no modelo marketplace do PayPal não há token por vendedor: a prova
 * de destino é o `payee.merchant_id` da ordem oficial comparado com a conta
 * conectada DA LOJA DA TRANSAÇÃO. Sem qualquer um dos dois, a confirmação é
 * recusada (fail-closed) — nunca usamos o corpo do webhook como prova.
 */
export function paypalAccountMatchesConnection(input: {
  snapshotMerchantId: string | null | undefined;
  connectionMerchantId: string | null | undefined;
  connectionExternalAccountId?: string | null;
}): boolean {
  // Merchant ID é identificador opaco do PayPal: comparamos EXATAMENTE (só trim),
  // sem derrubar caixa, para que um ID diferente apenas em caixa não seja aceito.
  const exact = (value: string | null | undefined): string => String(value ?? "").trim();
  const snapshot = exact(input.snapshotMerchantId);
  if (!snapshot) return false;
  const connected = [input.connectionMerchantId, input.connectionExternalAccountId]
    .map(exact)
    .filter(Boolean);
  return connected.includes(snapshot);
}

export type ConfirmationGateReason =
  | "amount_divergence"
  | "currency_divergence"
  | "payment_ownership_mismatch"
  | null;

/** Fail-closed: qualquer divergência impede a confirmação do pedido. */
export function paymentConfirmationGate(input: {
  divergence: DivergenceResult;
  ownership: OwnershipMismatch;
}): { allow: boolean; reason: ConfirmationGateReason } {
  if (input.divergence.currencyMismatch) {
    return { allow: false, reason: "currency_divergence" };
  }
  if (input.divergence.amountMismatch) {
    return { allow: false, reason: "amount_divergence" };
  }
  if (input.ownership.hasMismatch) {
    return { allow: false, reason: "payment_ownership_mismatch" };
  }
  return { allow: true, reason: null };
}

/* ── Isolamento de ambiente (correção P3) ────────────────────────────────── */

/**
 * Uma conexão só é utilizável no ambiente em que foi autorizada.
 * Sandbox nunca cobra em produção, e produção nunca cobra em sandbox.
 */
export function connectionEnvironmentMatches(
  connectionEnvironment: string | null | undefined,
  runtimeEnvironment: string | null | undefined,
): boolean {
  const actual = normalizedId(connectionEnvironment);
  const expected = normalizedId(runtimeEnvironment);
  return !!actual && !!expected && actual === expected;
}

/* ── Rate limit (janela fixa) ───────────────────────────────────────────── */

export type RateLimitState = { hits: number; windowStart: number };

export type RateLimitResult = {
  allowed: boolean;
  hits: number;
  windowStart: number;
  retryAfterMs: number;
};

/**
 * Janela fixa determinística. Puro para poder testar sem banco.
 * A persistência (e a corrida entre isolates) fica em `ratelimit.ts`.
 */
export function fixedWindowRateLimit(input: {
  state: RateLimitState | null;
  now: number;
  windowMs: number;
  max: number;
}): RateLimitResult {
  const { now, windowMs, max } = input;
  const state = input.state;
  const expired = !state || !Number.isFinite(state.windowStart) || now - state.windowStart >= windowMs;

  if (expired) {
    return { allowed: max > 0, hits: 1, windowStart: now, retryAfterMs: 0 };
  }

  const hits = state.hits + 1;
  if (hits > max) {
    return {
      allowed: false,
      hits,
      windowStart: state.windowStart,
      retryAfterMs: Math.max(0, state.windowStart + windowMs - now),
    };
  }
  return { allowed: true, hits, windowStart: state.windowStart, retryAfterMs: 0 };
}
