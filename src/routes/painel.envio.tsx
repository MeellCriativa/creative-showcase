import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleHelp,
  Info,
  Loader2,
  MapPin,
  Package,
  Plug,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { meApi } from "@/lib/shipping";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/painel/envio")({
  head: () => ({
    meta: [
      { title: "Envio — Vitrine Criativa" },
      {
        name: "description",
        content: "Conecte sua loja à Melhor Envio para envios com Correios e transportadoras.",
      },
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
  const { t } = useI18n();
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
      if (ok === "1") {
        toast.success(t("shipping.connectedToast"));
      } else {
        const rawErr = params.get("error");
        let detail = "";
        try {
          detail = rawErr ? decodeURIComponent(rawErr) : "";
        } catch {
          detail = rawErr || "";
        }
        console.error("[melhor-envio] callback retornou erro:", detail);
        toast.error(
          detail && detail !== "authorization_failed"
            ? t("shipping.connectError", { detail })
            : t("shipping.connectFailed"),
        );
      }
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
        toast.error(String(res.error || t("shipping.connectStartFailed")));
        return;
      }
      window.location.href = String(res.url);
    } catch (err) {
      console.error("[melhor-envio] connect exceção:", err);
      toast.error(t("shipping.connectStartError"));
    } finally {
      setConnecting(false);
    }
  }

  async function handleSaveSender() {
    if (!catalogId) return;
    if (
      !senderDraft.name ||
      !senderDraft.document ||
      !senderDraft.street ||
      !senderDraft.number ||
      !senderDraft.city ||
      !senderDraft.state ||
      !senderDraft.zip
    ) {
      toast.error(t("shipping.senderRequired"));
      return;
    }
    setSaving(true);
    try {
      const res = await meApi.saveSender(catalogId, senderDraft);
      if (!res.success) {
        toast.error(String(res.error || t("shipping.saveError")));
      } else {
        toast.success(t("shipping.senderSaved"));
        qc.invalidateQueries({ queryKey: ["me-status", catalogId] });
      }
    } catch {
      toast.error(t("shipping.senderSaveError"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!catalogId) return;
    const res = await meApi.disconnect(catalogId);
    if (res.success) {
      toast.success(t("shipping.disconnected"));
      qc.invalidateQueries({ queryKey: ["me-status", catalogId] });
    } else {
      toast.error(String(res.error || t("shipping.disconnectError")));
    }
  }

  if (!catalog) {
    return (
      <div className="p-5 text-center text-muted-foreground">
        <p>{t("shipping.noCatalog")}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
        <h1 className="text-xl font-bold text-foreground">{t("shipping.title")}</h1>
        <Loader2 className="mx-auto size-8 animate-spin text-primary" />
      </div>
    );
  }

  const connected = !!status?.connected;

  return (
    <div className="mx-auto max-w-lg space-y-5 p-5 pb-32">
      <h1 className="flex items-center gap-2 text-xl font-bold text-foreground">
        <Package className="size-5" /> {t("shipping.title")}
      </h1>

      <p className="text-sm text-muted-foreground">
        {t("shipping.introLead")} <strong className="text-foreground">Melhor Envio</strong>{" "}
        {t("shipping.introRest")}
      </p>

      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        {connected ? (
          <div className="flex items-center gap-3">
            <CheckCircle2 className="size-5 text-green-500" />
            <div>
              <p className="font-semibold text-green-600">{t("shipping.connected")}</p>
              <p className="text-xs text-muted-foreground">
                {t("shipping.environment")}:{" "}
                {status?.environment === "production"
                  ? t("shipping.environmentProduction")
                  : t("shipping.environmentSandbox")}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <MapPin
              className={`size-5 ${status?.needs_reconnect ? "text-amber-500" : "text-muted-foreground"}`}
            />
            <div>
              <p className="font-semibold text-foreground">
                {status?.needs_reconnect ? t("shipping.expired") : t("shipping.notConnected")}
              </p>
              <p className="text-xs text-muted-foreground">
                {status?.needs_reconnect
                  ? t("shipping.expiredHint")
                  : t("shipping.notConnectedHint")}
              </p>
            </div>
          </div>
        )}

        {connected && status?.environment === "sandbox" && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <RefreshCw className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold">{t("shipping.sandboxNoticeTitle")}</p>
              <p className="mt-0.5">{t("shipping.sandboxNotice")}</p>
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
          {connecting
            ? t("shipping.connecting")
            : connected
              ? t("shipping.disconnect")
              : status?.needs_reconnect
                ? t("shipping.reconnect")
                : t("shipping.connect")}
        </button>

        {/* Instruções para todas as lojas, logo abaixo do botão de conexão. */}
        <section
          aria-label={t("shipping.guide.title")}
          className="rounded-xl border border-border bg-background/60 p-4"
        >
          <h2 className="flex items-start gap-2 text-sm font-semibold text-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            {t("shipping.guide.title")}
          </h2>
          <ol className="mt-3 space-y-2">
            {[
              t("shipping.guide.step1"),
              t("shipping.guide.step2"),
              t("shipping.guide.step3"),
              t("shipping.guide.step4"),
              t("shipping.guide.step5"),
              t("shipping.guide.step6"),
            ].map((step, index) => (
              <li key={index} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0">{step}</span>
              </li>
            ))}
          </ol>

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <p className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="size-4 shrink-0" />
              {t("shipping.guide.importantTitle")}
            </p>
            <ul className="mt-2 space-y-1.5">
              {[
                t("shipping.guide.important1"),
                t("shipping.guide.important2"),
                t("shipping.guide.important3"),
                t("shipping.guide.important4"),
                t("shipping.guide.important5"),
                t("shipping.guide.important6"),
              ].map((item, index) => (
                <li key={index} className="flex gap-2">
                  <span aria-hidden="true" className="shrink-0">
                    •
                  </span>
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <CircleHelp className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold text-foreground">{t("shipping.guide.helpTitle")}</p>
              <p className="mt-0.5">{t("shipping.guide.helpText")}</p>
            </div>
          </div>
        </section>

        {!connected && (
          <p className="rounded-xl bg-accent/50 px-3 py-2 text-xs text-muted-foreground">
            {t("shipping.needAccount")}
          </p>
        )}
      </div>

      {connected && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">{t("shipping.senderTitle")}</p>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  const res = await meApi.status(catalogId!);
                  const s = res.sender;
                  toast[res.success ? "success" : "error"](
                    res.success
                      ? t("shipping.statusUpdated")
                      : String(res.error || t("shipping.errorFallback")),
                  );
                  if (s)
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
                })();
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary"
            >
              <RefreshCw className="size-3" /> {t("common.refresh")}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">{t("shipping.senderHint")}</p>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.fullName")}
              </label>
              <input
                value={senderDraft.name ?? ""}
                onChange={(e) => setSenderDraft((p) => ({ ...p, name: e.target.value }))}
                placeholder={t("shipping.fullNamePlaceholder")}
                className="input-base"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.document")}
              </label>
              <input
                value={senderDraft.document ?? ""}
                onChange={(e) =>
                  setSenderDraft((p) => ({ ...p, document: e.target.value.replace(/\D/g, "") }))
                }
                placeholder={t("shipping.documentPlaceholder")}
                className="input-base"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.phone")}
              </label>
              <input
                value={senderDraft.phone ?? ""}
                onChange={(e) => setSenderDraft((p) => ({ ...p, phone: e.target.value }))}
                placeholder="(51) 99999-9999"
                className="input-base"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.email")}
              </label>
              <input
                value={senderDraft.email ?? ""}
                onChange={(e) => setSenderDraft((p) => ({ ...p, email: e.target.value }))}
                placeholder={t("shipping.emailPlaceholder")}
                className="input-base"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.address")}
              </label>
              <input
                value={senderDraft.street ?? ""}
                onChange={(e) => setSenderDraft((p) => ({ ...p, street: e.target.value }))}
                placeholder={t("shipping.addressPlaceholder")}
                className="input-base"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.number")}
              </label>
              <input
                value={senderDraft.number ?? ""}
                onChange={(e) => setSenderDraft((p) => ({ ...p, number: e.target.value }))}
                placeholder="123"
                className="input-base"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.complement")}
              </label>
              <input
                value={senderDraft.complement ?? ""}
                onChange={(e) => setSenderDraft((p) => ({ ...p, complement: e.target.value }))}
                placeholder={t("shipping.complementPlaceholder")}
                className="input-base"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.district")}
              </label>
              <input
                value={senderDraft.district ?? ""}
                onChange={(e) => setSenderDraft((p) => ({ ...p, district: e.target.value }))}
                placeholder={t("shipping.districtPlaceholder")}
                className="input-base"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.city")}
              </label>
              <input
                value={senderDraft.city ?? ""}
                onChange={(e) => setSenderDraft((p) => ({ ...p, city: e.target.value }))}
                placeholder={t("shipping.cityPlaceholder")}
                className="input-base"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.state")}
              </label>
              <input
                value={senderDraft.state ?? ""}
                onChange={(e) =>
                  setSenderDraft((p) => ({ ...p, state: e.target.value.toUpperCase() }))
                }
                maxLength={2}
                placeholder="RS"
                className="input-base"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">
                {t("shipping.zip")}
              </label>
              <input
                value={senderDraft.zip ?? ""}
                onChange={(e) =>
                  setSenderDraft((p) => ({
                    ...p,
                    zip: e.target.value.replace(/\D/g, "").slice(0, 8),
                  }))
                }
                placeholder="00000000"
                className="input-base"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveSender}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("shipping.saveSender")}
          </button>
        </div>
      )}

      {!connected && (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground space-y-2">
          <p className="font-semibold text-foreground">{t("shipping.howItWorks")}</p>
          <p>{t("shipping.step1")}</p>
          <p>{t("shipping.step2")}</p>
          <p>{t("shipping.step3")}</p>
          <p>{t("shipping.step4")}</p>
        </div>
      )}
    </div>
  );
}
