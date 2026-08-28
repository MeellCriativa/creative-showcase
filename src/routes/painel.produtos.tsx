import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { ImageUploader } from "@/components/ImageUploader";
import { useAuth } from "@/hooks/useAuth";
import { useCategories, useMyCatalog, useProducts } from "@/hooks/useCatalog";
import { useMetaConnection, useMetaMappings } from "@/hooks/useMetaCatalog";
import { formatBRL, type PriceOption, type Product, type VariationGroup } from "@/lib/catalog";
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
  weight_grams: "",
  length_cm: "",
  width_cm: "",
  height_cm: "",
};

function ProdutosPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: catalog } = useMyCatalog(user?.id);
  const { data: products, isLoading } = useProducts(catalog?.id);
  const { data: categories } = useCategories(catalog?.id);
  const { data: metaConn } = useMetaConnection(catalog?.id);
  const { data: metaMappings } = useMetaMappings(catalog?.id);
  const [draft, setDraft] = useState<Draft | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["products", catalog?.id] });

  const metaConnected = metaConn?.sync_status === "connected" || metaConn?.sync_status === "syncing";
  const mappingsByProduct = new Map((metaMappings ?? []).map((m) => [m.product_id, m.sync_state]));

  if (!catalog || !user) return <EmptyCatalog />;

  async function remove(id: string) {
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) toast.error("Erro ao excluir produto.");
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
          <h1 className="truncate text-2xl font-bold text-foreground">Produtos</h1>
          <p className="text-sm text-muted-foreground">{products?.length ?? 0} cadastrados</p>
        </div>
        <button
          onClick={() => setDraft({ ...emptyDraft })}
          className="flex shrink-0 items-center gap-1.5 rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
        >
          <Plus className="size-4" /> Novo
        </button>
      </header>

      <div className="mt-6 space-y-3">
        {isLoading && <Loader2 className="mx-auto size-5 animate-spin text-primary" />}
        {products?.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum produto ainda. Toque em “Novo” para começar.
          </p>
        )}
        {products?.map((product, index) => (
          <article
            key={product.id}
            className="flex gap-3 rounded-2xl border border-border bg-card p-3"
          >
            <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
              {product.images?.[0] && (
                <img src={product.images[0]} alt={product.name} className="h-full w-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-semibold text-foreground">{product.name}</p>
                {metaConnected && (
                  <span
                    className={`inline-block size-2 shrink-0 rounded-full ${
                      mappingsByProduct.get(product.id) === "synced"
                        ? "bg-green-500"
                        : mappingsByProduct.get(product.id) === "error"
                          ? "bg-red-500"
                          : mappingsByProduct.get(product.id) === "deleted"
                            ? "bg-orange-400"
                            : "bg-gray-300"
                    }`}
                    title={
                      mappingsByProduct.get(product.id) === "synced"
                        ? "Sincronizado"
                        : mappingsByProduct.get(product.id) === "error"
                          ? "Erro na sincronização"
                          : mappingsByProduct.get(product.id) === "deleted"
                            ? "Marcado para remoção"
                            : "Pendente"
                    }
                  />
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {product.price_options && product.price_options.length > 0 ? (
                  <span className="font-semibold text-primary">
                    {product.price_options.map((o) => formatBRL(o.price)).join(" / ")}
                  </span>
                ) : product.sale_price ? (
                  <>
                    <span className="line-through">{formatBRL(Number(product.price))}</span>{" "}
                    <span className="font-semibold text-primary">
                      {formatBRL(Number(product.sale_price))}
                    </span>
                  </>
                ) : (
                  formatBRL(Number(product.price))
                )}
              </p>
              {!product.available && (
                <span className="mt-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  Esgotado
                </span>
              )}
              <div className="mt-2 flex gap-1">
                <SmallBtn label="Subir" onClick={() => move(products, index, -1)}>
                  <ArrowUp className="size-3.5" />
                </SmallBtn>
                <SmallBtn label="Descer" onClick={() => move(products, index, 1)}>
                  <ArrowDown className="size-3.5" />
                </SmallBtn>
                <SmallBtn label="Editar" onClick={() => edit(product)}>
                  <Pencil className="size-3.5" />
                </SmallBtn>
                <SmallBtn label="Excluir" onClick={() => remove(product.id)} danger>
                  <Trash2 className="size-3.5" />
                </SmallBtn>
              </div>
            </div>
          </article>
        ))}
      </div>

      {draft && (
        <ProductEditor
          draft={draft}
          setDraft={setDraft}
          userId={user.id}
          catalogId={catalog.id}
          categories={categories ?? []}
          nextPosition={products?.length ?? 0}
          onSaved={() => {
            setDraft(null);
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
  categories,
  nextPosition,
  onSaved,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  userId: string;
  catalogId: string;
  categories: { id: string; name: string }[];
  nextPosition: number;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });

  function updateVariation(index: number, patch: Partial<VariationGroup>) {
    const next = draft.variations.map((v, i) => (i === index ? { ...v, ...patch } : v));
    set("variations", next);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
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
      weight_grams: draft.weight_grams ? Number(draft.weight_grams.replace(",", ".")) : null,
      length_cm: draft.length_cm ? Number(draft.length_cm.replace(",", ".")) : null,
      width_cm: draft.width_cm ? Number(draft.width_cm.replace(",", ".")) : null,
      height_cm: draft.height_cm ? Number(draft.height_cm.replace(",", ".")) : null,
    };
    const { error } = draft.id
      ? await supabase.from("products").update(payload as any).eq("id", draft.id)
      : await supabase.from("products").insert({ ...payload, position: nextPosition } as any);
    setSaving(false);
    if (error) {
      toast.error("Não foi possível salvar o produto.");
      return;
    }
    toast.success("Produto salvo!");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-foreground/40">
      <div className="mt-10 flex w-full max-w-[30rem] flex-col rounded-t-3xl bg-background">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-5 py-4">
          <h2 className="truncate text-lg font-bold text-foreground">
            {draft.id ? "Editar produto" : "Novo produto"}
          </h2>
          <button
            onClick={() => setDraft(null)}
            aria-label="Fechar"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <form onSubmit={save} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          <div>
            <label className="text-sm font-semibold text-foreground">Fotos</label>
            <div className="mt-2">
              <ImageUploader
                userId={userId}
                value={draft.images}
                onChange={(v) => set("images", v)}
                max={30}
                label="Foto"
              />
            </div>
          </div>

          <input
            required
            placeholder="Nome do produto"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            className="input-base"
          />

          <textarea
            placeholder="Descrição"
            rows={3}
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            className="input-base resize-none"
          />

          <div className="grid grid-cols-2 gap-3">
            <input
              inputMode="decimal"
              placeholder="Preço"
              value={draft.price}
              onChange={(e) => set("price", e.target.value)}
              className="input-base"
            />
            <input
              inputMode="decimal"
              placeholder="Promocional"
              value={draft.sale_price}
              onChange={(e) => set("sale_price", e.target.value)}
              className="input-base"
            />
          </div>

          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-foreground">Valores do produto</p>
            <p className="text-xs text-muted-foreground">
              Adicione opções de preço (ex.: Mini R$25, Médio R$35, Grande R$50)
            </p>
            <div className="mt-3 space-y-2">
              {draft.price_options.map((opt, index) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <input
                    placeholder="Nome (ex.: Mini)"
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
                    placeholder="Preço"
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
                    aria-label="Remover valor"
                    onClick={() =>
                      set("price_options", draft.price_options.filter((_, i) => i !== index))
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
              + Adicionar valor
            </button>
          </div>

          <select
            value={draft.category_id}
            onChange={(e) => set("category_id", e.target.value)}
            className="input-base"
          >
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-foreground">Dados de envio</p>
            <p className="text-xs text-muted-foreground">
              Usados para calcular o frete com Correios e transportadoras (via Melhor Envio).
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <input
                inputMode="decimal"
                placeholder="Peso (gramas)"
                value={draft.weight_grams}
                onChange={(e) => set("weight_grams", e.target.value)}
                className="input-base"
              />
              <input
                inputMode="decimal"
                placeholder="Comprimento (cm)"
                value={draft.length_cm}
                onChange={(e) => set("length_cm", e.target.value)}
                className="input-base"
              />
              <input
                inputMode="decimal"
                placeholder="Largura (cm)"
                value={draft.width_cm}
                onChange={(e) => set("width_cm", e.target.value)}
                className="input-base"
              />
              <input
                inputMode="decimal"
                placeholder="Altura (cm)"
                value={draft.height_cm}
                onChange={(e) => set("height_cm", e.target.value)}
                className="input-base"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-foreground">Variações</p>
            <p className="text-xs text-muted-foreground">Tamanho, cor, modelo, sabor…</p>
            <div className="mt-3 space-y-3">
              {draft.variations.map((group, index) => (
                <div key={index} className="space-y-2 rounded-xl bg-muted/60 p-3">
                  <div className="flex gap-2">
                    <input
                      placeholder="Tipo (ex.: Tamanho)"
                      value={group.name}
                      onChange={(e) => updateVariation(index, { name: e.target.value })}
                      className="input-base min-w-0 flex-1 py-2.5 text-sm"
                    />
                    <button
                      type="button"
                      aria-label="Remover variação"
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
                    placeholder="Opções separadas por vírgula (P, M, G)"
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
              + Adicionar variação
            </button>
          </div>

          <Toggle
            label="Produto disponível"
            checked={draft.available}
            onChange={(v) => set("available", v)}
          />
          <Toggle label="Novidade" checked={draft.is_new} onChange={(v) => set("is_new", v)} />
          <Toggle
            label="Mais vendido"
            checked={draft.is_bestseller}
            onChange={(v) => set("is_bestseller", v)}
          />

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-4 font-semibold text-primary-foreground disabled:opacity-60"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Salvar produto
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
