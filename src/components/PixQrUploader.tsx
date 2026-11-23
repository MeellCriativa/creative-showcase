import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, QrCode, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { useI18n } from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const BUCKET = "catalog-images";
const PIX_QR_FOLDER = "pix-qr";
const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/png", "image/jpeg"];
const ACCEPT = ".png,.jpg,.jpeg";
const SIGNED_URL_SECONDS = 60 * 60;

type Props = {
  catalogId: string;
  /** Caminho do arquivo no Storage (pix_qr_path do catálogo). */
  value: string | null;
  onChange: (path: string | null) => void;
  disabled?: boolean;
};

/**
 * Upload isolado por loja: o arquivo vive em `pix-qr/<catalog_id>/...`.
 * A leitura no painel usa URL assinada curta; no checkout a URL é gerada pela
 * Edge Function pix-manual. O comprador nunca recebe acesso direto ao Storage.
 */
export function PixQrUploader({ catalogId, value, onChange, disabled }: Props) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    if (!value) return;

    void (async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(value, SIGNED_URL_SECONDS);
      if (cancelled) return;
      if (error || !data?.signedUrl) {
        toast.error(t("payments.qr.previewFailed"));
        return;
      }
      setPreview(data.signedUrl);
    })();

    return () => {
      cancelled = true;
    };
  }, [value, t]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error(t("payments.qr.invalidType"));
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(t("payments.qr.tooLarge"));
      return;
    }

    setBusy(true);
    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      const safeExtension =
        extension === "png" || extension === "jpg" || extension === "jpeg" ? extension : "png";
      const path = `${PIX_QR_FOLDER}/${catalogId}/${Date.now()}-${crypto.randomUUID()}.${safeExtension}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type,
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) throw error;

      const previous = value;
      onChange(path);
      // Remove o arquivo antigo apenas depois que o novo foi gravado com sucesso.
      if (previous && previous !== path) {
        void supabase.storage.from(BUCKET).remove([previous]);
      }
      toast.success(t("payments.qr.uploaded"));
    } catch (error) {
      console.error("[pix-qr] upload falhou:", error);
      toast.error(t("payments.qr.uploadFailed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleRemove() {
    if (!value) return;
    if (!window.confirm(t("payments.qr.removeConfirm"))) return;

    setBusy(true);
    try {
      const { error } = await supabase.storage.from(BUCKET).remove([value]);
      if (error) throw error;
      onChange(null);
      toast.success(t("payments.qr.removed"));
    } catch (error) {
      console.error("[pix-qr] remoção falhou:", error);
      toast.error(t("payments.qr.removeFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <QrCode className="size-4" /> {t("payments.qr.title")}
        </p>
        {value && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="size-3.5" /> {t("payments.qr.registered")}
          </span>
        )}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">{t("payments.qr.hint")}</p>

      {preview ? (
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <div className="grid size-36 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white p-2">
            <img
              src={preview}
              alt={t("payments.qr.previewAlt")}
              className="max-h-full max-w-full object-contain"
            />
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:mt-1">
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50",
              )}
            >
              <Upload className="size-3.5" /> {t("payments.qr.replace")}
            </button>
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() => void handleRemove()}
              className="flex items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> {t("payments.qr.remove")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/50 px-4 py-6 text-center text-sm font-semibold text-muted-foreground transition hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-6 animate-spin" /> : <QrCode className="size-6" />}
          <span>{busy ? "..." : t("payments.qr.upload")}</span>
          <span className="text-[11px] font-normal text-muted-foreground">
            PNG, JPG, JPEG · 2 MB
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        disabled={busy || disabled}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
    </div>
  );
}
