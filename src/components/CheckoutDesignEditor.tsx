import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Check, ImagePlus, Loader2, Star, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { uploadImage } from "@/lib/catalog";
import {
  BANNER_SIZE,
  bannerAspectWarning,
  countdownParts,
  parseCheckoutConfig,
  type CheckoutConfig,
  type Device,
  type TestimonialConfig,
} from "@/lib/checkoutConfig";
import { useAuth } from "@/hooks/useAuth";
import { useI18n, type MessageKey } from "@/i18n";
import type { Product } from "@/lib/catalog";

type Props = {
  product: Product;
  catalogId: string;
  storeName: string;
  currency: string;
  onClose: () => void;
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function CheckoutDesignEditor({ product, catalogId, storeName, currency, onClose }: Props) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [device, setDevice] = useState<Device>("desktop");
  const [configs, setConfigs] = useState<Record<Device, CheckoutConfig>>({
    desktop: parseCheckoutConfig(product.checkout_desktop_config),
    mobile: parseCheckoutConfig(product.checkout_mobile_config),
  });
  const [testimonials, setTestimonials] = useState<TestimonialConfig[]>([]);
  const [deletedTestimonials, setDeletedTestimonials] = useState<string[]>([]);
  const [undoSnapshot, setUndoSnapshot] = useState<Record<Device, CheckoutConfig> | null>(null);
  const [checkoutEnabled, setCheckoutEnabled] = useState(Boolean(product.checkout_enabled));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [bannerWarning, setBannerWarning] = useState(false);
  const bannerInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ data: banners }, { data: rows }] = await Promise.all([
        supabase
          .from("banners")
          .select("device, image_url, object_position, href")
          .eq("product_id", product.id),
        supabase
          .from("product_testimonials")
          .select("id, customer_name, content, stars, truth_confirmed")
          .eq("product_id", product.id)
          .order("position", { ascending: true }),
      ]);
      if (!active) return;
      if (banners?.length) {
        setConfigs((prev) => {
          const next = clone(prev);
          for (const b of banners) {
            if (b.device === "desktop" || b.device === "mobile") {
              next[b.device].banner = {
                imageUrl: b.image_url,
                objectPosition: b.object_position ?? "center",
                href: b.href ?? "",
              };
            }
          }
          return next;
        });
      }
      setTestimonials(
        (rows ?? []).map((r) => ({
          id: r.id,
          customerName: r.customer_name,
          content: r.content,
          stars: r.stars,
          truthConfirmed: r.truth_confirmed,
        })),
      );
    })();
    return () => {
      active = false;
    };
  }, [product.id]);

  const config = configs[device];
  const update = (patch: Partial<CheckoutConfig>) =>
    setConfigs((prev) => ({ ...prev, [device]: { ...prev[device], ...patch } }));

  const now = useTick(config.countdown.enabled);
  const countdown = countdownParts(config.countdown.endsAt, now);

  async function handleBanner(file: File | undefined) {
    if (!file || !user) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast.error(t("checkoutEditor.banner.formats"));
      return;
    }
    const image = new Image();
    image.onload = async () => {
      setBannerWarning(bannerAspectWarning(image.naturalWidth, image.naturalHeight));
      setUploading(true);
      try {
        const url = await uploadImage(file, user.id);
        update({ banner: { ...config.banner, imageUrl: url } });
      } catch {
        toast.error(t("checkoutEditor.saveError"));
      } finally {
        setUploading(false);
        if (bannerInput.current) bannerInput.current.value = "";
      }
    };
    image.src = URL.createObjectURL(file);
  }

  function toggleCountdown(enabled: boolean) {
    const expires = config.countdown.endsAt;
    const expired = !expires || new Date(expires).getTime() <= Date.now();
    update({
      countdown: {
        ...config.countdown,
        enabled,
        endsAt: enabled && expired ? new Date(Date.now() + 15 * 60_000).toISOString() : expires,
      },
    });
  }

  function copyDesktopToMobile() {
    setUndoSnapshot(clone(configs));
    setConfigs((prev) => ({ ...prev, mobile: clone(prev.desktop) }));
    toast.success(t("checkoutEditor.copy.done"));
  }

  function undoCopy() {
    if (!undoSnapshot) return;
    setConfigs(clone(undoSnapshot));
    setUndoSnapshot(null);
    toast.success(t("checkoutEditor.copy.undone"));
  }

  function addTestimonial() {
    setTestimonials((prev) => [
      ...prev,
      {
        id: `tmp-${crypto.randomUUID()}`,
        customerName: "",
        content: "",
        stars: 5,
        truthConfirmed: false,
      },
    ]);
  }

  function patchTestimonial(id: string, patch: Partial<TestimonialConfig>) {
    setTestimonials((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  async function save() {
    if (testimonials.some((item) => !item.truthConfirmed)) {
      toast.error(t("checkoutEditor.testimonials.truth"));
      return;
    }
    setSaving(true);
    try {
      const bannerRows = (["desktop", "mobile"] as Device[])
        .filter((d) => configs[d].banner.imageUrl)
        .map((d) => ({
          catalog_id: catalogId,
          product_id: product.id,
          device: d,
          image_url: configs[d].banner.imageUrl!,
          object_position: configs[d].banner.objectPosition || "center",
          href: configs[d].banner.href || null,
          position: 0,
        }));

      // A tabela permite vários banners por dispositivo; removemos apenas os
      // antigos deste produto que não foram recém-criados.
      let freshIds = new Set<string>();
      if (bannerRows.length) {
        const bannerResult = await supabase.from("banners").insert(bannerRows).select("id, device");
        if (bannerResult.error) throw bannerResult.error;
        freshIds = new Set((bannerResult.data ?? []).map((r) => r.id));
      }
      const { data: oldRows } = await supabase
        .from("banners")
        .select("id")
        .eq("product_id", product.id);
      const staleIds = (oldRows ?? []).map((r) => r.id).filter((id) => !freshIds.has(id));
      if (staleIds.length) {
        await supabase.from("banners").delete().in("id", staleIds);
      }

      if (deletedTestimonials.length) {
        await supabase.from("product_testimonials").delete().in("id", deletedTestimonials);
      }
      for (const [index, item] of testimonials.entries()) {
        const row = {
          product_id: product.id,
          catalog_id: catalogId,
          customer_name: item.customerName.trim() || "—",
          content: item.content.trim() || "—",
          stars: Math.min(5, Math.max(1, item.stars)),
          position: index,
          truth_confirmed: item.truthConfirmed,
        };
        if (item.id.startsWith("tmp-")) {
          await supabase.from("product_testimonials").insert(row);
        } else {
          await supabase.from("product_testimonials").update(row).eq("id", item.id);
        }
      }

      const { error } = await supabase
        .from("products")
        .update({
          checkout_desktop_config: configs.desktop,
          checkout_mobile_config: configs.mobile,
          checkout_enabled: checkoutEnabled,
        })
        .eq("id", product.id);
      if (error) throw error;
      toast.success(t("checkoutEditor.saved"));
      onClose();
    } catch {
      toast.error(t("checkoutEditor.saveError"));
    } finally {
      setSaving(false);
    }
  }

  const style = useMemo(
    () =>
      ({
        "--cc-primary": config.primaryColor,
        "--cc-secondary": config.secondaryColor,
        "--cc-bg": config.backgroundColor,
        "--cc-text": config.textColor,
        "--cc-button": config.buttonColor,
        "--cc-button-text": config.buttonTextColor,
      }) as React.CSSProperties,
    [config],
  );

  return (
    <div className="fixed inset-0 z-[60] flex justify-center bg-foreground/50">
      <div className="mt-6 flex w-full max-w-[30rem] flex-col overflow-hidden rounded-t-3xl bg-background">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-foreground">
              {t("checkoutEditor.title")}
            </h2>
            <p className="truncate text-xs text-muted-foreground">{product.name}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("checkoutEditor.close")}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/60 p-1">
            {(["desktop", "mobile"] as Device[]).map((d) => (
              <button
                key={d}
                onClick={() => setDevice(d)}
                className={`rounded-lg py-2 text-sm font-semibold ${
                  device === d ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                {t(`checkoutEditor.tabs.${d}`)}
              </button>
            ))}
          </div>

          <Toggle
            label={t("checkoutEditor.enable")}
            checked={checkoutEnabled}
            onChange={setCheckoutEnabled}
          />

          {/* Pré-visualização em largura real */}
          <section className="rounded-2xl border border-border p-3">
            <p className="mb-3 text-xs font-semibold text-muted-foreground">
              {t("checkoutEditor.preview.title")}
            </p>
            <div className="mx-auto overflow-hidden rounded-xl border border-border" style={style}>
              <div
                className="mx-auto"
                style={{
                  width: BANNER_SIZE[device].width,
                  maxWidth: "100%",
                  background: "var(--cc-bg)",
                  color: "var(--cc-text)",
                }}
              >
                {config.banner.imageUrl && (
                  <img
                    src={config.banner.imageUrl}
                    alt=""
                    className="w-full object-cover"
                    style={{
                      aspectRatio: `${BANNER_SIZE[device].width} / ${BANNER_SIZE[device].height}`,
                      objectPosition: config.banner.objectPosition,
                    }}
                  />
                )}
                <div className="space-y-2 p-3">
                  {config.logoUrl && (
                    <img src={config.logoUrl} alt="" className="size-10 rounded-full object-cover" />
                  )}
                  <p className="text-sm font-bold">{config.productInfo.name || product.name}</p>
                  <p className="text-xs opacity-80">
                    {config.productInfo.description || product.description || storeName}
                  </p>
                  {config.countdown.enabled && (
                    <div
                      className={`rounded-lg px-2 py-1 text-center text-xs ${
                        countdown.expired ? "opacity-60" : ""
                      }`}
                      style={{
                        background: config.countdown.backgroundColor,
                        color: config.countdown.textColor,
                      }}
                    >
                      {config.countdown.message}:{" "}
                      <strong style={{ color: config.countdown.numberColor }}>
                        {String(countdown.hours).padStart(2, "0")}:
                        {String(countdown.minutes).padStart(2, "0")}:
                        {String(countdown.seconds).padStart(2, "0")}
                      </strong>
                    </div>
                  )}
                  {config.guarantee.enabled && (
                    <p className="rounded-lg px-2 py-1 text-center text-xs" style={{ color: config.guarantee.color }}>
                      🛡 {config.guarantee.text} · {config.guarantee.days} {t("checkoutEditor.guarantee.days").toLowerCase()}
                    </p>
                  )}
                  <div
                    className={`text-center font-semibold ${
                      config.buttonSize === "lg" ? "py-4 text-base" : config.buttonSize === "sm" ? "py-1.5 text-xs" : "py-2.5 text-sm"
                    } ${
                      config.buttonStyle === "outline"
                        ? "border bg-transparent"
                        : config.buttonStyle === "rounded"
                          ? "rounded-full"
                          : "rounded-lg"
                    } ${config.borderStyle === "strong" ? "border-2" : config.borderStyle === "soft" ? "border" : ""}`}
                    style={{
                      background: config.buttonStyle === "outline" ? "transparent" : "var(--cc-button)",
                      color: config.buttonStyle === "outline" ? "var(--cc-button)" : "var(--cc-button-text)",
                      borderColor: "var(--cc-button)",
                    }}
                  >
                    {config.buttonText}
                  </div>
                  {config.testimonialsEnabled &&
                    testimonials.filter((x) => x.truthConfirmed).map((item) => (
                      <div key={item.id} className="rounded-lg bg-muted/60 p-2 text-xs">
                        <div className="flex gap-0.5 text-amber-500">
                          {Array.from({ length: item.stars }, (_, i) => (
                            <Star key={i} className="size-3 fill-current" />
                          ))}
                        </div>
                        <p>{item.content}</p>
                        <p className="opacity-70">— {item.customerName}</p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </section>

          <Section title={t("checkoutEditor.identity.title")}>
            <div className="grid grid-cols-2 gap-3">
              <ColorField label={t("checkoutEditor.identity.primary")} value={config.primaryColor} onChange={(v) => update({ primaryColor: v })} />
              <ColorField label={t("checkoutEditor.identity.secondary")} value={config.secondaryColor} onChange={(v) => update({ secondaryColor: v })} />
              <ColorField label={t("checkoutEditor.identity.background")} value={config.backgroundColor} onChange={(v) => update({ backgroundColor: v })} />
              <ColorField label={t("checkoutEditor.identity.text")} value={config.textColor} onChange={(v) => update({ textColor: v })} />
              <ColorField label={t("checkoutEditor.identity.buttonColor")} value={config.buttonColor} onChange={(v) => update({ buttonColor: v })} />
              <ColorField label={t("checkoutEditor.identity.buttonTextColor")} value={config.buttonTextColor} onChange={(v) => update({ buttonTextColor: v })} />
            </div>
            <label className="mt-3 block text-xs font-semibold text-foreground">
              {t("checkoutEditor.identity.border")}
              <select
                value={config.borderStyle}
                onChange={(e) => update({ borderStyle: e.target.value as CheckoutConfig["borderStyle"] })}
                className="input-base mt-1"
              >
                {(["none", "soft", "strong"] as const).map((v) => (
                  <option key={v} value={v}>{t(`checkoutEditor.identity.borders.${v}`)}</option>
                ))}
              </select>
            </label>
          </Section>

          <Section title={t("checkoutEditor.banner.title")}>
            <p className="text-xs font-semibold text-primary">
              {device === "desktop"
                ? t("checkoutEditor.banner.desktopSize")
                : t("checkoutEditor.banner.mobileSize")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("checkoutEditor.banner.ratio")} · {t("checkoutEditor.banner.formats")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">{t("checkoutEditor.banner.hint")}</p>
            <input
              ref={bannerInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void handleBanner(e.target.files?.[0])}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => bannerInput.current?.click()}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-sm font-semibold text-muted-foreground disabled:opacity-60"
            >
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
              {config.banner.imageUrl
                ? t("checkoutEditor.banner.replace")
                : t("checkoutEditor.banner.choose")}
            </button>
            {bannerWarning && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {t("checkoutEditor.banner.aspectWarn")}
              </p>
            )}
            {config.banner.imageUrl && (
              <div className="mt-2 flex items-center gap-2">
                <img src={config.banner.imageUrl} alt="" className="size-12 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => update({ banner: { ...config.banner, imageUrl: null } })}
                  className="ml-auto flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-destructive"
                >
                  <Trash2 className="size-3" /> {t("checkoutEditor.banner.remove")}
                </button>
              </div>
            )}
            <label className="mt-3 block text-xs font-semibold text-foreground">
              {t("checkoutEditor.banner.targetLabel")}
              <input
                type="range"
                min="0"
                max="100"
                value={parseInt(config.banner.objectPosition) || 50}
                onChange={(e) =>
                  update({ banner: { ...config.banner, objectPosition: `${e.target.value}% 50%` } })
                }
                className="mt-1 w-full"
              />
            </label>
          </Section>

          <Section title={t("checkoutEditor.countdown.title")}>
            <Toggle label={t("checkoutEditor.countdown.enabled")} checked={config.countdown.enabled} onChange={toggleCountdown} />
            {config.countdown.enabled && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <ColorField label={t("checkoutEditor.countdown.numberColor")} value={config.countdown.numberColor} onChange={(v) => update({ countdown: { ...config.countdown, numberColor: v } })} />
                  <ColorField label={t("checkoutEditor.countdown.backgroundColor")} value={config.countdown.backgroundColor} onChange={(v) => update({ countdown: { ...config.countdown, backgroundColor: v } })} />
                  <ColorField label={t("checkoutEditor.countdown.textColor")} value={config.countdown.textColor} onChange={(v) => update({ countdown: { ...config.countdown, textColor: v } })} />
                </div>
                <input
                  placeholder={t("checkoutEditor.countdown.message")}
                  value={config.countdown.message}
                  onChange={(e) => update({ countdown: { ...config.countdown, message: e.target.value } })}
                  className="input-base"
                />
                <p className="text-xs text-muted-foreground">{t("checkoutEditor.countdown.note")}</p>
              </div>
            )}
          </Section>

          <Section title={t("checkoutEditor.guarantee.title")}>
            <Toggle label={t("checkoutEditor.guarantee.enabled")} checked={config.guarantee.enabled} onChange={(v) => update({ guarantee: { ...config.guarantee, enabled: v } })} />
            {config.guarantee.enabled && (
              <div className="mt-3 space-y-3">
                <select
                  value={config.guarantee.model}
                  onChange={(e) => update({ guarantee: { ...config.guarantee, model: e.target.value as CheckoutConfig["guarantee"]["model"] } })}
                  className="input-base"
                >
                  {(["shield", "badge", "seal"] as const).map((v) => (
                    <option key={v} value={v}>{t(`checkoutEditor.guarantee.models.${v}`)}</option>
                  ))}
                </select>
                <ColorField label={t("checkoutEditor.guarantee.color")} value={config.guarantee.color} onChange={(v) => update({ guarantee: { ...config.guarantee, color: v } })} />
                <input
                  placeholder={t("checkoutEditor.guarantee.text")}
                  value={config.guarantee.text}
                  onChange={(e) => update({ guarantee: { ...config.guarantee, text: e.target.value } })}
                  className="input-base"
                />
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={config.guarantee.days}
                  onChange={(e) => update({ guarantee: { ...config.guarantee, days: Math.max(1, Number(e.target.value) || 1) } })}
                  className="input-base"
                  placeholder={t("checkoutEditor.guarantee.days")}
                />
                <p className="text-xs text-muted-foreground">{t("checkoutEditor.guarantee.note")}</p>
              </div>
            )}
          </Section>

          <Section title={t("checkoutEditor.testimonials.title")}>
            <Toggle label={t("checkoutEditor.testimonials.enabled")} checked={config.testimonialsEnabled} onChange={(v) => update({ testimonialsEnabled: v })} />
            <p className="mt-2 text-xs text-muted-foreground">{t("checkoutEditor.testimonials.note")}</p>
            {config.testimonialsEnabled && (
              <div className="mt-3 space-y-3">
                {testimonials.map((item) => (
                  <div key={item.id} className="space-y-2 rounded-xl border border-border p-3">
                    <input
                      placeholder={t("checkoutEditor.testimonials.name")}
                      value={item.customerName}
                      onChange={(e) => patchTestimonial(item.id, { customerName: e.target.value })}
                      className="input-base py-2 text-sm"
                    />
                    <textarea
                      rows={2}
                      placeholder={t("checkoutEditor.testimonials.text")}
                      value={item.content}
                      onChange={(e) => patchTestimonial(item.id, { content: e.target.value })}
                      className="input-base resize-none py-2 text-sm"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{t("checkoutEditor.testimonials.stars")}</span>
                      <select
                        value={item.stars}
                        onChange={(e) => patchTestimonial(item.id, { stars: Number(e.target.value) })}
                        className="input-base w-16 py-1.5 text-sm"
                      >
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <button
                        type="button"
                        aria-label={t("checkoutEditor.testimonials.remove")}
                        onClick={() => {
                          setTestimonials((prev) => prev.filter((x) => x.id !== item.id));
                          if (!item.id.startsWith("tmp-")) setDeletedTestimonials((prev) => [...prev, item.id]);
                        }}
                        className="ml-auto grid size-8 place-items-center rounded-lg border border-border text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    <label className="flex items-start gap-2 text-xs text-foreground">
                      <input
                        type="checkbox"
                        checked={item.truthConfirmed}
                        onChange={(e) => patchTestimonial(item.id, { truthConfirmed: e.target.checked })}
                        className="mt-0.5 size-4"
                      />
                      {t("checkoutEditor.testimonials.truth")}
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addTestimonial}
                  className="w-full rounded-xl border border-dashed border-border py-2.5 text-sm font-semibold text-muted-foreground"
                >
                  + {t("checkoutEditor.testimonials.add")}
                </button>
              </div>
            )}
          </Section>

          <Section title={t("checkoutEditor.productInfo.title")}>
            <div className="space-y-3">
              <input placeholder={t("checkoutEditor.productInfo.name")} value={config.productInfo.name} onChange={(e) => update({ productInfo: { ...config.productInfo, name: e.target.value } })} className="input-base" />
              <textarea rows={2} placeholder={t("checkoutEditor.productInfo.description")} value={config.productInfo.description} onChange={(e) => update({ productInfo: { ...config.productInfo, description: e.target.value } })} className="input-base resize-none" />
              <textarea rows={2} placeholder={t("checkoutEditor.productInfo.benefits")} value={config.benefits} onChange={(e) => update({ benefits: e.target.value })} className="input-base resize-none" />
              <textarea rows={2} placeholder={t("checkoutEditor.productInfo.included")} value={config.included} onChange={(e) => update({ included: e.target.value })} className="input-base resize-none" />
              <input placeholder={t("checkoutEditor.productInfo.price")} value={config.productInfo.price} onChange={(e) => update({ productInfo: { ...config.productInfo, price: e.target.value } })} className="input-base" />
              <input placeholder={t("checkoutEditor.productInfo.conditions")} value={config.conditions} onChange={(e) => update({ conditions: e.target.value })} className="input-base" />
              <textarea rows={2} placeholder={t("checkoutEditor.productInfo.additional")} value={config.productInfo.additional} onChange={(e) => update({ productInfo: { ...config.productInfo, additional: e.target.value } })} className="input-base resize-none" />
              <p className="text-xs text-muted-foreground">{currency}</p>
            </div>
          </Section>

          <Section title={t("checkoutEditor.button.title")}>
            <input placeholder={t("checkoutEditor.button.text")} value={config.buttonText} onChange={(e) => update({ buttonText: e.target.value })} className="input-base" />
            <div className="mt-3 grid grid-cols-3 gap-2">
              <SelectField label={t("checkoutEditor.button.size")} value={config.buttonSize} options={["sm", "md", "lg"]} labels={(v) => t(`checkoutEditor.button.sizes.${v}` as MessageKey)} onChange={(v) => update({ buttonSize: v as CheckoutConfig["buttonSize"] })} />
              <SelectField label={t("checkoutEditor.button.style")} value={config.buttonStyle} options={["solid", "outline", "rounded"]} labels={(v) => t(`checkoutEditor.button.styles.${v}` as MessageKey)} onChange={(v) => update({ buttonStyle: v as CheckoutConfig["buttonStyle"] })} />
              <SelectField label={t("checkoutEditor.button.position")} value={config.buttonPosition} options={["top", "bottom"]} labels={(v) => t(`checkoutEditor.button.positions.${v}` as MessageKey)} onChange={(v) => update({ buttonPosition: v as CheckoutConfig["buttonPosition"] })} />
            </div>
          </Section>

          <div className="space-y-2 rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <button
              type="button"
              onClick={copyDesktopToMobile}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground"
            >
              <ArrowLeftRight className="size-4" />
              {t("checkoutEditor.copy.title")}
            </button>
            {undoSnapshot && (
              <button
                type="button"
                onClick={undoCopy}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground"
              >
                <Undo2 className="size-4" /> {t("checkoutEditor.copy.undo")}
              </button>
            )}
          </div>
        </div>

        <footer className="border-t border-border p-4">
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {saving ? t("checkoutEditor.saving") : t("checkoutEditor.save")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function useTick(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border p-4">
      <h3 className="mb-3 text-sm font-bold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs font-semibold text-foreground">
      {label}
      <span className="mt-1 flex items-center gap-2 rounded-lg border border-border p-1.5">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-7 cursor-pointer border-0 bg-transparent p-0" />
        <span className="truncate font-mono text-xs text-muted-foreground">{value}</span>
      </span>
    </label>
  );
}

function SelectField({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels: (v: string) => string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs font-semibold text-foreground">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-base mt-1 py-2 text-xs">
        {options.map((v) => <option key={v} value={v}>{labels(v)}</option>)}
      </select>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-2xl border border-border px-4 py-3"
    >
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-primary" : "bg-muted"}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-card transition-all ${checked ? "left-[1.375rem]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
