import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  MapPin,
  Package,
  Plug,
  RefreshCw,
  Unplug,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { meApi } from "@/lib/shipping";

export const Route = createFileRoute("/painel/envio")({
  head: () => ({
    meta: [
      { title: "Envio — Vitrine Criativa" },
      { name: "description", content: "Conecte sua loja à Melhor Envio para envios com Correios e transportadoras." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EnvioPage,
});

type SenderDraft = {
  name: string;
  document: string;
  phone: string;
  email: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  zip: string;
};

function EnvioPage() {
  const { user } = useAuth();
  const { data: catalog } = useMyCatalog(user?.id);
  const catalogId = catalog?.id;
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ["me-status", catalogId],
    enabled: !!catalogId,
    queryFn: async () => {
      const res = await meApi.status(catalogId!);
      return res;
    },
  });

  const [senderDraft, setSenderDraft] = useState<SenderDraft>({
    name: "",
    document: "",
    phone: "",
    email: "",
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
    zip: "",
  });
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ok = params.get("me_connected");
    if (ok) {
      toast[ok === "1" ? "success" : "error"](
        ok === "1"
          ? "Loja conectada à Melhor Envio!"
          : "A conexão com a Melhor Envio não pôde ser concluída.",
      );
      window.history.replaceState({}, "", "/painel/envio");
      qc.invalidateQueries({ queryKey: ["me-status", catalogId] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogId]);

  useEffect(() => {
    const s = status?.sender;
    if (s) {
      setSenderDraft({
        name: String(s.name ?? ""),
        document: String(s.document ?? ""),
        phone: String(s.phone ?? ""),
        email: String(s.email ?? ""),
        street: String(s.street ?? ""),
        number: String(s.number ?? ""),
        complement: String(s.complement ?? ""),
        district: String(s.district ?? ""),
        city: String(s.city ?? ""),
        state: String(s.state ?? ""),
        zip: String(s.zip ?? ""),
      });
    }
  }, [status]);

  async function handleConnect() {
    if (!catalogId) return;
    setConnecting(true);
    try {
      const res = await meApi.connect(catalogId);
      if (!res.success || !res.url) {
        console.error("[melhor-envio] connect falhou:", res.error);
        toast.error(String(res.error || "Falha ao iniciar a conexão."));
        return;
      }
      window.location.href = String(res.url);
    } catch (err) {
      console.error("[melhor-envio] connect exceção:", err);
      toast.error("Não foi possível iniciar a conexão. Tente novamente.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleSaveSender() {
    if (!catalogId) return;
    if (!senderDraft.name || !senderDraft.document || !senderDraft.street || !senderDraft.number || !senderDraft.city || !senderDraft.state || !senderDraft.zip) {
      toast.error("Preencha nome, CPF/CNPJ, rua, número, cidade, UF e CEP do remetente.");
      return;
    }
    setSaving(true);
    try {
      const res = await meApi.saveSender(catalogId, senderDraft);
      if (!res.success) {
        toast.error(String(res.error || "Erro ao salvar."));
      } else {
        toast.success("Remetente salvo!");
        qc.invalidateQueries({ queryKey: ["me-status", catalogId] });
      }
    } catch {
      toast.error("Erro ao salvar o remetente.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!catalogId) return;
    const res = await meApi.disconnect(catalogId);
    if (res.success) {
      toast.success("Loja desconectada da Melhor Envio.");
      qc.invalidateQueries({ queryKey: ["me-status", catalogId] });
    } else {
      toast.error(String(res.error || "Erro ao desconectar."));
    }
  }

  if (!catalog) {
    return (
      <div className="p-5 text-center text-muted-foreground">
        <p>Crie sua loja primeiro para configurar os envios.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
        <h1 className="text-xl font-bold text-foreground">Envio</h1>
        <Loader2 className="mx-auto size-8 animate-spin text-primary" />
      </div>
    );
  }

  const connected = !!status?.connected;

  return (
    <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
      <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
        <Package className="size-5" /> Envio (Correios e transportadoras)
      </h1>

      <p className="text-sm text-muted-foreground">
        Conecte sua loja à <strong className="text-foreground">Melhor Envio</strong> para calcular frete,
        gerar etiquetas e acompanhar o rastreio dos seus pedidos com Correios, Jadlog, Azul e outras
        transportadoras.
      </p>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        {connected ? (
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 text-green-500" />
            <div>
              <p className="font-semibold text-green-600">Loja conectada</p>
              <p className="text-xs text-muted-foreground">
                Ambiente: {status?.environment === "production" ? "Produção" : "Sandbox (testes)"}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <MapPin className="size-5 text-muted-foreground" />
            <div>
              <p className="font-semibold text-foreground">Não conectado</p>
              <p className="text-xs text-muted-foreground">
                Autorize sua conta da Melhor Envio para começar.
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={connected ? handleDisconnect : handleConnect}
          disabled={connecting}
          className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3.5 text-sm font-semibold disabled:opacity-60 ${
            connected
              ? "border border-border text-muted-foreground hover:bg-muted"
              : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
        >
          {connecting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : connected ? (
            <Unplug className="size-4" />
          ) : (
            <Plug className="size-4" />
          )}
          {connecting ? "Conectando..." : connected ? "Desconectar" : "Conectar à Melhor Envio"}
        </button>

        {!connected && (
          <p className="rounded-xl bg-accent/50 px-3 py-2 text-xs text-muted-foreground">
            Você precisará de uma conta na Melhor Envio (é grátis). Ao autorizar, usaremos a sua conta
            para calcular fretes e gerar as etiquetas dos seus pedidos.
          </p>
        )}
      </div>

      {connected && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Dados do remetente</p>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const res = await meApi.status(catalogId!);
                  const s = res.sender;
                  toast[res.success ? "success" : "error"](
                    res.success ? "Status atualizado." : String(res.error || "Erro."),
                  );
                  if (s) setSenderDraft({
                    name: String(s.name ?? ""),
                    document: String(s.document ?? ""),
                    phone: String(s.phone ?? ""),
                    email: String(s.email ?? ""),
                    street: String(s.street ?? ""),
                    number: String(s.number ?? ""),
                    complement: String(s.complement ?? ""),
                    district: String(s.district ?? ""),
                    city: String(s.city ?? ""),
                    state: String(s.state ?? ""),
                    zip: String(s.zip ?? ""),
                  });
                })();
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary"
            >
              <RefreshCw className="size-3" /> Atualizar
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            O endereço de onde os produtos são enviados. Usado para calcular o frete e gerar as etiquetas.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-foreground">Nome completo</label>
              <input value={senderDraft.name ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Nome do remetente" className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">CPF ou CNPJ</label>
              <input value={senderDraft.document ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, document: e.target.value.replace(/\D/g, "") }))} placeholder="Somente números" className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Telefone / WhatsApp</label>
              <input value={senderDraft.phone ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, phone: e.target.value }))} placeholder="(51) 99999-9999" className="input-base" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-foreground">E-mail</label>
              <input value={senderDraft.email ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, email: e.target.value }))} placeholder="email@exemplo.com" className="input-base" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-foreground">Endereço</label>
              <input value={senderDraft.street ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, street: e.target.value }))} placeholder="Rua / Logradouro" className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Número</label>
              <input value={senderDraft.number ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, number: e.target.value }))} placeholder="123" className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Complemento</label>
              <input value={senderDraft.complement ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, complement: e.target.value }))} placeholder="Apto, bloco..." className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Bairro</label>
              <input value={senderDraft.district ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, district: e.target.value }))} placeholder="Bairro" className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Cidade</label>
              <input value={senderDraft.city ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, city: e.target.value }))} placeholder="Cidade" className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">UF</label>
              <input value={senderDraft.state ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, state: e.target.value.toUpperCase() }))} maxLength={2} placeholder="RS" className="input-base" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">CEP</label>
              <input value={senderDraft.zip ?? ""} onChange={(e) => setSenderDraft((p) => ({ ...p, zip: e.target.value.replace(/\D/g, "").slice(0, 8) }))} placeholder="00000000" className="input-base" />
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveSender}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar remetente
          </button>
        </div>
      )}

      {!connected && (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground">Como funciona</p>
          <p>1. Clique em “Conectar à Melhor Envio” e autorize com sua conta.</p>
          <p>2. Preencha o endereço do remetente (de onde saem os envios).</p>
          <p>3. Na personalização da loja, marque “Envio” como forma de entrega.</p>
          <p>4. Nos pedidos, crie o envio, pague e gere a etiqueta.</p>
        </div>
      )}
    </div>
  );
}
