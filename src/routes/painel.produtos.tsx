import { useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Link2,
  Loader2,
  Palette,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { useAuth } from "@/hooks/useAuth";
import { useCategories, useMyCatalog, useProducts } from "@/hooks/useCatalog";
import { useMetaConnection, useMetaMappings } from "@/hooks/useMetaCatalog";
import { useI18n } from "@/i18n";
import { type PriceOption, type Product, type VariationGroup } from "@/lib/catalog";
import { writeToClipboard } from "@/lib/clipboard";
import { formatMoney, getCurrencySymbol, resolveStoreCurrency } from "@/lib/currency";
import { buildProductCheckoutUrl } from "@/lib/productLinks";
import {
  formatFileSize,
  removeDigitalFile,
  uploadDigitalFile,
} from "@/lib/digitalDelivery";
import { CheckoutDesignEditor } from "@/components/CheckoutDesignEditor";
import { EmptyCatalog } from "./painel.categorias";

export const Route = createFileRoute("/painel/produtos")({
  component: ProdutosPage,
});

type Draft = {
  id?: string;
  name: string;
  description: string;
  price: string;
  sale_price: string;
  price_options: PriceOption[];
  category_id: string;
  images: string[];
  variations: VariationGroup[];
  available: boolean;
  is_new: boolean;
  is_bestseller: boolean;
  product_type: "fisico" | "digital";
  digital_file_path: string | null;
  digital_file_name: string | null;
  digital_file_mime: string | null;
  digital_file_size: number | null;
  digital_file_checksum: string | null;
  digital_instructions: string;
  digital_link_ttl_minutes: string;
  digital_max_downloads: string;
  digital_delivery_mode: "file" | "link";
  digital_external_url: string;
  additional_info: string;
  weight_grams: string;
  length_cm: string;
  width_cm: string;
  height_cm: string;
};

const emptyDraft: Draft = {
  name: "",
  description: "",
  price: "",
  sale_price: "",
  price_options: [],
  category_id: "",
  images: [],
  variations: [],
  available: true,
  is_new: false,
  is_bestseller: false,
  product_type: "fisico",
  digital_file_path: null,
  digital_file_name: null,
  digital_file_mime: null,
  digital_file_size: null,
  digital_file_checksum: null,
  digital_instructions: "",
  digital_link_ttl_minutes: "1440",
  digital_max_downloads: "5",
  digital_delivery_mode: "file",
  digital_external_url: "",
  additional_info: "",
  weight_grams: "",
  length_cm: "",
  width_cm: "",
  height_cm: "",
};

function ProdutosPage() {
  const { t, tp } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: catalog } = useMyCatalog(user?.id);
  const { data: products, isLoading } = useProducts(catalog?.id);
  const { data: categories } = useCategories(catalog?.id);
  const { data: metaConn } = useMetaConnection(catalog?.id);
  const { data: metaMappings } = useMetaMappings(catalog?.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [checkoutProduct, setCheckoutProduct] = useState<Product | null>(null);

  const currency = resolveStoreCurrency(catalog?.currency);
  const money = (value: number) => formatMoney(value, currency);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["products", catalog?.id] });

  const metaConnected =
    metaConn?.sync_status === "connected" || metaConn?.sync_status === "syncing";
  const mappingsByProduct = new Map((metaMappings ?? []).map((m) => [m.product_id, m.sync_state]));

  if (!catalog || !user) return <EmptyCatalog />;

  async function remove(id: string) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) toast.error(t("products.errors.deleteFailed"));
    else void refresh();
  }

  async function move(list: Product[], index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const a = list[index]!;
    const b = list[target]!;
    await Promise.all([
      supabase.from("products").update({ position: target }).eq("id", a.id),
      supabase.from("products").update({ position: index }).eq("id", b.id),
    ]);
    void refresh();
  }

  function edit(product: Product) {
    setDraft({
      id: product.id,
      name: product.name,
      description: product.description ?? "",
      price: String(product.price),
      sale_price: product.sale_price != null ? String(product.sale_price) : "",
      price_options: product.price_options ?? [],
      category_id: product.category_id ?? "",
      images: product.images ?? [],
      variations: product.variations ?? [],
      available: product.available,
      is_new: product.is_new,
      is_bestseller: product.is_bestseller,
      product_type: product.product_type === "digital" ? "digital" : "fisico",
      digital_file_path: product.digital_file_path ?? null,
      digital_file_name: product.digital_file_name ?? null,
      digital_file_mime: product.digital_file_mime ?? null,
      digital_file_size: product.digital_file_size ?? null,
      digital_file_checksum: product.digital_file_checksum ?? null,
      digital_instructions: product.digital_instructions ?? "",
      digital_link_ttl_minutes: String(product.digital_link_ttl_minutes ?? 1440),
      digital_max_downloads: String(product.digital_max_downloads ?? 5),
      digital_delivery_mode: product.digital_delivery_mode === "link" ? "link" : "file",
      digital_external_url: product.digital_external_url ?? "",
      additional_info: product.additional_info ?? "",
      weight_grams: product.weight_grams != null ? String(product.weight_grams) : "",
      length_cm: product.length_cm != null ? String(product.length_cm) : "",
      width_cm: product.width_cm != null ? String(product.width_cm) : "",
      height_cm: product.height_cm != null ? String(product.height_cm) : "",
    });
  }

  return (
    <div className="px-5 pb-10 pt-10">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-bold text-foreground">{t("products.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {tp("products.count", products?.length ?? 0)}
          </p>
        </div>
        <button
          onClick={() => setDraft({ ...emptyDraft })}
          className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" /> {t("panel.nav.createProduct")}
        </button>
      </header>

      <div className="mt-6 space-y-3">
        {isLoading && <Loader2 className="mx-auto size-5 animate-spin text-primary" />}
        {products?.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {t("products.empty", { action: t("panel.nav.createProduct") })}
          </p>
        )}
        {products?.map((product, index) => {
          const syncState = mappingsByProduct.get(product.id);
          const syncTitle =
            syncState === "synced"
              ? t("products.sync.synced")
              : syncState === "error"
                ? t("products.sync.error")
                : syncState === "deleted"
                  ? t("products.sync.deleted")
                  : t("products.sync.pending");
          return (
            <article
              key={product.id}
              className="flex gap-3 rounded-2xl border border-border bg-card p-3"
            >
              <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                {product.images?.[0] && (
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-semibold text-foreground">{product.name}</p>
                  {metaConnected && (
                    <span
                      className={`inline-block size-2 shrink-0 rounded-full ${
                        syncState === "synced"
                          ? "bg-green-500"
                          : syncState === "error"
                            ? "bg-red-500"
                            : syncState === "deleted"
                              ? "bg-orange-400"
                              : "bg-gray-300"
                      }`}
                      title={syncTitle}
                    />
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {product.price_options && product.price_options.length > 0 ? (
                    <span className="font-semibold text-primary">
                      {product.price_options.map((o) => money(o.price)).join(" / ")}
                    </span>
                  ) : product.sale_price ? (
                    <>
                      <span className="line-through">{money(Number(product.price))}</span>{" "}
                      <span className="font-semibold text-primary">
                        {money(Number(product.sale_price))}
                      </span>
                    </>
                  ) : (
                    money(Number(product.price))
                  )}
                </p>
                {product.product_type === "digital" && (
                  <span className="mt-1 mr-1 inline-block rounded-full bg-[var(--shop-accent)] px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {t("products.digitalBadge")}
                    {product.digital_delivery_mode === "link" ? (
                      ` · ${t("products.digital.modeLink")}`
                    ) : product.digital_file_name ? (
                      ` · ${product.digital_file_name}`
                    ) : (
                      ""
                    )}
                  </span>
                )}
                {product.checkout_enabled && (
                  <span className="mt-1 inline-block rounded-full bg-[var(--shop-accent)] px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {t("products.editor.customizeCheckout")}
                  </span>
                )}
                {!product.available && (
                  <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    {t("products.outOfStock")}
                  </span>
                )}
                <div className="mt-2 flex gap-1">
                  <SmallBtn
                    label={t("products.actions.moveUp")}
                    onClick={() => move(products, index, -1)}
                  >
                    <ArrowUp className="size-3.5" />
                  </SmallBtn>
                  <SmallBtn
                    label={t("products.actions.moveDown")}
                    onClick={() => move(products, index, 1)}
                  >
                    <ArrowDown className="size-3.5" />
                  </SmallBtn>
                  <SmallBtn label={t("products.actions.edit")} onClick={() => edit(product)}>
                    <Pencil className="size-3.5" />
                  </SmallBtn>
                  <SmallBtn
                    label={t("products.editor.customizeCheckout")}
                    onClick={() => setCheckoutProduct(product)}
                  >
                    <Palette className="size-3.5" />
                  </SmallBtn>
                  <SmallBtn
                    label={t("products.actions.delete")}
                    onClick={() => remove(product.id)}
                    danger
                  >
                    <Trash2 className="size-3.5" />
                  </SmallBtn>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {draft && (
        <ProductEditor
          draft={draft}
          setDraft={setDraft}
          userId={user.id}
          catalogId={catalog.id}
          catalogSlug={catalog.slug}
          currency={currency}
          categories={categories ?? []}
          nextPosition={products?.length ?? 0}
          onSaved={() => {
            setDraft(null);
            void refresh();
          }}
        />
      )}

      {checkoutProduct && (
        <CheckoutDesignEditor
          product={checkoutProduct}
          catalogId={catalog.id}
          storeName={catalog.store_name}
          currency={currency}
          onClose={() => {
            setCheckoutProduct(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function SmallBtn({
  children,
  onClick,
  label,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid size-8 place-items-center rounded-lg border border-border ${
        danger ? "text-destructive" : "text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ProductEditor({
  draft,
  setDraft,
  userId,
  catalogId,
  catalogSlug,
  currency,
  categories,
  nextPosition,
  onSaved,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  userId: string;
  catalogId: string;
  catalogSlug: string;
  currency: string;
  categories: { id: string; name: string }[];
  nextPosition: number;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });
  const [copiedLink, setCopiedLink] = useState<string | null>(null);

  /** Link direto do produto (ou de uma opção de valor), já salvo no catálogo. */
  const checkoutLink = (priceOptionId?: string) =>
    draft.id
      ? buildProductCheckoutUrl(
          typeof window === "undefined" ? "" : window.location.origin,
          catalogSlug,
          draft.id,
          priceOptionId,
        )
      : "";

  async function copyCheckoutLink(url: string, key: string) {
    if (!url) return;
    const ok = await writeToClipboard(url);
    if (!ok) {
      toast.error(t("panel.dashboard.copyError"));
      return;
    }
    setCopiedLink(key);
    toast.success(t("common.copied"));
    window.setTimeout(() => setCopiedLink((current) => (current === key ? null : current)), 2000);
  }

  async function handleDigitalFile(file: File | undefined) {
    if (!file) return;
    setUploadingFile(true);
    try {
      const meta = await uploadDigitalFile({
        file,
        userId,
        catalogId,
        productId: draft.id ?? null,
      });
      if (draft.digital_file_path && draft.digital_file_path !== meta.path) {
        await removeDigitalFile(draft.digital_file_path);
      }
      setDraft({
        ...draft,
        digital_file_path: meta.path,
        digital_file_name: meta.name,
        digital_file_mime: meta.mime,
        digital_file_size: meta.size,
        digital_file_checksum: meta.checksum,
      });
      toast.success(t("products.digital.fileUploaded"));
    } catch {
      toast.error(t("products.digital.fileUploadFailed"));
    } finally {
      setUploadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function clearDigitalFile() {
    await removeDigitalFile(draft.digital_file_path);
    setDraft({
      ...draft,
      digital_file_path: null,
      digital_file_name: null,
      digital_file_mime: null,
      digital_file_size: null,
      digital_file_checksum: null,
    });
  }

  function updateVariation(index: number, patch: Partial<VariationGroup>) {
    const next = draft.variations.map((v, i) => (i === index ? { ...v, ...patch } : v));
    set("variations", next);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const isPhysical = draft.product_type !== "digital";
    if (isPhysical) {
      const dims = {
        [t("products.validation.weightGrams")]: draft.weight_grams,
        [t("products.validation.lengthCm")]: draft.length_cm,
        [t("products.validation.widthCm")]: draft.width_cm,
        [t("products.validation.heightCm")]: draft.height_cm,
      };
      const missing = Object.entries(dims).find(([, v]) => !String(v).trim());
      if (missing) {
        toast.error(t("products.errors.physicalMissingField", { field: missing[0] }));
        return;
      }
    }
    const isLinkMode = !isPhysical && draft.digital_delivery_mode === "link";
    let externalUrl: string | null = null;
    if (isLinkMode) {
      const candidate = draft.digital_external_url.trim();
      let valid = false;
      try {
        const parsed = new URL(candidate);
        valid = parsed.protocol === "https:" && Boolean(parsed.hostname);
      } catch {
        valid = false;
      }
      if (!valid) {
        toast.error(t("products.digital.externalInvalid"));
        return;
      }
      externalUrl = candidate;
    }
    setSaving(true);
    const payload = {
      catalog_id: catalogId,
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      price: Number(draft.price.replace(",", ".")) || 0,
      sale_price: draft.sale_price ? Number(draft.sale_price.replace(",", ".")) : null,
      price_options: draft.price_options.filter((o) => o.label.trim() && o.price > 0),
      category_id: draft.category_id || null,
      images: draft.images,
      variations: draft.variations.filter((v) => v.name.trim() && v.options.length),
      available: draft.available,
      is_new: draft.is_new,
      is_bestseller: draft.is_bestseller,
      product_type: isPhysical ? "fisico" : "digital",
      additional_info: draft.additional_info.trim() || null,
      digital_delivery_mode: isPhysical ? "file" : isLinkMode ? "link" : "file",
      digital_external_url: externalUrl,
      digital_file_path: isPhysical || isLinkMode ? null : draft.digital_file_path,
      digital_file_name: isPhysical || isLinkMode ? null : draft.digital_file_name,
      digital_file_mime: isPhysical || isLinkMode ? null : draft.digital_file_mime,
      digital_file_size: isPhysical || isLinkMode ? null : draft.digital_file_size,
      digital_file_checksum: isPhysical || isLinkMode ? null : draft.digital_file_checksum,
      digital_instructions: isPhysical ? null : draft.digital_instructions.trim() || null,
      digital_link_ttl_minutes: isPhysical
        ? null
        : Math.min(10080, Math.max(5, Number(draft.digital_link_ttl_minutes) || 1440)),
      digital_max_downloads: isPhysical
        ? null
        : Math.min(100, Math.max(1, Number(draft.digital_max_downloads) || 5)),
      weight_grams:
        isPhysical && draft.weight_grams ? Number(draft.weight_grams.replace(",", ".")) : null,
      length_cm: isPhysical && draft.length_cm ? Number(draft.length_cm.replace(",", ".")) : null,
      width_cm: isPhysical && draft.width_cm ? Number(draft.width_cm.replace(",", ".")) : null,
      height_cm: isPhysical && draft.height_cm ? Number(draft.height_cm.replace(",", ".")) : null,
    };
    const { error } = draft.id
      ? await supabase
          .from("products")
          .update(payload as any)
          .eq("id", draft.id)
      : await supabase.from("products").insert({ ...payload, position: nextPosition } as any);
    setSaving(false);
    if (error) {
      toast.error(t("products.errors.saveFailed"));
      return;
    }
    toast.success(t("products.saved"));
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-foreground/40">
      <div className="mt-10 flex w-full max-w-[30rem] flex-col rounded-t-3xl bg-background">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-5 py-4">
          <h2 className="truncate text-lg font-bold text-foreground">
            {draft.id ? t("products.editor.titleEdit") : t("products.editor.titleNew")}
          </h2>
          <button
            onClick={() => setDraft(null)}
            aria-label={t("products.editor.close")}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <form onSubmit={save} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div>
            <label className="text-sm font-semibold text-foreground">
              {t("products.editor.photos")}
            </label>
            <div className="mt-2">
              <ImageUploader
                userId={userId}
                value={draft.images}
                onChange={(v) => set("images", v)}
                max={30}
                label={t("products.editor.photo")}
              />
            </div>
          </div>

          <input
            required
            placeholder={t("products.editor.namePlaceholder")}
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            className="input-base"
          />

          <textarea
            placeholder={t("products.editor.descriptionPlaceholder")}
            rows={3}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            className="input-base resize-none"
          />

          <textarea
            placeholder={t("products.editor.additionalInfoPlaceholder")}
            rows={2}
            value={draft.additional_info}
            onChange={(e) => set("additional_info", e.target.value)}
            className="input-base resize-none"
          />

          <div className="grid grid-cols-2 gap-3">
            <input
              inputMode="decimal"
              placeholder={t("products.editor.pricePlaceholder", { currency })}
              value={draft.price}
              onChange={(e) => set("price", e.target.value)}
              className="input-base"
            />
            <input
              inputMode="decimal"
              placeholder={t("products.editor.salePricePlaceholder", { currency })}
              value={draft.sale_price}
              onChange={(e) => set("sale_price", e.target.value)}
              className="input-base"
            />
          </div>

          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-foreground">
              {t("products.editor.priceOptionsTitle", { currency })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("products.editor.priceOptionsHint", { symbol: getCurrencySymbol(currency) })}
            </p>
            <div className="mt-3 space-y-2">
              {draft.price_options.map((opt, index) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <input
                    placeholder={t("products.editor.optionNamePlaceholder")}
                    value={opt.label}
                    onChange={(e) => {
                      const next = draft.price_options.map((o, i) =>
                        i === index ? { ...o, label: e.target.value } : o,
                      );
                      set("price_options", next);
                    }}
                    className="input-base min-w-0 flex-1 py-2 text-sm"
                  />
                  <input
                    inputMode="decimal"
                    placeholder={t("products.editor.optionPricePlaceholder")}
                    value={opt.price === 0 ? "" : String(opt.price)}
                    onChange={(e) => {
                      const val = Number(e.target.value.replace(",", ".")) || 0;
                      const next = draft.price_options.map((o, i) =>
                        i === index ? { ...o, price: val } : o,
                      );
                      set("price_options", next);
                    }}
                    className="input-base w-24 py-2 text-sm"
                  />
                  <button
                    type="button"
                    aria-label={t("products.editor.copyValueLink")}
                    title={t("products.editor.copyValueLink")}
                    disabled={!draft.id}
                    onClick={() => void copyCheckoutLink(checkoutLink(opt.id), opt.id)}
                    className="grid size-9 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground disabled:opacity-40"
                  >
                    {copiedLink === opt.id ? (
                      <Check className="size-4 text-green-600" />
                    ) : (
                      <Link2 className="size-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={t("products.editor.removeOption")}
                    onClick={() =>
                      set(
                        "price_options",
                        draft.price_options.filter((_, i) => i !== index),
                      )
                    }
                    className="grid size-9 shrink-0 place-items-center rounded-xl border border-border text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() =>
                set("price_options", [
                  ...draft.price_options,
                  { id: crypto.randomUUID(), label: "", price: 0 },
                ])
              }
              className="mt-3 w-full rounded-xl border border-dashed border-border py-2.5 text-sm font-semibold text-muted-foreground"
            >
              {t("products.editor.addOption")}
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-muted/30 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Link2 className="size-4" /> {t("products.editor.checkoutLinksTitle")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("products.editor.checkoutLinksHint")}
            </p>
            {!draft.id ? (
              <p className="mt-3 text-xs font-medium text-muted-foreground">
                {t("products.editor.saveToGenerateLink")}
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate text-xs font-medium text-foreground">
                    {t("products.editor.productLinkLabel")}
                  </span>
                  <input
                    readOnly
                    aria-label={t("products.editor.copyProductLink")}
                    value={checkoutLink()}
                    onFocus={(e) => e.currentTarget.select()}
                    className="input-base min-w-0 flex-1 py-2 text-xs"
                  />
                  <button
                    type="button"
                    aria-label={t("products.editor.copyProductLink")}
                    title={t("products.editor.copyProductLink")}
                    onClick={() => void copyCheckoutLink(checkoutLink(), "product")}
                    className="grid size-9 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground"
                  >
                    {copiedLink === "product" ? (
                      <Check className="size-4 text-green-600" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                </div>
                {draft.price_options.map((opt) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-xs font-medium text-foreground">
                      {opt.label.trim() || "—"}
                    </span>
                    <input
                      readOnly
                      aria-label={t("products.editor.copyValueLink")}
                      value={checkoutLink(opt.id)}
                      onFocus={(e) => e.currentTarget.select()}
                      className="input-base min-w-0 flex-1 py-2 text-xs"
                    />
                    <button
                      type="button"
                      aria-label={t("products.editor.copyValueLink")}
                      title={t("products.editor.copyValueLink")}
                      onClick={() => void copyCheckoutLink(checkoutLink(opt.id), opt.id)}
                      className="grid size-9 shrink-0 place-items-center rounded-xl border border-border text-muted-foreground"
                    >
                      {copiedLink === opt.id ? (
                        <Check className="size-4 text-green-600" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <select
            value={draft.category_id}
            onChange={(e) => set("category_id", e.target.value)}
            className="input-base"
          >
            <option value="">{t("products.editor.noCategory")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-foreground">
              {t("products.editor.productType")}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => set("product_type", "fisico")}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  draft.product_type === "fisico"
                    ? "border-[var(--shop-primary)] bg-[var(--shop-accent)] text-foreground"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {t("products.editor.physical")}
              </button>
              <button
                type="button"
                onClick={() => set("product_type", "digital")}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  draft.product_type === "digital"
                    ? "border-[var(--shop-primary)] bg-[var(--shop-accent)] text-foreground"
                    : "border-border bg-card text-muted-foreground"
                }`}
              >
                {t("products.editor.digital")}
              </button>
            </div>
          </div>

          {draft.product_type === "digital" && (
            <div className="space-y-3 rounded-2xl border border-border p-4">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t("products.digital.modeTitle")}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => set("digital_delivery_mode", "file")}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                      draft.digital_delivery_mode === "file"
                        ? "border-[var(--shop-primary)] bg-[var(--shop-accent)] text-foreground"
                        : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {t("products.digital.modeFile")}
                  </button>
                  <button
                    type="button"
                    onClick={() => set("digital_delivery_mode", "link")}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                      draft.digital_delivery_mode === "link"
                        ? "border-[var(--shop-primary)] bg-[var(--shop-accent)] text-foreground"
                        : "border-border bg-card text-muted-foreground"
                    }`}
                  >
                    {t("products.digital.modeLink")}
                  </button>
                </div>
              </div>

              {draft.digital_delivery_mode === "file" && (
              <>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {t("products.digital.fileTitle")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("products.digital.fileHint")}
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.zip,.7z,.rar,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mp3,.m4a"
                onChange={(e) => void handleDigitalFile(e.target.files?.[0])}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploadingFile}
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-xl border border-dashed border-border py-3 text-sm font-semibold text-muted-foreground disabled:opacity-60"
              >
                {uploadingFile
                  ? t("products.digital.uploading")
                  : draft.digital_file_name
                    ? t("products.digital.replaceFile")
                    : t("products.digital.chooseFile")}
              </button>

              {draft.digital_file_name && (
                <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {draft.digital_file_name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(draft.digital_file_size)}
                      {draft.digital_file_mime ? ` · ${draft.digital_file_mime}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={t("products.digital.removeFile")}
                    onClick={() => void clearDigitalFile()}
                    className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )}
              </>
              )}

              {draft.digital_delivery_mode === "link" && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">
                    {t("products.digital.externalTitle")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("products.digital.externalHint")}
                  </p>
                  <input
                    type="url"
                    inputMode="url"
                    placeholder={t("products.digital.externalPlaceholder")}
                    value={draft.digital_external_url}
                    onChange={(e) => set("digital_external_url", e.target.value)}
                    className="input-base"
                  />
                </div>
              )}

              <textarea
                rows={2}
                placeholder={t("products.digital.instructionsPlaceholder")}
                value={draft.digital_instructions}
                onChange={(e) => set("digital_instructions", e.target.value)}
                className="input-base resize-none"
              />

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-foreground">
                    {t("products.digital.ttlLabel")}
                  </span>
                  <input
                    type="number"
                    min={5}
                    max={10080}
                    value={draft.digital_link_ttl_minutes}
                    onChange={(e) => set("digital_link_ttl_minutes", e.target.value)}
                    className="input-base"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-foreground">
                    {t("products.digital.maxDownloadsLabel")}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draft.digital_max_downloads}
                    onChange={(e) => set("digital_max_downloads", e.target.value)}
                    className="input-base"
                  />
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("products.digital.limitsHint")}
              </p>
            </div>
          )}

          {draft.product_type !== "digital" && (
            <div className="rounded-2xl border border-border p-4">
              <p className="text-sm font-semibold text-foreground">
                {t("products.editor.shippingTitle")}
              </p>
              <p className="text-xs text-muted-foreground">{t("products.editor.shippingHint")}</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <input
                  inputMode="decimal"
                  placeholder={t("products.editor.weightPlaceholder")}
                  value={draft.weight_grams}
                  onChange={(e) => set("weight_grams", e.target.value)}
                  className="input-base"
                />
                <input
                  inputMode="decimal"
                  placeholder={t("products.editor.lengthPlaceholder")}
                  value={draft.length_cm}
                  onChange={(e) => set("length_cm", e.target.value)}
                  className="input-base"
                />
                <input
                  inputMode="decimal"
                  placeholder={t("products.editor.widthPlaceholder")}
                  value={draft.width_cm}
                  onChange={(e) => set("width_cm", e.target.value)}
                  className="input-base"
                />
                <input
                  inputMode="decimal"
                  placeholder={t("products.editor.heightPlaceholder")}
                  value={draft.height_cm}
                  onChange={(e) => set("height_cm", e.target.value)}
                  className="input-base"
                />
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-foreground">
              {t("products.editor.variationsTitle")}
            </p>
            <p className="text-xs text-muted-foreground">{t("products.editor.variationsHint")}</p>
            <div className="mt-3 space-y-3">
              {draft.variations.map((group, index) => (
                <div key={index} className="space-y-2 rounded-xl bg-muted/60 p-3">
                  <div className="flex gap-2">
                    <input
                      placeholder={t("products.editor.variationTypePlaceholder")}
                      value={group.name}
                      onChange={(e) => updateVariation(index, { name: e.target.value })}
                      className="input-base min-w-0 flex-1 py-2.5 text-sm"
                    />
                    <button
                      type="button"
                      aria-label={t("products.editor.removeVariation")}
                      onClick={() =>
                        set(
                          "variations",
                          draft.variations.filter((_, i) => i !== index),
                        )
                      }
                      className="grid size-10 shrink-0 place-items-center rounded-xl border border-border text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <input
                    placeholder={t("products.editor.variationOptionsPlaceholder")}
                    value={group.options.join(", ")}
                    onChange={(e) =>
                      updateVariation(index, {
                        options: e.target.value
                          .split(",")
                          .map((o) => o.trim())
                          .filter(Boolean),
                      })
                    }
                    className="input-base py-2.5 text-sm"
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => set("variations", [...draft.variations, { name: "", options: [] }])}
              className="mt-3 w-full rounded-xl border border-dashed border-border py-2.5 text-sm font-semibold text-muted-foreground"
            >
              {t("products.editor.addVariation")}
            </button>
          </div>

          <Toggle
            label={t("products.editor.available")}
            checked={draft.available}
            onChange={(v) => set("available", v)}
          />
          <Toggle
            label={t("products.editor.isNew")}
            checked={draft.is_new}
            onChange={(v) => set("is_new", v)}
          />
          <Toggle
            label={t("products.editor.bestseller")}
            checked={draft.is_bestseller}
            onChange={(v) => set("is_bestseller", v)}
          />

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {t("products.editor.save")}
          </button>
        </form>
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between rounded-2xl border border-border px-4 py-3"
    >
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span
        className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-primary" : "bg-muted"}`}
      >
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-card transition-all ${
            checked ? "left-[1.375rem]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
