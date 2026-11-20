import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  Plug,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Wallet,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import {
  connectProvider,
  disconnectProvider,
  getProviderStatus,
  listTransactions,
  newRefundOperationId,
  PROVIDER_LABELS,
  refreshPayment,
  refundTransaction,
  setProviderEnabled,
  verifyProvider,
  type PaymentConnectionView,
  type PaymentProviderKey,
  type PendingRefundView,
} from "@/lib/payments";
import {
  formatMoney,
  fromMinorUnits,
  getCurrency,
  hasSubUnitPrecision,
  parseAmount,
  resolveStoreCurrency,
  toMinorUnits,
} from "@/lib/currency";
import { useI18n, type MessageKey } from "@/i18n";

/** Rótulos traduzíveis dos status técnicos devolvidos pelo provedor. */
const PAYMENT_STATUS_KEYS: Record<string, MessageKey> = {
  pending: "payments.status.pending",
  approved: "payments.status.approved",
  authorized: "payments.status.authorized",
  captured: "payments.status.captured",
  failed: "payments.status.failed",
  cancelled: "payments.status.cancelled",
  refunded: "payments.status.refunded",
  partially_refunded: "payments.status.partiallyRefunded",
  disputed: "payments.status.disputed",
};

export const Route = createFileRoute("/painel/pagamentos")({
  head: () => ({
    meta: [
      { title: "Formas de pagamento — Vitrine Criativa" },
      {
        name: "description",
        content: "Conecte sua conta PayPal e Mercado Pago para receber os pagamentos da sua loja.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PagamentosPage,
});

function statusTone(status: string): string {
  switch (status) {
    case "captured":
    case "approved":
      return "text-green-600";
    case "pending":
    case "authorized":
      return "text-amber-600";
    case "failed":
    case "cancelled":
    case "disputed":
      return "text-red-600";
    case "refunded":
    case "partially_refunded":
      return "text-sky-600";
    default:
      return "text-muted-foreground";
  }
}

function PagamentosPage() {
  const { t, formatNumber } = useI18n();
  const { user } = useAuth();
  const { data: catalog } = useMyCatalog(user?.id);
  const catalogId = catalog?.id;
  const qc = useQueryClient();

  /**
   * Operação de reembolso em andamento (R-01).
   *
   * Um retry da MESMA tentativa (mesma transação e mesmo valor) reusa o id —
   * e portanto a chave de idempotência do provedor. Uma tentativa nova recebe
   * um id novo, mesmo que o valor seja idêntico.
   */
  const refundOperation = useRef<{
    transactionId: string;
    amountMinor: number;
    operationId: string;
  } | null>(null);

  const currency = resolveStoreCurrency(catalog?.currency);
  const money = (value: number) => formatMoney(value, currency);
  const statusLabel = (status: string) => {
    const key = PAYMENT_STATUS_KEYS[status];
    return key ? t(key) : status;
  };

  const { data: status, isLoading } = useQuery({
    queryKey: ["payment-status", catalogId],
    enabled: !!catalogId,
    queryFn: () => getProviderStatus(catalogId!),
  });

  const { data: transactionsData } = useQuery({
    queryKey: ["payment-transactions", catalogId],
    enabled: !!catalogId,
    queryFn: () => listTransactions(catalogId!),
  });

  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    if (connected === null) return;

    const providerParam = params.get("provider");
    const label =
      providerParam === "paypal" || providerParam === "mercadopago"
        ? PROVIDER_LABELS[providerParam as PaymentProviderKey]
        : t("payments.providerFallback");
    const rawError = params.get("error");
    let detail = "";
    try {
      detail = rawError ? decodeURIComponent(rawError) : "";
    } catch {
      detail = rawError ?? "";
    }

    if (connected === "1") {
      toast.success(t("payments.connectedToast", { provider: label }));
    } else {
      console.error("[payments] callback retornou erro:", detail);
      toast.error(
        detail
          ? t("payments.connectError", { provider: label, detail })
          : t("payments.connectFailed", { provider: label }),
      );
    }
    if (params.get("currency_warning") === "1") {
      toast.warning(t("payments.currencyWarning"));
    }

    window.history.replaceState({}, "", "/painel/pagamentos");
    qc.invalidateQueries({ queryKey: ["payment-status", catalogId] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["payment-status", catalogId] });
    qc.invalidateQueries({ queryKey: ["payment-transactions", catalogId] });
  }

  async function handleConnect(provider: PaymentProviderKey) {
    if (!catalogId) return;
    setBusy(`connect:${provider}`);
    try {
      const res = await connectProvider(catalogId, provider);
      if (!res.success || !res.url) {
        console.error("[payments] connect falhou:", res.error);
        toast.error(String(res.error || t("payments.connectStartFailed")));
        return;
      }
      window.location.href = String(res.url);
    } catch (error) {
      console.error("[payments] connect exceção:", error);
      toast.error(t("payments.connectStartError"));
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect(provider: PaymentProviderKey) {
    if (!catalogId) return;
    if (!window.confirm(t("payments.disconnectConfirm", { provider: PROVIDER_LABELS[provider] }))) {
      return;
    }
    setBusy(`disconnect:${provider}`);
    try {
      const res = await disconnectProvider(catalogId, provider);
      if (!res.success) {
        toast.error(String(res.error || t("payments.disconnectError")));
        return;
      }
      toast.success(t("payments.disconnectedToast", { provider: PROVIDER_LABELS[provider] }));
      invalidate();
    } finally {
      setBusy(null);
    }
  }

  async function handleVerify(provider: PaymentProviderKey) {
    if (!catalogId) return;
    setBusy(`verify:${provider}`);
    try {
      const res = await verifyProvider(catalogId, provider);
      if (!res.success) {
        toast.error(String(res.error || t("payments.verifyError")));
        invalidate();
        return;
      }
      toast.success(t("payments.verifiedToast", { provider: PROVIDER_LABELS[provider] }));
      invalidate();
    } finally {
      setBusy(null);
    }
  }

  async function handleToggle(provider: PaymentProviderKey, enabled: boolean) {
    if (!catalogId) return;
    setBusy(`toggle:${provider}`);
    try {
      const res = await setProviderEnabled(catalogId, provider, enabled);
      if (!res.success) {
        toast.error(String(res.error || t("payments.toggleError")));
        return;
      }
      toast.success(
        enabled
          ? t("payments.enabledToast", { provider: PROVIDER_LABELS[provider] })
          : t("payments.disabledToast", { provider: PROVIDER_LABELS[provider] }),
      );
      invalidate();
    } finally {
      setBusy(null);
    }
  }

  async function handleRefresh(transactionId: string) {
    setBusy(`refresh:${transactionId}`);
    try {
      const res = await refreshPayment(transactionId);
      if (!res.success) {
        toast.error(String(res.error || t("payments.refreshError")));
        return;
      }
      if (res.refunded_amount_known === false) {
        // F-06B: o provedor não informou o total. Nada foi confirmado e o saldo
        // exibido é o último conhecido — o vendedor precisa saber disso.
        toast.warning(t("payments.refundUnknown"), { duration: 12000 });
        invalidate();
        return;
      }
      toast.success(
        res.captured
          ? t("payments.capturedToast")
          : t("payments.statusToast", { status: statusLabel(res.status) }),
      );
      invalidate();
    } finally {
      setBusy(null);
    }
  }

  /**
   * Envia um reembolso e trata CADA desfecho (F-01/F-06A).
   *
   * O `operationId` é sempre o da operação atual — retry nunca inventa uma
   * chave nova para o mesmo dinheiro.
   */
  async function submitRefund(
    transactionId: string,
    amount: number,
    amountMinor: number,
    operationId: string,
    txCurrency: string,
  ) {
    setBusy(`refund:${transactionId}`);
    try {
      const res = await refundTransaction({ transactionId, amount, operationId });
      if (!res.success) {
        const code = String(res.code ?? "");
        if (res.provider_executed) {
          // O dinheiro JÁ saiu no provedor: repetir poderia duplicar. O caminho
          // seguro é consultar o provedor ("Verificar") para reconciliar.
          refundOperation.current = null;
          toast.warning(t("payments.refundProviderExecuted"), { duration: 12000 });
          invalidate();
          return;
        }
        const pending = res.pending_operation;
        if (pending?.operation_id) {
          // Adota a operação que o SERVIDOR já registrou — nunca cria outra.
          refundOperation.current = {
            transactionId,
            amountMinor: toMinorUnits(Number(pending.amount), txCurrency),
            operationId: String(pending.operation_id),
          };
          toast.warning(t("payments.refundPendingRecover"), { duration: 12000 });
          invalidate();
          return;
        }
        if (code === "operation_refused" || code === "operation_cancelled") {
          // Operação encerrada: a próxima tentativa é uma operação NOVA.
          refundOperation.current = null;
        }
        toast.error(String(res.error || t("payments.refundError")));
        return;
      }
      // Concluído: a próxima solicitação é uma operação NOVA.
      refundOperation.current = null;
      if (res.status === "failed" || res.status === "cancelled") {
        toast.error(t("payments.refundRefused"));
      } else if (res.reused) {
        toast.info(t("payments.refundReused", { amount: money(res.amount) }));
      } else if (res.pending) {
        toast.warning(t("payments.refundPending", { amount: money(res.amount) }), {
          duration: 9000,
        });
      } else {
        toast.success(t("payments.refundConfirmed", { amount: money(res.amount) }));
      }
      invalidate();
    } finally {
      setBusy(null);
    }
  }

  async function handleRefund(transactionId: string, remaining: number, txCurrency: string) {
    const decimals = getCurrency(txCurrency).decimals;
    const remainingMinor = toMinorUnits(remaining, txCurrency);
    const input = window.prompt(
      t("payments.refundPrompt", {
        currency: txCurrency,
        max: formatNumber(remaining, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }),
      }),
      "",
    );
    if (input === null) return;

    // Precisão vem da moeda da transação (JPY 0, BRL/USD 2, KWD 3) — nunca de
    // um `* 100` fixo (R-02).
    const trimmed = input.trim();
    const parsed = trimmed === "" ? remaining : parseAmount(trimmed);
    if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) {
      toast.error(t("payments.refundInvalid"));
      return;
    }
    if (hasSubUnitPrecision(parsed, txCurrency)) {
      toast.error(t("payments.refundInvalid"));
      return;
    }
    const amountMinor = toMinorUnits(parsed, txCurrency);
    if (amountMinor <= 0) {
      toast.error(t("payments.refundInvalid"));
      return;
    }
    if (amountMinor > remainingMinor) {
      toast.error(t("payments.refundExceeds"));
      return;
    }
    const amount = fromMinorUnits(amountMinor, txCurrency);

    const current = refundOperation.current;
    const operationId =
      current &&
      current.transactionId === transactionId &&
      current.amountMinor === amountMinor
        ? current.operationId
        : newRefundOperationId();
    refundOperation.current = { transactionId, amountMinor, operationId };

    await submitRefund(transactionId, amount, amountMinor, operationId, txCurrency);
  }

  /**
   * Retoma a MESMA operação pendente registrada no servidor (F-01).
   *
   * Sobrevive a reload/logout/timeout: o id e o valor vêm de
   * `pending_refunds`, não do estado do navegador.
   */
  async function handleResumeRefund(
    transactionId: string,
    pending: PendingRefundView,
    txCurrency: string,
  ) {
    if (!pending.operation_id) {
      toast.error(t("payments.refundPendingUnavailable"));
      return;
    }
    const amount = Number(pending.amount);
    const amountMinor = toMinorUnits(amount, txCurrency);
    refundOperation.current = {
      transactionId,
      amountMinor,
      operationId: String(pending.operation_id),
    };
    await submitRefund(transactionId, amount, amountMinor, String(pending.operation_id), txCurrency);
  }

  if (!catalog) {
    return (
      <div className="p-5 text-center text-muted-foreground">
        <p>{t("payments.noCatalog")}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
        <h1 className="text-xl font-bold text-foreground">{t("payments.title")}</h1>
        <Loader2 className="mx-auto size-8 animate-spin text-primary" />
      </div>
    );
  }

  const providers = status?.providers ?? [];
  const transactions = transactionsData?.transactions ?? [];

  return (
    <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
      <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
        <CreditCard className="size-5" /> {t("payments.title")}
      </h1>

      <p className="text-sm text-muted-foreground">
        {t("payments.introConnect")}{" "}
        <strong className="text-foreground">{t("payments.introOwnAccount")}</strong>{" "}
        {t("payments.introAfterAccount")} <strong className="text-foreground">{currency}</strong>.
      </p>

      {status && !status.encryption_configured && (
        <div className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{t("payments.encryptionWarning")}</p>
        </div>
      )}

      {providers.map((connection) => (
        <ProviderCard
          key={connection.provider}
          connection={connection}
          encryptionConfigured={!!status?.encryption_configured}
          busy={busy}
          onConnect={() => handleConnect(connection.provider)}
          onDisconnect={() => handleDisconnect(connection.provider)}
          onVerify={() => handleVerify(connection.provider)}
          onToggle={(enabled) => handleToggle(connection.provider, enabled)}
        />
      ))}

      {providers.every((p) => !p.connected) && (
        <p className="rounded-xl bg-accent/50 px-3 py-2 text-xs text-muted-foreground">
          {t("payments.noneConnected")}
        </p>
      )}

      <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Wallet className="size-4" /> {t("payments.received")}
          </p>
          <button
            type="button"
            onClick={invalidate}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-3.5" /> {t("common.refresh")}
          </button>
        </div>

        {transactions.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("payments.noTransactions")}</p>
        ) : (
          <ul className="space-y-2">
            {transactions.map((tx) => {
              const txCurrency = resolveStoreCurrency(tx.currency);
              // Saldo em unidades mínimas da moeda (R-02) — a MESMA conta do
              // backend, sem `* 100` fixo nem tolerância de centavos.
              const remainingMinor = Math.max(
                0,
                toMinorUnits(Number(tx.amount), txCurrency) -
                  toMinorUnits(Number(tx.refunded_amount), txCurrency),
              );
              const remaining = fromMinorUnits(remainingMinor, txCurrency);
              // F-01: pendência vem do servidor e bloqueia uma operação NOVA.
              const pendingRefunds = tx.pending_refunds ?? [];
              const hasPending = pendingRefunds.length > 0;
              const canRefund =
                ["captured", "approved", "partially_refunded"].includes(tx.status) &&
                remainingMinor > 0 &&
                !hasPending;
              return (
                <li key={tx.id} className="rounded-xl border border-border px-3 py-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">
                      {PROVIDER_LABELS[tx.provider]}
                    </span>
                    <span className={`font-semibold ${statusTone(tx.status)}`}>
                      {statusLabel(tx.status)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-muted-foreground">
                    <span>
                      {formatMoney(Number(tx.amount), txCurrency)}
                      {Number(tx.refunded_amount) > 0
                        ? ` · ${t("payments.refundedAmount", {
                            amount: formatMoney(Number(tx.refunded_amount), txCurrency),
                          })}`
                        : ""}
                    </span>
                    <span>#{tx.order_id.slice(0, 8)}</span>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleRefresh(tx.id)}
                      disabled={busy === `refresh:${tx.id}`}
                      className="rounded-lg border border-border px-2.5 py-1 font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
                    >
                      {busy === `refresh:${tx.id}`
                        ? t("payments.checkProviderBusy")
                        : t("payments.checkProvider")}
                    </button>
                    {canRefund && (
                      <button
                        type="button"
                        onClick={() => handleRefund(tx.id, remaining, txCurrency)}
                        disabled={busy === `refund:${tx.id}`}
                        className="rounded-lg border border-border px-2.5 py-1 font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
                      >
                        {busy === `refund:${tx.id}`
                          ? t("payments.refunding")
                          : t("payments.refund")}
                      </button>
                    )}
                  </div>
                  {hasPending && (
                    <div className="mt-2 space-y-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-amber-800">
                      <p className="font-medium">{t("payments.refundPendingTitle")}</p>
                      {pendingRefunds.map((pending) => (
                        <div
                          key={pending.id}
                          className="flex items-center justify-between gap-2"
                        >
                          <span>
                            {formatMoney(Number(pending.amount), txCurrency)} ·{" "}
                            {pending.provider_acknowledged
                              ? t("payments.refundPendingAcknowledged")
                              : t("payments.refundPendingUnknown")}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleResumeRefund(tx.id, pending, txCurrency)}
                            disabled={busy === `refund:${tx.id}`}
                            className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-medium disabled:opacity-60"
                          >
                            {busy === `refund:${tx.id}`
                              ? t("payments.refunding")
                              : t("payments.refundResume")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProviderCard({
  connection,
  encryptionConfigured,
  busy,
  onConnect,
  onDisconnect,
  onVerify,
  onToggle,
}: {
  connection: PaymentConnectionView;
  encryptionConfigured: boolean;
  busy: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onVerify: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { t, formatDateTime } = useI18n();
  const connecting = busy === `connect:${connection.provider}`;
  const disconnecting = busy === `disconnect:${connection.provider}`;
  const verifying = busy === `verify:${connection.provider}`;
  const toggling = busy === `toggle:${connection.provider}`;
  const canEnable = encryptionConfigured && connection.connected && connection.currencySupported;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{connection.label}</p>
          <p className="text-xs text-muted-foreground">
            {t("payments.environment")}:{" "}
            {connection.environment === "production"
              ? t("payments.environmentProduction")
              : t("payments.environmentSandbox")}
          </p>
        </div>
        {connection.connected ? (
          <span className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
            <CheckCircle2 className="size-3.5" /> {t("payments.connected")}
          </span>
        ) : connection.needsReconnect ? (
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            <AlertTriangle className="size-3.5" /> {t("payments.reconnect")}
          </span>
        ) : (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            {t("payments.notConnected")}
          </span>
        )}
      </div>

      {!connection.configured && connection.setupMessage && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {connection.setupMessage}
        </p>
      )}

      {connection.needsReconnect && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {t("payments.authorizationExpired")}
        </p>
      )}

      {connection.connected && (
        <dl className="space-y-1.5 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("payments.account")}</dt>
            <dd className="font-medium text-foreground">{connection.accountLabel ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("payments.identifier")}</dt>
            <dd className="font-mono text-foreground">{connection.accountIdMasked ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{t("payments.lastVerified")}</dt>
            <dd className="text-foreground">
              {connection.lastVerifiedAt ? formatDateTime(connection.lastVerifiedAt) : "—"}
            </dd>
          </div>
        </dl>
      )}

      {connection.connected && !connection.currencySupported && connection.currencyMessage && (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
          {connection.currencyMessage}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {connection.connected ? (
          <>
            <button
              type="button"
              onClick={onVerify}
              disabled={verifying}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-60"
            >
              {verifying ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              {verifying ? t("payments.verifying") : t("payments.verifyConnection")}
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={disconnecting}
              className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-muted disabled:opacity-60"
            >
              {disconnecting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unplug className="size-4" />
              )}
              {t("payments.disconnect")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={connecting || !connection.configured || !encryptionConfigured}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {connecting ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
            {connecting
              ? t("payments.connecting")
              : connection.needsReconnect
                ? t("payments.reconnectProvider", { provider: connection.label })
                : t("payments.connectProvider", { provider: connection.label })}
          </button>
        )}
      </div>

      {connection.connected && (
        <label className="flex items-start gap-3 rounded-xl border border-border px-3 py-2.5">
          <input
            type="checkbox"
            checked={connection.enabled}
            disabled={!canEnable || toggling}
            onChange={(event) => onToggle(event.target.checked)}
            className="mt-0.5 size-4 accent-current"
          />
          <span className="text-xs">
            <span className="block font-semibold text-foreground">
              {t("payments.showInCheckout")}
            </span>
            <span className="text-muted-foreground">
              {canEnable ? t("payments.checkoutHintEnabled") : t("payments.checkoutHintDisabled")}
            </span>
          </span>
        </label>
      )}

      {!connection.connected && (
        <p className="rounded-xl bg-accent/50 px-3 py-2 text-xs text-muted-foreground">
          {t("payments.needAccount", { provider: connection.label })}
        </p>
      )}
    </div>
  );
}
