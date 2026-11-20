import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  Lock,
  MessageCircle,
  RefreshCw,
  Unplug,
  XCircle,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { useI18n } from "@/i18n";
import {
  useCompleteOAuth,
  useDisconnectMeta,
  useMetaConnection,
  useMetaSyncLogs,
  useStartOAuth,
  useSyncProducts,
} from "@/hooks/useMetaCatalog";

export const Route = createFileRoute("/painel/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp Business — Vitrine Criativa" },
      { name: "description", content: "Conecte sua loja ao catálogo do WhatsApp Business." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WhatsAppPage,
});

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  if (digits.length === 11 || digits.length === 10) return `+55${digits}`;
  if (digits.length >= 12) return `+${digits}`;
  return `+55${digits}`;
}

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const num = digits.slice(4);
    if (num.length === 9) return `(${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
    if (num.length === 8) return `(${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }
  return phone;
}

function WhatsAppPage() {
  const { t, formatNumber, formatDateTime } = useI18n();
  const { user } = useAuth();
  const { data: catalog } = useMyCatalog(user?.id);
  const catalogId = catalog?.id;

  const { data: connection, isLoading: connLoading } = useMetaConnection(catalogId);
  const { data: syncLogs } = useMetaSyncLogs(catalogId);

  const startOAuth = useStartOAuth();
  const completeOAuth = useCompleteOAuth();
  const syncProducts = useSyncProducts(catalogId);
  const disconnectMeta = useDisconnectMeta(catalogId);

  const [phoneInput, setPhoneInput] = useState("");
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const isConnected = connection?.sync_status === "connected";
  const isSyncing = connection?.sync_status === "syncing" || syncProducts.isPending;
  const hasError = connection?.sync_status === "error";
  const isExpired = connection?.sync_status === "expired";

  useEffect(() => {
    if (connection?.phone_number) {
      setPhoneInput(connection.phone_number);
    }
  }, [connection?.phone_number]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code && state) {
      completeOAuth.mutate(
        { code, state },
        {
          onSuccess: () => {
            toast.success(t("whatsapp.connectedToast"));
            window.history.replaceState({}, "", "/painel/whatsapp");
          },
          onError: (err: Error) => {
            toast.error(err.message || t("whatsapp.connectError"));
            window.history.replaceState({}, "", "/painel/whatsapp");
          },
        },
      );
    }
  }, []);

  async function handleConnect() {
    if (!catalogId) return;
    const normalized = normalizePhone(phoneInput);
    if (!phoneInput.trim()) {
      toast.error(t("whatsapp.phoneRequired"));
      return;
    }
    if (!/^\+\d{12,15}$/.test(normalized)) {
      toast.error(t("whatsapp.phoneInvalid"));
      return;
    }
    try {
      const url = await startOAuth.mutateAsync({ catalogId, phoneNumber: normalized });
      window.location.href = url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("não foi possível iniciar") || msg.includes("Meta App")) {
        toast.error(t("whatsapp.notConfigured"));
      } else {
        toast.error(msg || t("whatsapp.connectStartError"));
      }
    }
  }

  function handleSync() {
    if (!catalogId) return;
    syncProducts.mutate(undefined, {
      onSuccess: (data) => {
        toast.success(
          t("whatsapp.syncDoneToast", {
            created: formatNumber(data.items_created),
            updated: formatNumber(data.items_updated),
          }),
        );
      },
      onError: (err: Error) => {
        toast.error(err.message || t("whatsapp.syncError"));
      },
    });
  }

  function handleDisconnect() {
    if (!catalogId) return;
    disconnectMeta.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("whatsapp.disconnectedToast"));
        setShowDisconnectConfirm(false);
      },
      onError: (err: Error) => {
        toast.error(err.message || t("whatsapp.disconnectError"));
      },
    });
  }

  if (!catalog) {
    return (
      <div className="p-5 text-center text-muted-foreground">
        <p>{t("whatsapp.noCatalog")}</p>
      </div>
    );
  }

  if (completeOAuth.isPending) {
    return (
      <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
        <h1 className="text-xl font-bold text-foreground">{t("whatsapp.title")}</h1>
        <div className="rounded-2xl border border-border p-8 text-center space-y-4">
          <Loader2 className="mx-auto size-8 animate-spin text-primary" />
          <div>
            <p className="font-semibold text-foreground">{t("whatsapp.connectingTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("whatsapp.connectingHint")}</p>
          </div>
        </div>
      </div>
    );
  }

  if (isConnected && connection) {
    const displayPhone = connection.phone_number
      ? formatPhoneDisplay(connection.phone_number)
      : connection.business_name || "—";
    const syncedCount = syncLogs?.find((l) => l.status === "completed")?.items_created ?? 0;
    const lastSync = connection.last_synced_at
      ? formatDateTime(connection.last_synced_at, {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

    return (
      <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
        <h1 className="text-xl font-bold text-foreground">{t("whatsapp.title")}</h1>

        <div className="rounded-2xl border border-border p-5 space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 text-green-500" />
            <div>
              <p className="font-semibold text-green-600">{t("whatsapp.connected")}</p>
              <p className="text-xs text-muted-foreground">{t("whatsapp.integrationActive")}</p>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("whatsapp.number")}</span>
              <span className="font-medium text-foreground">{displayPhone}</span>
            </div>
            {connection.catalog_name && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("whatsapp.catalogName")}</span>
                <span className="font-medium text-foreground">{connection.catalog_name}</span>
              </div>
            )}
            {syncedCount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("whatsapp.syncedProducts")}</span>
                <span className="font-medium text-foreground">{formatNumber(syncedCount)}</span>
              </div>
            )}
            {lastSync && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("whatsapp.lastSync")}</span>
                <span className="font-medium text-foreground">{lastSync}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleSync}
            disabled={isSyncing}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {isSyncing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {isSyncing ? t("whatsapp.syncing") : t("whatsapp.syncNow")}
          </button>
          <button
            type="button"
            onClick={() => setShowDisconnectConfirm(true)}
            aria-label={t("whatsapp.disconnect")}
            className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <Unplug className="size-4" />
          </button>
        </div>

        {syncLogs && syncLogs.length > 0 && (
          <div className="rounded-2xl border border-border p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">{t("whatsapp.history")}</p>
            <div className="space-y-2">
              {syncLogs.slice(0, 5).map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 rounded-xl bg-muted/50 px-4 py-3 text-xs"
                >
                  {log.status === "completed" ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-500" />
                  ) : log.status === "failed" ? (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                  ) : (
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-foreground">
                      {log.operation === "incremental_sync"
                        ? t("whatsapp.operationIncremental")
                        : log.operation === "initial_sync"
                          ? t("whatsapp.operationInitial")
                          : log.operation === "disconnect"
                            ? t("whatsapp.operationDisconnect")
                            : log.operation}
                    </p>
                    <p className="text-muted-foreground">
                      {formatDateTime(log.started_at)}
                      {log.status === "completed" &&
                        ` — ${t("whatsapp.syncResult", {
                          created: formatNumber(log.items_created),
                          updated: formatNumber(log.items_updated),
                        })}`}
                      {log.status === "failed" && (
                        <span className="text-red-500">
                          {" — "}
                          {(log.error_details as any)?.[0]?.message || t("common.error")}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-foreground">{t("whatsapp.title")}</h1>
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
          {t("common.comingSoon")}
        </span>
      </div>

      <p className="text-sm text-muted-foreground">{t("whatsapp.subtitle")}</p>

      <div className="rounded-2xl border border-primary/25 bg-accent/40 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🚀</span>
          <div>
            <p className="font-semibold text-foreground">{t("whatsapp.newsTitle")}</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t("whatsapp.newsText")}
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">{t("whatsapp.title")}</p>
            <span className="ml-auto inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              {t("common.comingSoon")}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            <span>{t("whatsapp.integrationInProgress")}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t("whatsapp.comingSoonText")}</p>
          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-muted px-5 py-3.5 text-sm font-semibold text-muted-foreground opacity-70"
          >
            <Lock className="size-4" />
            {t("whatsapp.authorize")}
          </button>
        </div>
      </div>

      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-5">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 space-y-4 shadow-xl">
            <p className="font-semibold text-foreground">{t("whatsapp.disconnectTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("whatsapp.disconnectText")}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDisconnectConfirm(false)}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={disconnectMeta.isPending}
                className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
              >
                {disconnectMeta.isPending ? (
                  <Loader2 className="mx-auto size-4 animate-spin" />
                ) : (
                  t("whatsapp.disconnect")
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
