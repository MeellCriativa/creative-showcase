import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Loader2,
  Trash2,
  ChevronUp,
  ChevronDown,
  Plus,
  ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { CartIcon, CART_STYLES } from "@/components/CartIcons";
import { EyedropperColorInput } from "@/components/EyedropperColorInput";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import {
  slugify,
  FONT_OPTIONS,
  getFontFamily,
  PAYMENT_METHODS,
  DELIVERY_METHODS,
  formatCep,
} from "@/lib/catalog";
import { formatMoney, getCurrency, resolveStoreCurrency } from "@/lib/currency";
import { IMAGE_WIDTHS, imageFallback, optimizedImageUrl } from "@/lib/imageUrls";
import type { Banner } from "@/lib/catalog";
import { EmptyCatalog } from "./painel.categorias";

export const Route = createFileRoute("/painel/personalizar")({
  component: PersonalizarPage,
});

const palettes = [
  { primary: "#8b5cf6", accent: "#f3eefc", labelKey: "customize.colors.lilac" },
  { primary: "#d1477a", accent: "#fdf2f6", labelKey: "customize.colors.pink" },
  { primary: "#b45309", accent: "#fef3c7", labelKey: "customize.colors.amber" },
  { primary: "#0f766e", accent: "#ccfbf1", labelKey: "customize.colors.green" },
  { primary: "#4338ca", accent: "#e0e7ff", labelKey: "customize.colors.indigo" },
  { primary: "#1f2937", accent: "#f3f4f6", labelKey: "customize.colors.graphite" },
  { primary: "#be123c", accent: "#ffe4e6", labelKey: "customize.colors.red" },
] as const;

/** Chaves de tradução das opções fixas de `@/lib/catalog` e `CartIcons`. */
const FONT_LABEL_KEYS = {
  moderna: "customize.fonts.modern",
  manuscrita: "customize.fonts.handwritten",
  delicada: "customize.fonts.delicate",
  elegante: "customize.fonts.elegant",
  minimalista: "customize.fonts.minimalist",
  arredondada: "customize.fonts.rounded",
  serifada: "customize.fonts.serif",
  divertida: "customize.fonts.playful",
} as const;

const PAYMENT_LABEL_KEYS = {
  pix: "customize.payments.pix",
  credit_card: "customize.payments.credit",
  debit_card: "customize.payments.debit",
  pix_auto: "customize.payments.pixAuto",
  cash: "customize.payments.cash",
} as const;

const DELIVERY_LABEL_KEYS = {
  local_pickup: "customize.delivery.localPickup",
  local_delivery: "customize.delivery.localDelivery",
  melhor_envio: "customize.delivery.melhorEnvio",
} as const;

const CART_LABEL_KEYS = {
  carrinho: "customize.cartStyles.cart",
  sacola: "customize.cartStyles.bag",
  sacola_coracao: "customize.cartStyles.bagHeart",
  carrinho_coracao: "customize.cartStyles.cartHeart",
  minimalista: "customize.cartStyles.minimal",
  kawaii: "customize.cartStyles.kawaii",
} as const;

const WHATSAPP_BUTTON_COLORS = [
  { color: "#8b5cf6", labelKey: "customize.colors.lilac" },
  { color: "#25d366", labelKey: "customize.colors.green" },
  { color: "#128C7E", labelKey: "customize.colors.darkGreen" },
  { color: "#d1477a", labelKey: "customize.colors.pink" },
  { color: "#1f2937", labelKey: "customize.colors.graphite" },
] as const;

function PersonalizarPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: catalog } = useMyCatalog(user?.id);

  const [storeName, setStoreName] = useState("");
  const [slug, setSlug] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [logo, setLogo] = useState<string[]>([]);
  const [cover, setCover] = useState<string[]>([]);
  const [primary, setPrimary] = useState("#8b5cf6");
  const [accent, setAccent] = useState("#f3eefc");
  const [backgroundColor, setBackgroundColor] = useState("#FFFFFF");
  const [storeFont, setStoreFont] = useState("moderna");
  const [logoSize, setLogoSize] = useState("medio");
  const [logoPosition, setLogoPosition] = useState("esquerda");
  const [cartStyle, setCartStyle] = useState("carrinho");
  const [whatsappButtonColor, setWhatsappButtonColor] = useState("#8b5cf6");
  const [banners, setBanners] = useState<Banner[]>([]);
  const [bannerEnabled, setBannerEnabled] = useState(false);
  const [bannerAutoplay, setBannerAutoplay] = useState(true);
  const [bannerInterval, setBannerInterval] = useState(4);
  const [bannerIndicators, setBannerIndicators] = useState(true);
  const [saving, setSaving] = useState(false);
  const [storeDescription, setStoreDescription] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [deliveryMethods, setDeliveryMethods] = useState<string[]>([]);
  const [shippingOriginZip, setShippingOriginZip] = useState("");
  const [ownerPhotoUrl, setOwnerPhotoUrl] = useState<string[]>([]);
  const [ownerName, setOwnerName] = useState("");
  const [ownerBio, setOwnerBio] = useState("");
  const [ownerHours, setOwnerHours] = useState("");
  const [currency, setCurrency] = useState("BRL");

  useEffect(() => {
    if (!catalog) return;
    setStoreName(catalog.store_name);
    setSlug(catalog.slug);
    setWhatsapp(catalog.whatsapp ?? "");
    setLogo(catalog.logo_url ? [catalog.logo_url] : []);
    setCover(catalog.cover_url ? [catalog.cover_url] : []);
    setPrimary(catalog.primary_color ?? "#8b5cf6");
    setAccent(catalog.accent_color ?? "#f3eefc");
    setBackgroundColor(catalog.background_color ?? "#FFFFFF");
    setStoreFont(catalog.store_font ?? "moderna");
    setLogoSize(catalog.logo_size ?? "medio");
    setLogoPosition(catalog.logo_position ?? "esquerda");
    setCartStyle(catalog.cart_style ?? "carrinho");
    setWhatsappButtonColor(catalog.whatsapp_button_color ?? "#8b5cf6");
    setBannerEnabled(catalog.banner_enabled ?? false);
    setBannerAutoplay(catalog.banner_autoplay ?? true);
    setBannerInterval(catalog.banner_interval ?? 4);
    setBannerIndicators(catalog.banner_indicators ?? true);
    setStoreDescription(catalog.store_description ?? "");
    setInstagramUrl(catalog.instagram_url ?? "");
    setPaymentMethods(
      Array.isArray(catalog.payment_methods) ? (catalog.payment_methods as string[]) : [],
    );
    setDeliveryMethods(
      Array.isArray(catalog.delivery_methods) ? (catalog.delivery_methods as string[]) : [],
    );
    setShippingOriginZip(catalog.shipping_origin_zip ?? "");
    setOwnerPhotoUrl(catalog.owner_photo_url ? [catalog.owner_photo_url] : []);
    setOwnerName(catalog.owner_name ?? "");
    setOwnerBio(catalog.owner_bio ?? "");
    setOwnerHours(catalog.owner_hours ?? "");
    setCurrency(resolveStoreCurrency(catalog.currency));

    (async () => {
      const { data } = await supabase
        .from("banners")
        .select("*")
        .eq("catalog_id", catalog.id)
        .order("position");
      if (data) setBanners(data as Banner[]);
    })();
  }, [catalog]);

  if (!catalog || !user) return <EmptyCatalog />;

  const logoSizePx =
    logoSize === "pequena" ? "size-12" : logoSize === "grande" ? "size-36" : "size-16";

  function addBanner(url: string) {
    setBanners((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        catalog_id: catalog!.id,
        image_url: url,
        href: null,
        position: prev.length,
        object_position: "50%",
      },
    ]);
  }

  function removeBanner(idx: number) {
    setBanners((prev) => prev.filter((_, i) => i !== idx).map((b, i) => ({ ...b, position: i })));
  }

  function moveBanner(idx: number, dir: -1 | 1) {
    setBanners((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      const a = next[idx];
      const b = next[target];
      if (!a || !b) return prev;
      [next[idx], next[target]] = [b, a];
      return next.map((item, i) => ({ ...item, position: i }));
    });
  }

  function updateBannerHref(idx: number, href: string) {
    setBanners((prev) => prev.map((b, i) => (i === idx ? { ...b, href: href || null } : b)));
  }

  function updateBannerPosition(idx: number, objectPosition: string) {
    setBanners((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, object_position: objectPosition } : b)),
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const payload = {
      store_name: storeName.trim() || catalog!.store_name,
      slug: slugify(slug) || catalog!.slug,
      whatsapp: whatsapp.trim() || null,
      logo_url: logo[0] || null,
      cover_url: cover[0] || null,
      primary_color: primary || "#8b5cf6",
      accent_color: accent || "#f3eefc",
      background_color: backgroundColor || "#FFFFFF",
      store_font: storeFont || "moderna",
      logo_size: logoSize || "medio",
      logo_position: logoPosition || "esquerda",
      cart_style: cartStyle || "carrinho",
      whatsapp_button_color: whatsappButtonColor || "#8b5cf6",
      banner_enabled: bannerEnabled,
      banner_autoplay: bannerAutoplay,
      banner_interval: bannerInterval,
      banner_indicators: bannerIndicators,
      store_description: storeDescription.trim() || null,
      instagram_url: instagramUrl.trim() || null,
      payment_methods: paymentMethods.length > 0 ? paymentMethods : [],
      delivery_methods: deliveryMethods.length > 0 ? deliveryMethods : [],
      shipping_origin_zip: shippingOriginZip ? shippingOriginZip.replace(/\D/g, "") : null,
      owner_photo_url: ownerPhotoUrl[0] || null,
      owner_name: ownerName.trim() || null,
      owner_bio: ownerBio.trim() || null,
      owner_hours: ownerHours.trim() || null,
      currency: resolveStoreCurrency(currency),
    };

    const { error: catalogError } = await supabase
      .from("catalogs")
      .update(payload as any)
      .eq("id", catalog!.id);

    if (catalogError) {
      setSaving(false);
      console.error("[Vitrine Criativa] Catalog save error:", catalogError);
      if (catalogError.code === "23505") {
        toast.error(t("customize.errors.slugInUse"));
      } else if (catalogError.message?.includes("currency")) {
        toast.error(t("customize.errors.currencyColumnMissing"));
      } else if (catalogError.message?.includes("column")) {
        toast.error(t("customize.errors.databaseConfig"));
      } else {
        toast.error(
          t("customize.errors.saveFailed", {
            message: catalogError.message ?? t("customize.errors.tryAgain"),
          }),
        );
      }
      return;
    }

    const { data: currentBanners } = await supabase
      .from("banners")
      .select("id")
      .eq("catalog_id", catalog!.id);

    const currentIds = new Set((currentBanners ?? []).map((b) => b.id));
    const keptIds = new Set(banners.filter((b) => !b.id.startsWith("new-")).map((b) => b.id));
    const toDelete = [...currentIds].filter((id) => !keptIds.has(id));

    if (toDelete.length > 0) {
      const { error: deleteError } = await supabase.from("banners").delete().in("id", toDelete);
      if (deleteError) {
        setSaving(false);
        toast.error(t("customize.errors.bannerUpdateFailed"));
        return;
      }
    }

    const newBanners = banners.filter((b) => b.id.startsWith("new-"));
    const existingBanners = banners.filter((b) => !b.id.startsWith("new-"));

    if (newBanners.length > 0) {
      const { error: insertError } = await supabase.from("banners").insert(
        newBanners.map((b) => ({
          catalog_id: catalog!.id,
          image_url: b.image_url,
          href: b.href || null,
          position: b.position,
          object_position: b.object_position || "center",
        })),
      );
      if (insertError) {
        setSaving(false);
        console.error("[Vitrine Criativa] Banner insert error:", insertError);
        toast.error(t("customize.errors.bannerSaveFailed"));
        return;
      }
    }

    if (existingBanners.length > 0) {
      const { error: updateError } = await supabase.from("banners").upsert(
        existingBanners.map((b) => ({
          id: b.id,
          catalog_id: catalog!.id,
          image_url: b.image_url,
          href: b.href || null,
          position: b.position,
          object_position: b.object_position || "center",
        })),
        { onConflict: "id" },
      );
      if (updateError) {
        setSaving(false);
        console.error("[Vitrine Criativa] Banner update error:", updateError);
        toast.error(t("customize.errors.bannerUpdateFailed"));
        return;
      }
    }

    setSaving(false);
    toast.success(t("customize.toasts.saved"));
    void queryClient.invalidateQueries({ queryKey: ["my-catalog"] });
  }

  return (
    <form onSubmit={save} className="px-5 pb-10 pt-10">
      <h1 className="text-2xl font-bold text-foreground">{t("customize.title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("customize.subtitle")}</p>

      {/* ── Pré-visualização ── */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div
          className="relative h-20 w-full overflow-hidden"
          style={{ background: accent ?? "#f3eefc" }}
        >
          {cover[0] ? (
            <img
              src={optimizedImageUrl(cover[0], IMAGE_WIDTHS.card) ?? cover[0]}
              alt={t("customize.coverAlt")}
              loading="lazy"
              onError={imageFallback(cover[0])}
              className="h-full w-full object-cover"
            />
          ) : (
            <div
              className="h-full w-full"
              style={{ background: primary ?? "#8b5cf6", opacity: 0.15 }}
            />
          )}
          <div
            className="absolute inset-x-0 bottom-0 h-8"
            style={{ background: `linear-gradient(to top, ${accent ?? "#f3eefc"}, transparent)` }}
          />
        </div>

        <div
          className="relative flex items-end gap-3 px-4 pb-4 -mt-5"
          style={{
            justifyContent:
              logoPosition === "centro"
                ? "center"
                : logoPosition === "direita"
                  ? "flex-end"
                  : "flex-start",
          }}
        >
          {logo[0] ? (
            <img
              src={optimizedImageUrl(logo[0], IMAGE_WIDTHS.thumb) ?? logo[0]}
              alt={t("customize.logoAlt")}
              loading="eager"
              onError={imageFallback(logo[0])}
              className={`${logoSizePx} shrink-0 rounded-full border-2 object-cover shadow-md`}
              style={{ borderColor: primary ?? "#8b5cf6" }}
            />
          ) : (
            <div
              className={`${logoSizePx} shrink-0 rounded-full border-2 border-dashed flex items-center justify-center text-[10px] text-muted-foreground`}
              style={{ borderColor: primary ?? "#8b5cf6" }}
            >
              {t("customize.logoPlaceholder")}
            </div>
          )}
        </div>

        <div className="px-4 pb-4">
          <p
            className="text-lg font-bold leading-tight text-foreground"
            style={{ fontFamily: getFontFamily(storeFont), color: primary ?? "#8b5cf6" }}
          >
            {storeName || t("customize.fields.storeName")}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <CartIcon style={cartStyle} className="size-5" color={primary ?? "#8b5cf6"} />
            <span className="text-xs text-muted-foreground">{t("customize.cartLabel")}</span>
          </div>
        </div>

        {bannerEnabled && banners.length > 0 && (
          <div className="border-t border-border px-4 py-2">
            <BannerPreviewCarousel banners={banners} color={primary} />
          </div>
        )}
      </div>

      {/* ── Dados da Loja ── */}
      <Field label={t("customize.fields.storeName")}>
        <input
          required
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          className="input-base"
        />
      </Field>

      <Field label={t("customize.fields.slug")} hint={`/c/${slugify(slug) || catalog.slug}`}>
        <input value={slug} onChange={(e) => setSlug(e.target.value)} className="input-base" />
      </Field>

      <Field label={t("customize.fields.whatsapp")} hint={t("customize.hints.whatsapp")}>
        <input
          inputMode="numeric"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="11988887777"
          className="input-base"
        />
      </Field>

      {/* ── Moeda principal da loja ── */}
      <Field label={t("customize.fields.currency")} hint={t("customize.hints.currency")}>
        <CurrencyPicker value={currency} onChange={setCurrency} />
        <div className="mt-3 rounded-xl bg-accent/60 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-foreground">
            {t("customize.currency.example", {
              money: formatMoney(202.4, currency),
              code: getCurrency(currency).code,
              name: getCurrency(currency).name,
            })}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {t("customize.currency.notePrefix")}{" "}
            <strong>{t("customize.currency.noteStrong")}</strong>{" "}
            {t("customize.currency.noteSuffix")}
          </p>
          <Link
            to="/painel/conversor"
            className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary"
          >
            <ArrowLeftRight className="size-3.5" />
            {t("customize.currency.openConverter")}
          </Link>
        </div>
      </Field>

      <Field label={t("customize.fields.logo")}>
        <ImageUploader
          userId={user.id}
          value={logo}
          onChange={setLogo}
          max={1}
          shape="circle"
          label={t("customize.uploads.logo")}
        />
      </Field>

      <Field label={t("customize.fields.cover")}>
        <ImageUploader
          userId={user.id}
          value={cover}
          onChange={setCover}
          max={1}
          shape="wide"
          label={t("customize.uploads.cover")}
        />
      </Field>

      <Field label={t("customize.fields.colors")}>
        <div className="grid grid-cols-3 gap-2">
          {palettes.map((p) => {
            const active = p.primary === primary;
            return (
              <button
                type="button"
                key={p.primary}
                onClick={() => {
                  setPrimary(p.primary);
                  setAccent(p.accent);
                }}
                className={`rounded-2xl border p-3 text-xs font-semibold ${
                  active ? "border-primary" : "border-border"
                }`}
              >
                <span
                  className="mb-2 block h-6 w-full rounded-lg"
                  style={{ background: p.primary }}
                />
                {t(p.labelKey)}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <label className="flex items-center gap-2">
            {t("customize.colors.primary")}
            <EyedropperColorInput
              value={primary}
              onChange={setPrimary}
              label={t("customize.colors.primary")}
            />
          </label>
          <label className="flex items-center gap-2">
            {t("customize.colors.accent")}
            <EyedropperColorInput
              value={accent}
              onChange={setAccent}
              label={t("customize.colors.accent")}
            />
          </label>
          <label className="flex items-center gap-2">
            {t("customize.colors.background")}
            <EyedropperColorInput
              value={backgroundColor}
              onChange={setBackgroundColor}
              label={t("customize.colors.background")}
            />
          </label>
        </div>
      </Field>

      {/* ── Fonte do Nome da Loja ── */}
      <Field label={t("customize.fields.font")}>
        <div className="grid grid-cols-2 gap-2">
          {FONT_OPTIONS.map((f) => (
            <button
              type="button"
              key={f.key}
              onClick={() => setStoreFont(f.key)}
              className={`rounded-xl border p-3 text-left transition-colors ${
                storeFont === f.key ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <span className="block text-xs text-muted-foreground">
                {t(FONT_LABEL_KEYS[f.key])}
              </span>
              <span
                className="mt-1 block truncate text-base font-bold text-foreground"
                style={{ fontFamily: f.family }}
              >
                {storeName || t("customize.fontPreviewName")}
              </span>
            </button>
          ))}
        </div>
      </Field>

      {/* ── Tamanho da Logo ── */}
      <Field label={t("customize.fields.logoSize")}>
        <div className="flex gap-3">
          {(
            [
              { key: "pequena", labelKey: "customize.logoSize.small", cls: "size-12" },
              { key: "medio", labelKey: "customize.logoSize.medium", cls: "size-16" },
              { key: "grande", labelKey: "customize.logoSize.large", cls: "size-36" },
            ] as const
          ).map((opt) => (
            <button
              type="button"
              key={opt.key}
              onClick={() => setLogoSize(opt.key)}
              className={`flex flex-1 flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${
                logoSize === opt.key ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              {logo[0] ? (
                <img
                  src={optimizedImageUrl(logo[0], IMAGE_WIDTHS.thumb) ?? logo[0]}
                  alt={t("customize.logoAlt")}
                  loading="lazy"
                  onError={imageFallback(logo[0])}
                  className={`${opt.cls} rounded-full object-cover`}
                />
              ) : (
                <div
                  className={`${opt.cls} rounded-full border-2 border-dashed flex items-center justify-center text-[9px] text-muted-foreground`}
                >
                  {t("customize.logoPlaceholder")}
                </div>
              )}
              <span className="text-xs font-medium text-muted-foreground">{t(opt.labelKey)}</span>
            </button>
          ))}
        </div>
      </Field>

      {/* ── Posição da Logo ── */}
      <Field label={t("customize.fields.logoPosition")}>
        <div className="flex gap-3">
          {(
            [
              { key: "esquerda", labelKey: "customize.logoPosition.left" },
              { key: "centro", labelKey: "customize.logoPosition.center" },
              { key: "direita", labelKey: "customize.logoPosition.right" },
            ] as const
          ).map((opt) => (
            <button
              type="button"
              key={opt.key}
              onClick={() => setLogoPosition(opt.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl border p-3 transition-colors ${
                logoPosition === opt.key ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <div
                className="flex h-8 w-full items-center rounded bg-muted"
                style={{
                  justifyContent:
                    opt.key === "centro"
                      ? "center"
                      : opt.key === "direita"
                        ? "flex-end"
                        : "flex-start",
                  padding: "0 4px",
                }}
              >
                <div className="size-4 rounded-full" style={{ background: primary }} />
              </div>
              <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                {t(opt.labelKey)}
              </span>
            </button>
          ))}
        </div>
      </Field>

      {/* ── Estilo do Carrinho ── */}
      <Field label={t("customize.fields.cartIcon")}>
        <div className="grid grid-cols-3 gap-2">
          {CART_STYLES.map((c) => (
            <button
              type="button"
              key={c.key}
              onClick={() => setCartStyle(c.key)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${
                cartStyle === c.key ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <CartIcon style={c.key} className="size-8" color={primary ?? "#8b5cf6"} />
              <span className="text-[11px] font-medium leading-tight text-muted-foreground">
                {t(CART_LABEL_KEYS[c.key])}
              </span>
            </button>
          ))}
        </div>
      </Field>

      {/* ── Cor do botão flutuante WhatsApp ── */}
      <Field label={t("customize.fields.whatsappColor")} hint={t("customize.hints.whatsappColor")}>
        <div className="flex items-center gap-3">
          {WHATSAPP_BUTTON_COLORS.map((opt) => (
            <button
              type="button"
              key={opt.color}
              onClick={() => setWhatsappButtonColor(opt.color)}
              className={`flex flex-col items-center gap-1 rounded-xl border p-2 transition-colors ${
                whatsappButtonColor === opt.color ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <span
                className="size-7 rounded-full border border-white/30 shadow-sm"
                style={{ background: opt.color }}
              />
              <span className="text-[10px] font-medium text-muted-foreground">
                {t(opt.labelKey)}
              </span>
            </button>
          ))}
          <label className="flex flex-col items-center gap-1">
            <EyedropperColorInput
              value={whatsappButtonColor}
              onChange={setWhatsappButtonColor}
              label={t("customize.colors.custom")}
              round
            />
            <span className="text-[10px] font-medium text-muted-foreground">
              {t("customize.colors.custom")}
            </span>
          </label>
        </div>
      </Field>

      {/* ── Banner / Carrossel ── */}
      <Field label={t("customize.fields.banner")}>
        <div className="flex items-center gap-3">
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={bannerEnabled}
              onChange={(e) => setBannerEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <div className="h-6 w-11 rounded-full bg-muted peer-checked:bg-primary transition-colors after:absolute after:left-[2px] after:top-[2px] after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-full" />
          </label>
          <span className="text-sm text-muted-foreground">
            {bannerEnabled ? t("common.enabled") : t("common.disabled")}
          </span>
        </div>

        {bannerEnabled && (
          <div className="mt-4 space-y-4">
            {banners.map((b, idx) => (
              <div
                key={b.id}
                className="flex items-start gap-3 rounded-xl border border-border p-3"
              >
                <img
                  src={optimizedImageUrl(b.image_url, IMAGE_WIDTHS.thumb) ?? b.image_url}
                  alt={t("customize.banner.indexLabel", { index: idx + 1 })}
                  loading="lazy"
                  onError={imageFallback(b.image_url)}
                  className="size-16 shrink-0 rounded-lg object-cover"
                />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveBanner(idx, -1)}
                      aria-label={t("customize.banner.moveUp")}
                      className="rounded-lg border border-border p-1 text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === banners.length - 1}
                      onClick={() => moveBanner(idx, 1)}
                      aria-label={t("customize.banner.moveDown")}
                      className="rounded-lg border border-border p-1 text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBanner(idx)}
                      aria-label={t("customize.banner.remove")}
                      className="ml-auto rounded-lg border border-destructive/30 p-1 text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <input
                    value={b.href ?? ""}
                    onChange={(e) => updateBannerHref(idx, e.target.value)}
                    placeholder={t("customize.placeholders.bannerLink")}
                    className="input-base text-xs"
                  />
                  <BannerPositionEditor
                    imageUrl={b.image_url}
                    position={b.object_position ?? "50%"}
                    onChange={(pos) => updateBannerPosition(idx, pos)}
                  />
                </div>
              </div>
            ))}

            <ImageUploader
              userId={user.id}
              value={[]}
              onChange={(urls) => urls.forEach(addBanner)}
              max={1}
              shape="wide"
              label={t("customize.uploads.banner")}
            />

            <div className="space-y-3 rounded-xl border border-border p-4">
              <p className="text-xs font-semibold text-foreground">
                {t("customize.banner.settings")}
              </p>

              <label className="flex items-center gap-3 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={bannerAutoplay}
                  onChange={(e) => setBannerAutoplay(e.target.checked)}
                  className="size-4 rounded border-border"
                />
                {t("customize.banner.autoplay")}
              </label>

              <div className="text-sm text-muted-foreground">
                <p className="mb-1 text-xs font-medium">{t("customize.banner.interval")}</p>
                <div className="flex gap-2">
                  {[3, 4, 5, 6].map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => setBannerInterval(s)}
                      className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors ${
                        bannerInterval === s
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border"
                      }`}
                    >
                      {s}s
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-3 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={bannerIndicators}
                  onChange={(e) => setBannerIndicators(e.target.checked)}
                  className="size-4 rounded border-border"
                />
                {t("customize.banner.indicators")}
              </label>
            </div>
          </div>
        )}
      </Field>

      {/* ── Descrição da Loja ── */}
      <Field
        label={t("customize.fields.storeDescription")}
        hint={t("customize.hints.storeDescription")}
      >
        <textarea
          value={storeDescription}
          onChange={(e) => setStoreDescription(e.target.value)}
          placeholder={t("customize.placeholders.storeDescription")}
          rows={3}
          className="input-base resize-none"
        />
      </Field>

      {/* ── Link do Instagram ── */}
      <Field label={t("customize.fields.instagram")} hint={t("customize.hints.instagram")}>
        <input
          value={instagramUrl}
          onChange={(e) => setInstagramUrl(e.target.value)}
          placeholder={t("customize.placeholders.instagram")}
          className="input-base"
        />
      </Field>

      {/* ── Formas de pagamento ── */}
      <Field
        label={t("customize.fields.paymentMethods")}
        hint={t("customize.hints.paymentMethods")}
      >
        <div className="space-y-2">
          {PAYMENT_METHODS.map((m) => {
            const active = paymentMethods.includes(m.key);
            return (
              <label
                key={m.key}
                className={`flex items-center gap-3 rounded-xl border p-3 transition-colors cursor-pointer ${
                  active ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setPaymentMethods((prev) => [...prev, m.key]);
                    } else {
                      setPaymentMethods((prev) => prev.filter((k) => k !== m.key));
                    }
                  }}
                  className="size-4 rounded border-border"
                />
                <span className="text-sm font-medium text-foreground">
                  {t(PAYMENT_LABEL_KEYS[m.key])}
                </span>
              </label>
            );
          })}
        </div>
      </Field>

      {/* ── Formas de entrega ── */}
      <Field
        label={t("customize.fields.deliveryMethods")}
        hint={t("customize.hints.deliveryMethods")}
      >
        <div className="space-y-2">
          {DELIVERY_METHODS.map((m) => {
            const active = deliveryMethods.includes(m.key);
            return (
              <label
                key={m.key}
                className={`flex items-center gap-3 rounded-xl border p-3 transition-colors cursor-pointer ${
                  active ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setDeliveryMethods((prev) => [...prev, m.key]);
                    } else {
                      setDeliveryMethods((prev) => prev.filter((k) => k !== m.key));
                    }
                  }}
                  className="size-4 rounded border-border"
                />
                <span className="text-sm font-medium text-foreground">
                  {m.icon} {t(DELIVERY_LABEL_KEYS[m.key])}
                </span>
              </label>
            );
          })}
        </div>
        {deliveryMethods.includes("melhor_envio") && (
          <div className="mt-3">
            <p className="text-xs text-muted-foreground mb-1">
              {t("customize.delivery.originZip")}
            </p>
            <input
              inputMode="numeric"
              value={shippingOriginZip}
              onChange={(e) => setShippingOriginZip(formatCep(e.target.value))}
              placeholder="00000-000"
              maxLength={9}
              className="input-base"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t("customize.delivery.notePrefix")}{" "}
              <strong>{t("customize.delivery.noteStrong")}</strong>{" "}
              {t("customize.delivery.noteSuffix")}
            </p>
          </div>
        )}
      </Field>
      <Field label={t("customize.fields.about")} hint={t("customize.hints.about")}>
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("customize.about.photo")}</p>
            <ImageUploader
              userId={user.id}
              value={ownerPhotoUrl}
              onChange={setOwnerPhotoUrl}
              max={1}
              shape="circle"
              label={t("customize.about.photoLabel")}
            />
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("customize.about.name")}</p>
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder={t("customize.placeholders.ownerName")}
              className="input-base"
            />
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("customize.about.bio")}</p>
            <textarea
              value={ownerBio}
              onChange={(e) => setOwnerBio(e.target.value)}
              placeholder={t("customize.placeholders.ownerBio")}
              rows={3}
              className="input-base resize-none"
            />
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">{t("customize.about.hours")}</p>
            <textarea
              value={ownerHours}
              onChange={(e) => setOwnerHours(e.target.value)}
              placeholder={t("customize.placeholders.ownerHours")}
              rows={2}
              className="input-base resize-none"
            />
          </div>
        </div>
      </Field>

      {/* ── Botão Salvar ── */}
      <button
        type="submit"
        disabled={saving}
        className="mt-8 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground shadow-lg shadow-primary/25 disabled:opacity-60"
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        {t("customize.saveChanges")}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </div>
  );
}

function BannerPositionEditor({
  imageUrl,
  position,
  onChange,
}: {
  imageUrl: string;
  position: string;
  onChange: (pos: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const { t } = useI18n();

  const pct = Number((position ?? "50").replace("%", "")) || 50;

  function startY(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    setDragging(true);
    updateFromEvent(e);
  }

  function onMove(e: MouseEvent | TouchEvent) {
    if (!dragging) return;
    updateFromEvent(e);
  }

  function stopDrag() {
    setDragging(false);
  }

  function updateFromEvent(e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let clientY: number;
    if ("touches" in e) {
      clientY = e.touches[0]?.clientY ?? (e as TouchEvent).changedTouches[0]?.clientY ?? 0;
    } else {
      clientY = (e as MouseEvent).clientY;
    }
    const y = clientY - rect.top;
    const newPct = Math.round(Math.max(0, Math.min(100, (y / rect.height) * 100)));
    onChange(`${newPct}%`);
  }

  useEffect(() => {
    if (!dragging) return;
    const onM = (e: MouseEvent | TouchEvent) => onMove(e);
    const onU = () => stopDrag();
    window.addEventListener("mousemove", onM);
    window.addEventListener("mouseup", onU);
    window.addEventListener("touchmove", onM, { passive: false });
    window.addEventListener("touchend", onU);
    return () => {
      window.removeEventListener("mousemove", onM);
      window.removeEventListener("mouseup", onU);
      window.removeEventListener("touchmove", onM);
      window.removeEventListener("touchend", onU);
    };
  }, [dragging]);

  return (
    <div>
      <p className="text-[10px] text-muted-foreground mb-1">
        {t("customize.banner.dragHint", { percent: pct })}
      </p>
      <div
        ref={containerRef}
        onMouseDown={startY}
        onTouchStart={startY}
        className="relative h-24 w-full cursor-grab overflow-hidden rounded-lg border border-border active:cursor-grabbing"
        style={{ touchAction: "none" }}
      >
        <img
          src={optimizedImageUrl(imageUrl, IMAGE_WIDTHS.card) ?? imageUrl}
          alt={t("customize.banner.imageAlt")}
          onError={imageFallback(imageUrl)}
          className="absolute left-0 w-full object-cover"
          style={{
            height: "400%",
            top: `${-pct * 3}%`,
            pointerEvents: "none",
          }}
          draggable={false}
        />
        <div
          className="pointer-events-none absolute left-0 h-px w-full bg-white/70"
          style={{ top: "50%", boxShadow: "0 0 6px 2px rgba(255,255,255,0.3)" }}
        />
      </div>
    </div>
  );
}

function BannerPreviewCarousel({
  banners,
  color,
}: {
  banners: { id: string; image_url: string; object_position?: string }[];
  color?: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const touchRef = useRef<{ x: number } | null>(null);

  const scrollToIdx = (i: number, smooth = true) => {
    const el = ref.current;
    if (!el) return;
    const child = el.children[i] as HTMLElement | undefined;
    if (!child) return;
    el.scrollTo({ left: child.offsetLeft, behavior: smooth ? "smooth" : "instant" });
    setIdx(i);
  };

  useEffect(() => {
    if (banners.length <= 1) return;
    const id = window.setInterval(() => {
      const next = (idx + 1) % banners.length;
      scrollToIdx(next);
    }, 3000);
    return () => clearInterval(id);
  }, [idx, banners.length]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    let closest = 0;
    let minDist = Infinity;
    for (let i = 0; i < el.children.length; i++) {
      const child = el.children[i] as HTMLElement;
      const dist = Math.abs(el.scrollLeft - child.offsetLeft);
      if (dist < minDist) {
        minDist = dist;
        closest = i;
      }
    }
    setIdx(closest);
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchRef.current = { x: e.touches[0]!.clientX };
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!touchRef.current) return;
    const dx = e.changedTouches[0]!.clientX - touchRef.current.x;
    touchRef.current = null;
    if (Math.abs(dx) > 20) {
      if (dx < 0 && idx < banners.length - 1) scrollToIdx(idx + 1);
      else if (dx > 0 && idx > 0) scrollToIdx(idx - 1);
      else if (dx < 0 && idx === banners.length - 1) scrollToIdx(0);
      else if (dx > 0 && idx === 0) scrollToIdx(banners.length - 1);
    }
  }

  if (banners.length === 0) return null;

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl">
        <div
          ref={ref}
          onScroll={onScroll}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
        >
          {banners.map((b) => (
            <div key={b.id} className="w-full shrink-0 snap-center px-1 first:pl-0 last:pr-0">
              <img
                src={optimizedImageUrl(b.image_url, IMAGE_WIDTHS.card) ?? b.image_url}
                alt={t("customize.banner.imageAlt")}
                loading="lazy"
                onError={imageFallback(b.image_url)}
                className="h-24 w-full rounded-xl object-cover"
                style={{ objectPosition: b.object_position ?? "center" }}
              />
            </div>
          ))}
        </div>
        {banners.length > 1 && (
          <>
            <button
              onClick={() => scrollToIdx(idx > 0 ? idx - 1 : banners.length - 1)}
              className="absolute left-1 top-1/2 -translate-y-1/2 grid size-6 place-items-center rounded-full bg-black/30 text-white backdrop-blur-sm transition hover:bg-black/50 max-sm:hidden"
              aria-label={t("common.previous")}
            >
              <ChevronLeft className="size-3" />
            </button>
            <button
              onClick={() => scrollToIdx(idx < banners.length - 1 ? idx + 1 : 0)}
              className="absolute right-1 top-1/2 -translate-y-1/2 grid size-6 place-items-center rounded-full bg-black/30 text-white backdrop-blur-sm transition hover:bg-black/50 max-sm:hidden"
              aria-label={t("common.next")}
            >
              <ChevronLeft className="size-3 rotate-180" />
            </button>
          </>
        )}
      </div>
      {banners.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {banners.map((b, i) => (
            <button
              key={b.id}
              onClick={() => scrollToIdx(i)}
              className="inline-block size-1.5 rounded-full transition-colors"
              style={{ backgroundColor: i === idx ? (color ?? "#8b5cf6") : "#d1d5db" }}
              aria-label={t("customize.banner.indexLabel", { index: i + 1 })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
