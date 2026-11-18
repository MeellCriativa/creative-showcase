import { useEffect, useState } from "react";
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
  PROVIDER_LABELS,
  refreshPayment,
  refundTransaction,
  setProviderEnabled,
  verifyProvider,
  type PaymentConnectionView,
  type PaymentProviderKey,
} from "@/lib/payments";
import { formatMoney, resolveStoreCurrency } from "@/lib/currency";
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

  async function handleRefund(transactionId: string, remaining: number) {
    const input = window.prompt(
      t("payments.refundPrompt", {
        currency,
        max: formatNumber(remaining, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      }),
      "",
    );
    if (input === null) return;
    const trimmed = input.trim().replace(",", ".");
    const amount = trimmed === "" ? remaining : Number(trimmed);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t("payments.refundInvalid"));
      return;
    }
    if (amount > remaining + 0.001) {
      toast.error(t("payments.refundExceeds"));
      return;
    }
    setBusy(`refund:${transactionId}`);
    try {
      const res = await refundTransaction({ transactionId, amount });
      if (!res.success) {
        toast.error(String(res.error || t("payments.refundError")));
        return;
      }
      if (res.reused) {
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
              const remaining = Math.max(
                0,
                Math.round((Number(tx.amount) - Number(tx.refunded_amount)) * 100) / 100,
              );
              const canRefund =
                ["captured", "approved", "partially_refunded"].includes(tx.status) && remaining > 0;
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
                      {formatMoney(Number(tx.amount), resolveStoreCurrency(tx.currency))}
                      {Number(tx.refunded_amount) > 0
                        ? ` · ${t("payments.refundedAmount", {
                            amount: formatMoney(
                              Number(tx.refunded_amount),
                              resolveStoreCurrency(tx.currency),
                            ),
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
                        onClick={() => handleRefund(tx.id, remaining)}
                        disabled={busy === `refund:${tx.id}`}
                        className="rounded-lg border border-border px-2.5 py-1 font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
                      >
                        {busy === `refund:${tx.id}`
                          ? t("payments.refunding")
                          : t("payments.refund")}
                      </button>
                    )}
                  </div>
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
  busy,
  onConnect,
  onDisconnect,
  onVerify,
  onToggle,
}: {
  connection: PaymentConnectionView;
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
  const canEnable = connection.connected && connection.currencySupported;

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
            disabled={connecting || !connection.configured}
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
