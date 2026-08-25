import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2, ChevronUp, ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { CartIcon, CART_STYLES } from "@/components/CartIcons";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog } from "@/hooks/useCatalog";
import { slugify, FONT_OPTIONS, getFontFamily, PAYMENT_METHODS } from "@/lib/catalog";
import type { Banner } from "@/lib/catalog";
import { EmptyCatalog } from "./painel.categorias";

export const Route = createFileRoute("/painel/personalizar")({
  component: PersonalizarPage,
});

const palettes = [
  { primary: "#8b5cf6", accent: "#f3eefc", label: "Lilás" },
  { primary: "#d1477a", accent: "#fdf2f6", label: "Rosa" },
  { primary: "#b45309", accent: "#fef3c7", label: "Âmbar" },
  { primary: "#0f766e", accent: "#ccfbf1", label: "Verde" },
  { primary: "#4338ca", accent: "#e0e7ff", label: "Índigo" },
  { primary: "#1f2937", accent: "#f3f4f6", label: "Grafite" },
  { primary: "#be123c", accent: "#ffe4e6", label: "Vermelho" },
];

function PersonalizarPage() {
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
  const [ownerPhotoUrl, setOwnerPhotoUrl] = useState<string[]>([]);
  const [ownerName, setOwnerName] = useState("");
  const [ownerBio, setOwnerBio] = useState("");
  const [ownerHours, setOwnerHours] = useState("");

  useEffect(() => {
    if (!catalog) return;
    setStoreName(catalog.store_name);
    setSlug(catalog.slug);
    setWhatsapp(catalog.whatsapp ?? "");
    setLogo(catalog.logo_url ? [catalog.logo_url] : []);
    setCover(catalog.cover_url ? [catalog.cover_url] : []);
    setPrimary(catalog.primary_color ?? "#8b5cf6");
    setAccent(catalog.accent_color ?? "#f3eefc");
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
      Array.isArray(catalog.payment_methods) ? (catalog.payment_methods as string[]) : []
    );
    setOwnerPhotoUrl(catalog.owner_photo_url ? [catalog.owner_photo_url] : []);
    setOwnerName(catalog.owner_name ?? "");
    setOwnerBio(catalog.owner_bio ?? "");
    setOwnerHours(catalog.owner_hours ?? "");

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

  const logoSizePx = logoSize === "pequena" ? "size-12" : logoSize === "grande" ? "size-36" : "size-16";

  function addBanner(url: string) {
    setBanners((prev) => [
      ...prev,
      {
        id: `new-${Date.now()}`,
        catalog_id: catalog!.id,
        image_url: url,
        href: null,
        position: prev.length,
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

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const { error: catalogError } = await supabase
      .from("catalogs")
      .update({
        store_name: storeName.trim(),
        slug: slugify(slug) || catalog!.slug,
        whatsapp: whatsapp.trim() || null,
        logo_url: logo[0] ?? null,
        cover_url: cover[0] ?? null,
        primary_color: primary,
        accent_color: accent,
        store_font: storeFont,
        logo_size: logoSize,
        logo_position: logoPosition,
        cart_style: cartStyle,
        whatsapp_button_color: whatsappButtonColor,
        banner_enabled: bannerEnabled,
        banner_autoplay: bannerAutoplay,
        banner_interval: bannerInterval,
        banner_indicators: bannerIndicators,
        store_description: storeDescription.trim() || null,
        instagram_url: instagramUrl.trim() || null,
        payment_methods: paymentMethods,
        owner_photo_url: ownerPhotoUrl[0] ?? null,
        owner_name: ownerName.trim() || null,
        owner_bio: ownerBio.trim() || null,
        owner_hours: ownerHours.trim() || null,
      })
      .eq("id", catalog!.id);

    if (catalogError) {
      setSaving(false);
      toast.error(
        catalogError.code === "23505" ? "Esse endereço de link já está em uso." : "Erro ao salvar.",
      );
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
      const { error: deleteError } = await supabase
        .from("banners")
        .delete()
        .in("id", toDelete);
      if (deleteError) {
        setSaving(false);
        toast.error("Erro ao atualizar banners.");
        return;
      }
    }

    if (banners.length > 0) {
      const { error: bannerError } = await supabase.from("banners").upsert(
        banners.map((b) => ({
          ...(b.id.startsWith("new-") ? {} : { id: b.id }),
          catalog_id: catalog!.id,
          image_url: b.image_url,
          href: b.href || null,
          position: b.position,
        })),
        { onConflict: "id" },
      );
      if (bannerError) {
        setSaving(false);
        toast.error("Erro ao salvar banners.");
        return;
      }
    }

    setSaving(false);
    toast.success("Vitrine atualizada!");
    void queryClient.invalidateQueries({ queryKey: ["my-catalog"] });
  }

  return (
    <form onSubmit={save} className="px-5 pb-10 pt-10">
      <h1 className="text-2xl font-bold text-foreground">Personalizar vitrine</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Deixe o catálogo com a cara da sua marca.
      </p>

      {/* ── Pré-visualização ── */}
      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="relative h-20 w-full overflow-hidden" style={{ background: accent ?? "#f3eefc" }}>
          {cover[0] ? (
            <img src={cover[0]} alt="Capa" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full" style={{ background: primary ?? "#8b5cf6", opacity: 0.15 }} />
          )}
          <div
            className="absolute inset-x-0 bottom-0 h-8"
            style={{ background: `linear-gradient(to top, ${accent ?? "#f3eefc"}, transparent)` }}
          />
        </div>

        <div
          className="relative flex items-end gap-3 px-4 pb-4 -mt-5"
          style={{ justifyContent: logoPosition === "centro" ? "center" : logoPosition === "direita" ? "flex-end" : "flex-start" }}
        >
          {logo[0] ? (
            <img
              src={logo[0]}
              alt="Logo"
              className={`${logoSizePx} shrink-0 rounded-full border-2 object-cover shadow-md`}
              style={{ borderColor: primary ?? "#8b5cf6" }}
            />
          ) : (
            <div
              className={`${logoSizePx} shrink-0 rounded-full border-2 border-dashed flex items-center justify-center text-[10px] text-muted-foreground`}
              style={{ borderColor: primary ?? "#8b5cf6" }}
            >
              Logo
            </div>
          )}
        </div>

        <div className="px-4 pb-4">
          <p
            className="text-lg font-bold leading-tight text-foreground"
            style={{ fontFamily: getFontFamily(storeFont), color: primary ?? "#8b5cf6" }}
          >
            {storeName || "Nome da loja"}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <CartIcon style={cartStyle} className="size-5" color={primary ?? "#8b5cf6"} />
            <span className="text-xs text-muted-foreground">Carrinho</span>
          </div>
        </div>

        {bannerEnabled && banners.length > 0 && (
          <div className="border-t border-border px-4 py-2">
            <div className="flex gap-2 overflow-x-auto">
              {banners.map((b) => (
                <img
                  key={b.id}
                  src={b.image_url}
                  alt="Banner"
                  className="h-12 w-20 shrink-0 rounded-lg object-cover"
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Dados da Loja ── */}
      <Field label="Nome da loja">
        <input
          required
          value={storeName}
          onChange={(e) => setStoreName(e.target.value)}
          className="input-base"
        />
      </Field>

      <Field label="Endereço do link" hint={`/c/${slugify(slug) || catalog.slug}`}>
        <input value={slug} onChange={(e) => setSlug(e.target.value)} className="input-base" />
      </Field>

      <Field label="WhatsApp para receber pedidos" hint="Ex.: 11988887777 (com DDD)">
        <input
          inputMode="numeric"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="11988887777"
          className="input-base"
        />
      </Field>

      <Field label="Logotipo">
        <ImageUploader
          userId={user.id}
          value={logo}
          onChange={setLogo}
          max={1}
          shape="circle"
          label="Logo"
        />
      </Field>

      <Field label="Foto de capa">
        <ImageUploader
          userId={user.id}
          value={cover}
          onChange={setCover}
          max={1}
          shape="wide"
          label="Capa"
        />
      </Field>

      <Field label="Cores do catálogo">
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
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
          <label className="flex items-center gap-2">
            Principal
            <input
              type="color"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              className="size-8 rounded-lg border border-border bg-card"
            />
          </label>
          <label className="flex items-center gap-2">
            Fundo
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              className="size-8 rounded-lg border border-border bg-card"
            />
          </label>
        </div>
      </Field>

      {/* ── Fonte do Nome da Loja ── */}
      <Field label="Fonte do nome da loja">
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
              <span className="block text-xs text-muted-foreground">{f.label}</span>
              <span
                className="mt-1 block truncate text-base font-bold text-foreground"
                style={{ fontFamily: f.family }}
              >
                {storeName || "Loja"}
              </span>
            </button>
          ))}
        </div>
      </Field>

      {/* ── Tamanho da Logo ── */}
      <Field label="Tamanho da logo">
        <div className="flex gap-3">
          {([
            { key: "pequena", label: "Pequena", cls: "size-12" },
            { key: "medio", label: "Média", cls: "size-16" },
            { key: "grande", label: "Grande", cls: "size-36" },
          ] as const).map((opt) => (
            <button
              type="button"
              key={opt.key}
              onClick={() => setLogoSize(opt.key)}
              className={`flex flex-1 flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${
                logoSize === opt.key ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              {logo[0] ? (
                <img src={logo[0]} alt="Logo" className={`${opt.cls} rounded-full object-cover`} />
              ) : (
                <div
                  className={`${opt.cls} rounded-full border-2 border-dashed flex items-center justify-center text-[9px] text-muted-foreground`}
                >
                  Logo
                </div>
              )}
              <span className="text-xs font-medium text-muted-foreground">{opt.label}</span>
            </button>
          ))}
        </div>
      </Field>

      {/* ── Posição da Logo ── */}
      <Field label="Posição da logo">
        <div className="flex gap-3">
          {([
            { key: "esquerda", label: "Esquerda" },
            { key: "centro", label: "Centro" },
            { key: "direita", label: "Direita" },
          ] as const).map((opt) => (
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
                  justifyContent: opt.key === "centro" ? "center" : opt.key === "direita" ? "flex-end" : "flex-start",
                  padding: "0 4px",
                }}
              >
                <div className="size-4 rounded-full" style={{ background: primary }} />
              </div>
              <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      </Field>

      {/* ── Estilo do Carrinho ── */}
      <Field label="Ícone do carrinho">
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
                {c.label}
              </span>
            </button>
          ))}
        </div>
      </Field>

      {/* ── Cor do botão flutuante WhatsApp ── */}
      <Field
        label="Cor do botão WhatsApp"
        hint="Cor do botão flutuante que aparece no catálogo público"
      >
        <div className="flex items-center gap-3">
          {[
            { color: "#8b5cf6", label: "Lilás" },
            { color: "#25d366", label: "Verde" },
            { color: "#128C7E", label: "Verde escuro" },
            { color: "#d1477a", label: "Rosa" },
            { color: "#1f2937", label: "Grafite" },
          ].map((opt) => (
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
              <span className="text-[10px] font-medium text-muted-foreground">{opt.label}</span>
            </button>
          ))}
          <label className="flex flex-col items-center gap-1">
            <input
              type="color"
              value={whatsappButtonColor}
              onChange={(e) => setWhatsappButtonColor(e.target.value)}
              className="size-7 rounded-full border border-border bg-card cursor-pointer"
            />
            <span className="text-[10px] font-medium text-muted-foreground">Custom</span>
          </label>
        </div>
      </Field>

      {/* ── Banner / Carrossel ── */}
      <Field label="Banner / Carrossel">
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
            {bannerEnabled ? "Ativado" : "Desativado"}
          </span>
        </div>

        {bannerEnabled && (
          <div className="mt-4 space-y-4">
            {banners.map((b, idx) => (
              <div key={b.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
                <img
                  src={b.image_url}
                  alt={`Banner ${idx + 1}`}
                  className="size-16 shrink-0 rounded-lg object-cover"
                />
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveBanner(idx, -1)}
                      className="rounded-lg border border-border p-1 text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === banners.length - 1}
                      onClick={() => moveBanner(idx, 1)}
                      className="rounded-lg border border-border p-1 text-muted-foreground disabled:opacity-30"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBanner(idx)}
                      className="ml-auto rounded-lg border border-destructive/30 p-1 text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <input
                    value={b.href ?? ""}
                    onChange={(e) => updateBannerHref(idx, e.target.value)}
                    placeholder="Link opcional (https://...)"
                    className="input-base text-xs"
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
              label="Adicionar banner"
            />

            <div className="space-y-3 rounded-xl border border-border p-4">
              <p className="text-xs font-semibold text-foreground">Configurações do banner</p>

              <label className="flex items-center gap-3 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={bannerAutoplay}
                  onChange={(e) => setBannerAutoplay(e.target.checked)}
                  className="size-4 rounded border-border"
                />
                Reprodução automática
              </label>

              <div className="text-sm text-muted-foreground">
                <p className="mb-1 text-xs font-medium">Intervalo</p>
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
                Mostrar indicadores
              </label>
            </div>
          </div>
        )}
      </Field>

      {/* ── Descrição da Loja ── */}
      <Field label="Descrição da loja" hint="Texto que aparece na página de boas-vindas do catálogo">
        <textarea
          value={storeDescription}
          onChange={(e) => setStoreDescription(e.target.value)}
          placeholder="Ex: Papelaria personalizada com muito carinho..."
          rows={3}
          className="input-base resize-none"
        />
      </Field>

      {/* ── Link do Instagram ── */}
      <Field label="Link do Instagram" hint="URL do perfil da loja no Instagram">
        <input
          value={instagramUrl}
          onChange={(e) => setInstagramUrl(e.target.value)}
          placeholder="https://instagram.com/sualoja"
          className="input-base"
        />
      </Field>

      {/* ── Formas de pagamento ── */}
      <Field label="Formas de pagamento" hint="Selecione as formas aceitas pela loja">
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
                <span className="text-sm font-medium text-foreground">{m.label}</span>
              </label>
            );
          })}
        </div>
      </Field>

      {/* ── Apresentação da Dona ── */}
      <Field label="Apresentação da loja" hint="Seção de apresentação que aparece no catálogo público">
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Foto pessoal</p>
            <ImageUploader
              userId={user.id}
              value={ownerPhotoUrl}
              onChange={setOwnerPhotoUrl}
              max={1}
              shape="circle"
              label="Foto"
            />
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Nome ou título</p>
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Ex: Ana"
              className="input-base"
            />
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Texto de apresentação</p>
            <textarea
              value={ownerBio}
              onChange={(e) => setOwnerBio(e.target.value)}
              placeholder="Ex: Olá! Eu sou a Ana, criadora da loja. Trabalho com papelaria personalizada e preparo cada pedido com muito carinho."
              rows={3}
              className="input-base resize-none"
            />
          </div>

          <div>
            <p className="text-xs text-muted-foreground mb-1">Horários de atendimento</p>
            <textarea
              value={ownerHours}
              onChange={(e) => setOwnerHours(e.target.value)}
              placeholder="Ex: Segunda a sexta, das 8h às 18h."
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
        Salvar alterações
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
