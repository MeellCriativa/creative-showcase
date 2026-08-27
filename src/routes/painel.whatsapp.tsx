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
            toast.success("WhatsApp Business conectado com sucesso!");
            window.history.replaceState({}, "", "/painel/whatsapp");
          },
          onError: (err: Error) => {
            toast.error(
              err.message || "Não foi possível conectar. Verifique sua conta Meta e tente novamente.",
            );
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
      toast.error("Informe o número do WhatsApp Business.");
      return;
    }
    if (!/^\+\d{12,15}$/.test(normalized)) {
      toast.error("Número inválido. Use o formato: DDD + número (ex: 51999999999).");
      return;
    }
    try {
      const url = await startOAuth.mutateAsync({ catalogId, phoneNumber: normalized });
      window.location.href = url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("não foi possível iniciar") || msg.includes("Meta App")) {
        toast.error(
          "A integração com a Meta ainda não está configurada. Entre em contato com o suporte.",
        );
      } else {
        toast.error(msg || "Não foi possível iniciar a conexão. Tente novamente.");
      }
    }
  }

  function handleSync() {
    if (!catalogId) return;
    syncProducts.mutate(undefined, {
      onSuccess: (data) => {
        toast.success(
          `Sincronização concluída: ${data.items_created} criados, ${data.items_updated} atualizados`,
        );
      },
      onError: (err: Error) => {
        toast.error(err.message || "Erro na sincronização. Tente novamente.");
      },
    });
  }

  function handleDisconnect() {
    if (!catalogId) return;
    disconnectMeta.mutate(undefined, {
      onSuccess: () => {
        toast.success("Desconectado. Produtos no catálogo do WhatsApp foram mantidos.");
        setShowDisconnectConfirm(false);
      },
      onError: (err: Error) => {
        toast.error(err.message || "Erro ao desconectar. Tente novamente.");
      },
    });
  }

  if (!catalog) {
    return (
      <div className="p-5 text-center text-muted-foreground">
        <p>Crie sua loja primeiro para configurar o WhatsApp Business.</p>
      </div>
    );
  }

  if (completeOAuth.isPending) {
    return (
      <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
        <h1 className="text-xl font-bold text-foreground">WhatsApp Business</h1>
        <div className="rounded-2xl border border-border p-8 text-center space-y-4">
          <Loader2 className="mx-auto size-8 animate-spin text-primary" />
          <div>
            <p className="font-semibold text-foreground">Conectando sua conta...</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Aguarde enquanto configuramos a integração.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isConnected && connection) {
    const displayPhone =
      connection.phone_number
        ? formatPhoneDisplay(connection.phone_number)
        : connection.business_name || "—";
    const syncedCount = syncLogs?.find((l) => l.status === "completed")?.items_created ?? 0;
    const lastSync = connection.last_synced_at
      ? new Date(connection.last_synced_at).toLocaleString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

    return (
      <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
        <h1 className="text-xl font-bold text-foreground">WhatsApp Business</h1>

        <div className="rounded-2xl border border-border p-5 space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 text-green-500" />
            <div>
              <p className="font-semibold text-green-600">Conectado</p>
              <p className="text-xs text-muted-foreground">Integração ativa</p>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Número</span>
              <span className="font-medium text-foreground">{displayPhone}</span>
            </div>
            {connection.catalog_name && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Catálogo</span>
                <span className="font-medium text-foreground">{connection.catalog_name}</span>
              </div>
            )}
            {syncedCount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Produtos sincronizados</span>
                <span className="font-medium text-foreground">{syncedCount}</span>
              </div>
            )}
            {lastSync && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Última sincronização</span>
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
            {isSyncing ? "Sincronizando..." : "Sincronizar agora"}
          </button>
          <button
            type="button"
            onClick={() => setShowDisconnectConfirm(true)}
            className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted"
          >
            <Unplug className="size-4" />
          </button>
        </div>

        {syncLogs && syncLogs.length > 0 && (
          <div className="rounded-2xl border border-border p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">Histórico</p>
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
                        ? "Sincronização"
                        : log.operation === "initial_sync"
                          ? "Sync inicial"
                          : log.operation === "disconnect"
                            ? "Desconexão"
                            : log.operation}
                    </p>
                    <p className="text-muted-foreground">
                      {new Date(log.started_at).toLocaleString("pt-BR")}
                      {log.status === "completed" &&
                        ` — ${log.items_created} criados, ${log.items_updated} atualizados`}
                      {log.status === "failed" && (
                        <span className="text-red-500">
                          {" — "}
                          {(log.error_details as any)?.[0]?.message || "Erro"}
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
        <h1 className="text-xl font-bold text-foreground">WhatsApp Business</h1>
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary">
          Em breve
        </span>
      </div>

      <p className="text-sm text-muted-foreground">
        Conecte seu WhatsApp Business para que os produtos do seu catálogo apareçam automaticamente
        na vitrine do WhatsApp.
      </p>

      <div className="rounded-2xl border border-primary/25 bg-accent/40 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">🚀</span>
          <div>
            <p className="font-semibold text-foreground">Novidade chegando!</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              A integração com o WhatsApp Business estará disponível em uma das próximas atualizações
              do Vitrine Criativa. Em breve você poderá conectar seu WhatsApp e integrar seu catálogo
              de forma ainda mais prática. 💜
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="size-4 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">WhatsApp Business</p>
            <span className="ml-auto inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
              Em breve
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="size-3.5" />
            <span>Integração em desenvolvimento</span>
          </div>
          <p className="text-xs text-muted-foreground">
            A conexão direta com o WhatsApp Business estará disponível em uma das próximas
            atualizações.
          </p>
          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-muted px-5 py-3.5 text-sm font-semibold text-muted-foreground opacity-70"
          >
            <Lock className="size-4" />
            Autorizar e conectar
          </button>
        </div>
      </div>

      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-5">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 space-y-4 shadow-xl">
            <p className="font-semibold text-foreground">Desconectar WhatsApp Business?</p>
            <p className="text-sm text-muted-foreground">
              A autorização será removida, mas os produtos já sincronizados no catálogo do WhatsApp
              serão mantidos. Você pode reconectar a qualquer momento.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setShowDisconnectConfirm(false)}
                className="flex-1 rounded-xl border border-border px-4 py-2.5 text-sm font-medium"
              >
                Cancelar
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
                  "Desconectar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
