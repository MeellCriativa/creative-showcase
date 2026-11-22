import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BarChart3,
  Check,
  ClipboardList,
  Coins,
  Copy,
  ExternalLink,
  Eye,
  KeyboardIcon,
  Link2,
  Loader2,
  LogOut,
  MessageCircle,
  Package,
  Palette,
  QrCode,
  Save,
  Share2,
  Store,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { useAuth } from "@/hooks/useAuth";
import { useMyCatalog, useProducts } from "@/hooks/useCatalog";
import {
  normalizeWhatsappNumber,
  slugify,
  whatsappLink,
} from "@/lib/catalog";
import { resolveStoreCurrency } from "@/lib/currency";
import {
  isValidShortCode,
  normalizeShortCode,
  shortLinkUrl,
} from "@/lib/shortLink";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/painel/")({
  component: PainelHome,
});

function PainelHome() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: catalog, isLoading } = useMyCatalog(user?.id);
  const { data: products } = useProducts(catalog?.id);
  const { t } = useI18n();

  const [storeName, setStoreName] = useState("");
  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [slug, setSlug] = useState("");
  const [currency, setCurrency] = useState("BRL");
  const [savingStore, setSavingStore] = useState(false);
  const [shortCode, setShortCode] = useState("");
  const [savingShort, setSavingShort] = useState(false);
  const [whatsappDraft, setWhatsappDraft] = useState("");
  const [welcomeDraft, setWelcomeDraft] = useState("");
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);

  useEffect(() => {
    if (!catalog) return;
    setNameDraft(catalog.store_name);
    setSlug(catalog.slug);
    setCurrency(resolveStoreCurrency(catalog.currency));
    setShortCode(catalog.short_code ?? "");
    setWhatsappDraft(catalog.whatsapp ?? "");
    setWelcomeDraft(catalog.whatsapp_welcome_message ?? "");
  }, [catalog]);

  async function saveStoreName(e: React.FormEvent) {
    e.preventDefault();
    if (!catalog) return;
    const nextName = nameDraft.trim();
    if (!nextName) {
      toast.error(t("panel.dashboard.storeNameRequired"));
      return;
    }
    if (nextName === catalog.store_name) return;
    setSavingName(true);
    try {
      const { error } = await supabase
        .from("catalogs")
        .update({ store_name: nextName })
        .eq("id", catalog.id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["my-catalog"] });
      toast.success(t("panel.dashboard.storeNameSaved"));
    } catch {
      toast.error(t("panel.dashboard.storeNameSaveError"));
    } finally {
      setSavingName(false);
    }
  }

  /** Salva o endereço do link e a moeda principal direto do painel. */
  async function saveStore() {
    if (!catalog) return;
    setSavingStore(true);
    try {
      const nextSlug = slugify(slug) || catalog.slug;
      const { error } = await supabase
        .from("catalogs")
        .update({ slug: nextSlug, currency: resolveStoreCurrency(currency) } as any)
        .eq("id", catalog.id);

      if (error) {
        if (error.code === "23505") {
          toast.error(t("panel.dashboard.storeLinkInUse"));
        } else {
          toast.error(
            t("panel.dashboard.storeSaveError", {
              message: error.message ?? t("common.tryAgain"),
            }),
          );
        }
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ["my-catalog"] });
      toast.success(t("panel.dashboard.storeSaved"));
    } finally {
      setSavingStore(false);
    }
  }

  async function createCatalog(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setCreating(true);
    try {
      const base = slugify(storeName) || "minha-loja";
      const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
      const { error } = await supabase
        .from("catalogs")
        .insert({ user_id: user.id, slug, store_name: storeName.trim() });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["my-catalog"] });
      toast.success(t("panel.dashboard.createdToast"));
    } catch {
      toast.error(t("panel.dashboard.createError"));
    } finally {
      setCreating(false);
    }
  }

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  if (isLoading) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-label={t("common.loading")} />
      </div>
    );
  }

  if (!catalog) {
    return (
      <div className="px-5 pb-10 pt-12">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-foreground">{t("panel.dashboard.createTitle")}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("panel.dashboard.createSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={logout}
            aria-label={t("common.logout")}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
          >
            <LogOut className="size-4" />
          </button>
        </header>
        <form onSubmit={createCatalog} className="mt-8 space-y-4">
          <input
            required
            value={storeName}
            onChange={(e) => setStoreName(e.target.value)}
            placeholder={t("panel.dashboard.storeNamePlaceholder")}
            className="w-full rounded-2xl border border-input bg-card px-4 py-3.5 text-base outline-none focus:border-primary"
          />
          <button
            type="submit"
            disabled={creating}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground shadow-lg shadow-primary/25 disabled:opacity-60"
          >
            {creating && <Loader2 className="size-4 animate-spin" />}
            {creating ? t("panel.dashboard.creating") : t("panel.dashboard.createButton")}
          </button>
        </form>
      </div>
    );
  }

  const currentSlug = slugify(slug) || catalog.slug;
  const link =
    typeof window !== "undefined" ? `${window.location.origin}/c/${currentSlug}` : `/c/${currentSlug}`;
  const message = t("panel.dashboard.shareMessage", { link });

  const plan = catalog.plan ?? "free";
  const isVip = plan === "premium" || plan === "vitalicio";
  const planLabel =
    plan === "premium"
      ? t("panel.dashboard.planPremium")
      : plan === "vitalicio"
        ? t("panel.dashboard.planLifetime")
        : plan === "mensal"
          ? t("panel.dashboard.planMonthly")
          : plan === "trimestral"
            ? t("panel.dashboard.planQuarterly")
            : plan === "anual"
              ? t("panel.dashboard.planYearly")
              : t("panel.dashboard.planFree");

  const planDescription =
    plan === "free"
      ? t("panel.dashboard.planFreeText")
      : plan === "vitalicio"
        ? t("panel.dashboard.planLifetimeText")
        : plan === "premium"
          ? t("panel.dashboard.planPremiumText")
          : t("panel.dashboard.planSubscriptionText");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t("panel.dashboard.linkCopied"));
    } catch {
      toast.error(t("panel.dashboard.copyError"));
    }
  }

  async function shareLink() {
    if (navigator.share) {
      try {
        await navigator.share({ title: catalog!.store_name, text: message, url: link });
        return;
      } catch {
        /* cancelado */
      }
    }
    void copyLink();
  }

  // ── Link curto personalizável (/s/CODIGO) ────────────────────────────────
  const normalizedShort = normalizeShortCode(shortCode);
  const shortLink = normalizedShort ? shortLinkUrl(normalizedShort) : "";

  async function saveShortCode() {
    if (!catalog) return;
    const code = normalizeShortCode(shortCode);
    if (!isValidShortCode(code)) {
      toast.error(t("panel.dashboard.shortLinkInvalid"));
      return;
    }
    setSavingShort(true);
    try {
      const { error } = await supabase
        .from("catalogs")
        .update({ short_code: code })
        .eq("id", catalog.id);
      if (error) {
        if (error.code === "23505") {
          toast.error(t("panel.dashboard.shortLinkInUse"));
        } else if (/código curto|reservado/i.test(error.message)) {
          toast.error(error.message);
        } else {
          toast.error(t("panel.dashboard.storeSaveError", { message: error.message }));
        }
        return;
      }
      setShortCode(code);
      await queryClient.invalidateQueries({ queryKey: ["my-catalog"] });
      toast.success(t("panel.dashboard.shortLinkSaved"));
    } finally {
      setSavingShort(false);
    }
  }

  async function copyShortLink() {
    if (!shortLink) return;
    try {
      await navigator.clipboard.writeText(shortLink);
      toast.success(t("panel.dashboard.shortLinkCopied"));
    } catch {
      toast.error(t("panel.dashboard.copyError"));
    }
  }

  // ── Link direto do WhatsApp com a mensagem de boas-vindas ────────────────
  const normalizedPhone = normalizeWhatsappNumber(whatsappDraft);
  const phoneDigits = normalizedPhone.replace(/\D/g, "");
  const hasValidPhone = phoneDigits.length >= 12 && phoneDigits.length <= 13;
  const whatsappUrl = hasValidPhone
    ? whatsappLink(normalizedPhone, welcomeDraft.trim())
    : "";

  async function saveWhatsapp() {
    if (!catalog) return;
    if (!hasValidPhone) {
      toast.error(t("panel.dashboard.whatsappInvalid"));
      return;
    }
    setSavingWhatsapp(true);
    try {
      const { error } = await supabase
        .from("catalogs")
        .update({
          whatsapp: normalizedPhone,
          whatsapp_welcome_message: welcomeDraft.trim() || null,
        })
        .eq("id", catalog.id);
      if (error) {
        toast.error(t("panel.dashboard.storeSaveError", { message: error.message }));
        return;
      }
      setWhatsappDraft(normalizedPhone);
      await queryClient.invalidateQueries({ queryKey: ["my-catalog"] });
      toast.success(t("panel.dashboard.whatsappSaved"));
    } finally {
      setSavingWhatsapp(false);
    }
  }

  async function copyWhatsappLink() {
    if (!whatsappUrl) return;
    try {
      await navigator.clipboard.writeText(whatsappUrl);
      toast.success(t("panel.dashboard.whatsappCopied"));
    } catch {
      toast.error(t("panel.dashboard.copyError"));
    }
  }

  return (
    <div className="px-5 pb-10 pt-10">
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        {catalog.logo_url && (
          <img
            src={catalog.logo_url}
            alt={catalog.store_name}
            className="size-12 shrink-0 rounded-full border-2 object-cover"
            style={{ borderColor: catalog.primary_color ?? "#8b5cf6" }}
          />
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("panel.dashboard.label")}
          </p>
          <h1 className="truncate text-2xl font-bold text-foreground">{catalog.store_name}</h1>
        </div>
        <button
          onClick={logout}
          aria-label={t("common.logout")}
          className="grid size-10 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
        >
          <LogOut className="size-4" />
        </button>
      </header>

      <section
        className={
          "mt-6 overflow-hidden rounded-3xl border p-5 " +
          (isVip
            ? "border-amber-300 bg-gradient-to-br from-amber-100 via-amber-50 to-accent shadow-[0_8px_30px_-8px_rgba(217,177,87,0.6)]"
            : "border-primary/20 bg-gradient-to-br from-primary/15 via-accent to-background")
        }
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p
              className={
                "text-[11px] font-semibold uppercase tracking-widest " +
                (isVip ? "text-amber-600" : "text-primary")
              }
            >
              Vitrine Criativa
            </p>
            <h2 className="mt-0.5 flex items-center gap-1.5 text-lg font-bold text-foreground">
              {planLabel}
              {isVip && <span className="text-xl">👑</span>}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{planDescription}</p>
          </div>
          <span
            className={
              "grid size-12 shrink-0 place-items-center rounded-2xl shadow-lg " +
              (isVip
                ? "bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-amber-500/40"
                : "bg-primary text-primary-foreground shadow-primary/30")
            }
          >
            <Store className="size-6" />
          </span>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-border bg-card p-5">
        <p className="text-sm font-semibold text-foreground">{t("panel.dashboard.storeNameTitle")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t("panel.dashboard.storeNameHint")}</p>
        <form onSubmit={saveStoreName} className="mt-3 flex items-stretch gap-2">
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            maxLength={80}
            aria-label={t("panel.dashboard.storeNameTitle")}
            className="input-base min-w-0 flex-1"
          />
          <button
            type="submit"
            disabled={savingName || !nameDraft.trim() || nameDraft.trim() === catalog.store_name}
            className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {savingName ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            {savingName ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-3xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          {(catalog.cover_url || catalog.logo_url) && (
            <img
              src={catalog.cover_url || catalog.logo_url!}
              alt={catalog.store_name}
              className="size-14 shrink-0 rounded-xl object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{t("panel.dashboard.storeLink")}</p>
            <p className="mt-1 truncate rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              {link}
            </p>
          </div>
        </div>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">
            {t("panel.dashboard.editStoreLink")}
          </span>
          <span className="mt-1 flex items-center rounded-xl border border-input bg-card px-3">
            <span className="shrink-0 text-xs text-muted-foreground">/c/</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="minha-loja"
              className="w-full bg-transparent py-2.5 text-sm text-foreground outline-none"
            />
          </span>
        </label>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            onClick={copyLink}
            className="flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-semibold text-foreground"
          >
            <Copy className="size-4" /> {t("panel.dashboard.copy")}
          </button>
          <button
            onClick={shareLink}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground"
          >
            <Share2 className="size-4" /> {t("panel.dashboard.share")}
          </button>
          <button
            onClick={saveStore}
            disabled={savingStore}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {savingStore ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("common.save")}
          </button>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-[11px] font-medium text-muted-foreground">
          <a
            className="rounded-xl border border-border py-2 text-center"
            href={`https://wa.me/?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
          >
            WhatsApp
          </a>
          <a
            className="rounded-xl border border-border py-2 text-center"
            href={`https://t.me/share/url?url=${encodeURIComponent(link)}`}
            target="_blank"
            rel="noreferrer"
          >
            Telegram
          </a>
          <a
            className="rounded-xl border border-border py-2 text-center"
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`}
            target="_blank"
            rel="noreferrer"
          >
            Facebook
          </a>
          <button onClick={copyLink} className="rounded-xl border border-border py-2 text-center">
            Instagram
          </button>
        </div>
      </section>

      {/* ── Link curto personalizável ── */}
      <section className="mt-6 rounded-3xl border border-border bg-card p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Link2 className="size-4" /> {t("panel.dashboard.shortLinkTitle")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("panel.dashboard.shortLinkHint")}</p>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">
            {t("panel.dashboard.shortLinkCode")}
          </span>
          <span className="mt-1 flex items-center rounded-xl border border-input bg-card px-3">
            <span className="shrink-0 text-xs text-muted-foreground">/s/</span>
            <input
              value={shortCode}
              onChange={(e) => setShortCode(e.target.value)}
              placeholder={t("panel.dashboard.shortLinkPlaceholder")}
              maxLength={24}
              className="w-full bg-transparent py-2.5 text-sm text-foreground outline-none"
            />
          </span>
        </label>
        <div className="mt-3 truncate rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          {shortLink || `…/s/${t("panel.dashboard.shortLinkPlaceholder")}`}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={copyShortLink}
            disabled={!shortLink}
            className="flex items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-semibold text-foreground disabled:opacity-50"
          >
            <Copy className="size-4" /> {t("panel.dashboard.copy")}
          </button>
          <button
            type="button"
            onClick={saveShortCode}
            disabled={savingShort || !isValidShortCode(normalizedShort)}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {savingShort ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("common.save")}
          </button>
        </div>
      </section>

      {/* ── Link direto do WhatsApp ── */}
      <section className="mt-6 rounded-3xl border border-border bg-card p-5">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <MessageCircle className="size-4" /> {t("panel.dashboard.whatsappLinkTitle")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{t("panel.dashboard.whatsappLinkHint")}</p>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">
            {t("panel.dashboard.whatsappNumber")}
          </span>
          <input
            value={whatsappDraft}
            onChange={(e) => setWhatsappDraft(e.target.value)}
            placeholder={t("panel.dashboard.whatsappNumberPlaceholder")}
            inputMode="tel"
            className="mt-1 w-full rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">
            {t("panel.dashboard.whatsappWelcome")}
          </span>
          <textarea
            value={welcomeDraft}
            onChange={(e) => setWelcomeDraft(e.target.value)}
            placeholder={t("panel.dashboard.whatsappWelcomePlaceholder")}
            rows={2}
            maxLength={500}
            className="mt-1 w-full resize-none rounded-xl border border-input bg-card px-3 py-2.5 text-sm text-foreground outline-none"
          />
        </label>
        <div className="mt-3 truncate rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
          {whatsappUrl || `https://wa.me/…`}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={copyWhatsappLink}
            disabled={!whatsappUrl}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border py-3 text-xs font-semibold text-foreground disabled:opacity-50"
          >
            <Copy className="size-4" /> {t("panel.dashboard.copy")}
          </button>
          <a
            href={whatsappUrl || undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!whatsappUrl}
            className={`flex items-center justify-center gap-1.5 rounded-xl border border-border py-3 text-xs font-semibold ${
              whatsappUrl ? "text-foreground" : "pointer-events-none opacity-50 text-muted-foreground"
            }`}
          >
            <ExternalLink className="size-4" /> {t("panel.dashboard.whatsappOpen")}
          </a>
          <button
            type="button"
            onClick={saveWhatsapp}
            disabled={savingWhatsapp || !hasValidPhone}
            className="flex items-center justify-center gap-1.5 rounded-xl bg-primary py-3 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {savingWhatsapp ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("common.save")}
          </button>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-2xl font-bold text-foreground">{products?.length ?? 0}</p>
          <p className="text-xs text-muted-foreground">{t("panel.dashboard.registeredProducts")}</p>
        </div>
        <a
          href={`/c/${catalog.slug}`}
          target="_blank"
          rel="noreferrer"
          className="flex flex-col justify-center rounded-2xl bg-accent p-4 text-accent-foreground"
        >
          <Eye className="size-5" />
          <p className="mt-1 text-sm font-semibold">{t("panel.dashboard.viewCatalog")}</p>
        </a>
      </div>

      <nav className="mt-4 space-y-3">
        <ShortcutLink
          to="/painel/produtos"
          icon={Package}
          title={t("panel.nav.createProduct")}
          text={t("panel.dashboard.productsText")}
        />
        <ShortcutLink
          to="/painel/pedidos"
          icon={ClipboardList}
          title={t("panel.nav.orders")}
          text={t("panel.dashboard.ordersText")}
        />
        <ShortcutLink
          to="/painel/categorias"
          icon={Store}
          title={t("panel.nav.categories")}
          text={t("panel.dashboard.categoriesText")}
        />
        <ShortcutLink
          to="/painel/personalizar"
          icon={Palette}
          title={t("panel.dashboard.customizeTitle")}
          text={t("panel.dashboard.customizeText")}
        />
        <ShortcutLink
          to="/painel/estatisticas"
          icon={BarChart3}
          title={t("panel.nav.stats")}
          text={t("panel.dashboard.statsText")}
        />
        {/* ── Moeda principal da loja ── */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Coins className="size-4" /> {t("customize.fields.currency")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t("customize.hints.currency")}</p>
          <div className="mt-3">
            <CurrencyPicker value={currency} onChange={setCurrency} />
          </div>
          <button
            onClick={saveStore}
            disabled={savingStore}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {savingStore ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("common.save")}
          </button>
        </div>

        <ShortcutLink
          to="/painel/conversor"
          icon={ArrowLeftRight}
          title={t("panel.dashboard.shortcutConverter")}
          text={t("panel.dashboard.converterText")}
        />
        <ShortcutLink
          to="/painel/qr-code"
          icon={QrCode}
          title={t("qrCode.title")}
          text={t("qrCode.shortcutText")}
        />
        <PasswordLink to="/painel/senha" />
      </nav>
    </div>
  );
}

function PasswordLink({ to }: { to: string }) {
  const { t } = useI18n();

  return (
    <Link
      to={to}
      className="btn-elevated btn-shimmer group fixed bottom-24 right-[max(1rem,calc((100vw-30rem)/2+1rem))] z-40 flex items-center gap-2 overflow-hidden rounded-full py-3 pl-4 pr-5 text-white shadow-[0_2px_4px_rgb(0_0_0/0.08),0_8px_20px_-6px_var(--primary-glow)] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97]"
      style={{
        background: "linear-gradient(135deg, #8b5cf6 0%, #a78bfa 50%, #c4b5fd 100%)",
      }}
    >
      <KeyboardIcon className="size-4 shrink-0" />
      <span className="text-sm font-semibold">{t("panel.dashboard.resetPassword")}</span>
    </Link>
  );
}

function ShortcutLink({
  to,
  icon: Icon,
  title,
  text,
}: {
  to: string;
  icon: typeof Package;
  title: string;
  text: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
      <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
