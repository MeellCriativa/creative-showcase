import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
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
      { title: "WhatsApp & Catálogo Meta — Vitrine Criativa" },
      { name: "description", content: "Conecte sua loja ao catálogo Meta do WhatsApp Business." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WhatsAppPage,
});

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

  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  const isConnected = connection?.sync_status === "connected";
  const isSyncing = connection?.sync_status === "syncing" || syncProducts.isPending;
  const hasError = connection?.sync_status === "error";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (code && state) {
      completeOAuth.mutate(
        { code, state },
        {
          onSuccess: () => {
            toast.success("Conta Meta conectada com sucesso!");
            window.history.replaceState({}, "", "/painel/whatsapp");
          },
          onError: (err: Error) => {
            toast.error(err.message || "Erro ao conectar com Meta");
            window.history.replaceState({}, "", "/painel/whatsapp");
          },
        },
      );
    }
  }, []);

  async function handleConnect() {
    if (!catalogId) return;
    try {
      const url = await startOAuth.mutateAsync(catalogId);
      window.location.href = url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao iniciar conexão";
      toast.error(msg);
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
        toast.error(err.message || "Erro na sincronização");
      },
    });
  }

  function handleDisconnect() {
    if (!catalogId) return;
    disconnectMeta.mutate(undefined, {
      onSuccess: () => {
        toast.success("Desconectado. Produtos no catálogo Meta foram mantidos.");
        setShowDisconnectConfirm(false);
      },
      onError: (err: Error) => {
        toast.error(err.message || "Erro ao desconectar");
      },
    });
  }

  if (!catalog) {
    return (
      <div className="p-5 text-center text-muted-foreground">
        <p>Crie sua loja primeiro para configurar a integração com Meta.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
      <h1 className="text-xl font-bold text-foreground">WhatsApp & Catálogo Meta</h1>

      <p className="text-sm text-muted-foreground">
        Conecte sua conta Meta para sincronizar seus produtos com o catálogo vinculado ao WhatsApp
        Business.
      </p>

      {/* Connection Status Card */}
      <div className="rounded-2xl border border-border p-5 space-y-4">
        <div className="flex items-center gap-3">
          {connLoading ? (
            <Loader2 className="size-5 animate-spin text-primary" />
          ) : isConnected ? (
            <CheckCircle2 className="size-5 text-green-500" />
          ) : hasError ? (
            <XCircle className="size-5 text-red-500" />
          ) : (
            <MessageCircle className="size-5 text-muted-foreground" />
          )}
          <div>
            <p className="font-semibold text-foreground">
              {connLoading
                ? "Verificando..."
                : isConnected
                  ? "Conectado ao Meta"
                  : hasError
                    ? "Erro na conexão"
                    : "Não conectado"}
            </p>
            {isConnected && connection && (
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p>
                  Business: {connection.business_name || connection.business_id}
                </p>
                <p>
                  Catálogo: {connection.catalog_name || connection.catalog_id_meta}
                </p>
                {connection.last_synced_at && (
                  <p>
                    Última sync:{" "}
                    {new Date(connection.last_synced_at).toLocaleString("pt-BR")}
                  </p>
                )}
              </div>
            )}
            {hasError && connection?.last_sync_error && (
              <p className="text-xs text-red-500 mt-1">{connection.last_sync_error}</p>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          {!isConnected && !connLoading && (
            <button
              type="button"
              onClick={handleConnect}
              disabled={startOAuth.isPending}
              className="flex items-center gap-2 rounded-xl bg-[#1877f2] px-5 py-3 text-sm font-semibold text-white hover:bg-[#166fe5] disabled:opacity-60"
            >
              {startOAuth.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ExternalLink className="size-4" />
              )}
              Conectar conta Meta
            </button>
          )}

          {isConnected && (
            <>
              <button
                type="button"
                onClick={handleSync}
                disabled={isSyncing}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
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
                className="flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                <Unplug className="size-4" />
                Desconectar
              </button>
            </>
          )}

          {hasError && (
            <button
              type="button"
              onClick={handleSync}
              disabled={isSyncing}
              className="flex items-center gap-2 rounded-xl bg-red-500 px-5 py-3 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
            >
              {isSyncing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              Tentar novamente
            </button>
          )}
        </div>
      </div>

      {/* Sync Logs */}
      {syncLogs && syncLogs.length > 0 && (
        <div className="rounded-2xl border border-border p-5 space-y-3">
          <p className="text-sm font-semibold text-foreground">Últimas operações</p>
          <div className="space-y-2">
            {syncLogs.map((log) => (
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
                    {log.status === "completed" && (
                      <>
                        {" — "}
                        {log.items_created} criados, {log.items_updated} atualizados
                        {log.items_deleted > 0 && `, ${log.items_deleted} deletados`}
                      </>
                    )}
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

      {/* Info Card */}
      <div className="rounded-2xl border border-border bg-muted/30 p-5 text-xs text-muted-foreground space-y-2">
        <p className="font-semibold text-foreground text-sm">Sobre a integração</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>
            Produtos criados/editados no Vitrine são sincronizados com o catálogo Meta do WhatsApp
            Business.
          </li>
          <li>A sincronização é manual — clique "Sincronizar agora" sempre que quiser atualizar.</li>
          <li>
            Ao desconectar, os produtos já sincronizados no catálogo Meta são mantidos.
          </li>
          <li>
            Não enviamos mensagens automáticas pelo WhatsApp. O carrinho continua funcionando da
            mesma forma.
          </li>
        </ul>
      </div>

      {/* Disconnect Confirmation Modal */}
      {showDisconnectConfirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-5">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 space-y-4 shadow-xl">
            <p className="font-semibold text-foreground">Desconectar conta Meta?</p>
            <p className="text-sm text-muted-foreground">
              A autorização será removida, mas os produtos já sincronizados no catálogo Meta serão
              mantidos. Você pode reconectar a qualquer momento.
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
