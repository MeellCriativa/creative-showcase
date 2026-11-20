import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Info, Link2, Loader2, QrCode, RefreshCw, Store } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { useI18n } from "@/i18n";
import {
  buildStoreQrUrl,
  downloadQrPng,
  generateQrPngDataUrl,
  normalizeQrUrl,
} from "@/lib/qr-code";

export const Route = createFileRoute("/painel/qr-code")({
  head: () => ({
    meta: [
      { title: "QR Code da Minha Loja — Vitrine Criativa" },
      {
        name: "description",
        content: "Transforme o link da sua loja em um QR Code gratuito e pronto para impressão.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: QrCodePage,
});

function QrCodePage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: catalog, isLoading } = useMyCatalog(user?.id);

  // Link salvo no catálogo — nunca um slug de rascunho — é o ponto de partida.
  const storeUrl = catalog?.slug ? buildStoreQrUrl(catalog.slug) : "";
  const [storeUrlApplied, setStoreUrlApplied] = useState(false);

  const [urlInput, setUrlInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [pngDataUrl, setPngDataUrl] = useState<string | null>(null);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (storeUrl && !storeUrlApplied) {
      setUrlInput(storeUrl);
      setStoreUrlApplied(true);
    }
  }, [storeUrl, storeUrlApplied]);

  if (isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-label={t("common.loading")} />
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="px-5 pb-10 pt-10">
        <h1 className="text-2xl font-bold text-foreground">{t("qrCode.title")}</h1>
        <p className="mt-2 rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          {t("qrCode.noCatalog")}
        </p>
      </div>
    );
  }

  async function handleGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = normalizeQrUrl(urlInput);
    if (!result.ok) {
      setInvalid(true);
      setPngDataUrl(null);
      setGeneratedUrl(null);
      return;
    }

    setInvalid(false);
    setGenerating(true);
    try {
      const png = await generateQrPngDataUrl(result.url);
      setPngDataUrl(png);
      setGeneratedUrl(result.url);
    } catch (error) {
      console.error("[qr-code] falha ao gerar PNG", error);
      setPngDataUrl(null);
      setGeneratedUrl(null);
      toast.error(t("qrCode.generateError"));
    } finally {
      setGenerating(false);
    }
  }

  function handleAnother() {
    setPngDataUrl(null);
    setGeneratedUrl(null);
    setInvalid(false);
    if (storeUrl) setUrlInput(storeUrl);
  }

  function handleDownload() {
    if (!pngDataUrl || !generatedUrl) return;
    try {
      downloadQrPng(pngDataUrl, "qr-code-minha-loja.png", document);
    } catch (error) {
      console.error("[qr-code] falha ao baixar PNG", error);
      toast.error(t("qrCode.downloadError"));
    }
  }

  return (
    <div className="px-5 pb-10 pt-10">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">{t("qrCode.title")}</h1>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("qrCode.description")}
          </p>
        </div>
        <span className="mt-1 shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-primary">
          {t("qrCode.freeBadge")}
        </span>
      </header>

      <form onSubmit={handleGenerate} className="mt-6 rounded-2xl border border-border bg-card p-5">
        <label htmlFor="qr-code-url" className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="size-4 text-primary" />
          {t("qrCode.fieldLabel")}
        </label>
        <input
          id="qr-code-url"
          type="text"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          value={urlInput}
          onChange={(event) => {
            setUrlInput(event.target.value);
            if (invalid) setInvalid(false);
            // Evita que um QR antigo continue aparecendo depois que o link mudou.
            setPngDataUrl(null);
            setGeneratedUrl(null);
          }}
          placeholder={t("qrCode.fieldPlaceholder")}
          aria-invalid={invalid}
          aria-describedby={invalid ? "qr-code-error" : "qr-code-hint"}
          className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-3 text-sm text-foreground outline-none focus:border-primary"
        />
        {invalid ? (
          <p id="qr-code-error" className="mt-1.5 text-xs text-red-500">
            {t("qrCode.invalidUrl")}
          </p>
        ) : (
          <p id="qr-code-hint" className="mt-1.5 text-xs text-muted-foreground">
            {t("qrCode.storeLinkHint")}
          </p>
        )}

        {storeUrl && urlInput.trim() !== storeUrl && (
          <button
            type="button"
            onClick={() => {
              setUrlInput(storeUrl);
              setInvalid(false);
            }}
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          >
            <Store className="size-3.5" />
            {t("qrCode.useStoreLink")}
          </button>
        )}

        <button
          type="submit"
          disabled={generating}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {generating ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
          {generating ? t("qrCode.generating") : t("qrCode.generateButton")}
        </button>

        <p className="mt-3 flex items-start gap-2 rounded-xl bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0 text-primary" />
          {t("qrCode.linkChangeHint")}
        </p>
      </form>

      {pngDataUrl && generatedUrl && (
        <section className="mt-4 overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/12 via-accent to-background p-5">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <QrCode className="size-4 text-primary" />
            {t("qrCode.generatedTitle")}
          </p>

          <div className="mx-auto mt-4 grid max-w-[21rem] place-items-center rounded-2xl bg-white p-4 shadow-sm">
            <img
              src={pngDataUrl}
              alt={t("qrCode.title")}
              className="aspect-square w-full object-contain"
            />
          </div>

          <div className="mt-4 rounded-2xl border border-border bg-card/80 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
              {t("qrCode.targetLabel")}
            </p>
            <a
              href={generatedUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block break-all text-sm font-medium text-foreground hover:underline"
            >
              {generatedUrl}
            </a>
            <p className="mt-1 text-[11px] text-muted-foreground">{t("qrCode.printHint")}</p>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={handleDownload}
              className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
            >
              <Download className="size-4" />
              {t("qrCode.downloadButton")}
            </button>
            <button
              type="button"
              onClick={handleAnother}
              className="flex items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold text-foreground"
            >
              <RefreshCw className="size-4" />
              {t("qrCode.anotherButton")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
