import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, Loader2, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { CartIcon } from "@/components/CartIcons";
import { useAuth } from "@/hooks/useAuth";
import {
  buildWhatsappMessage,
  finalPrice,
  formatBRL,
  getFontFamily,
  whatsappLink,
  type Banner,
  type Catalog,
  type Category,
  type Product,
} from "@/lib/catalog";

export const Route = createFileRoute("/c/$slug")({
  head: ({ params }) => ({
    meta: [
      { title: `Catálogo ${params.slug} — Vitrine Criativa` },
      {
        name: "description",
        content: "Escolha seus produtos e finalize o pedido direto pelo WhatsApp.",
      },
      { property: "og:title", content: "Catálogo digital — Vitrine Criativa" },
      {
        property: "og:description",
        content: "Escolha seus produtos e finalize o pedido direto pelo WhatsApp.",
      },
    ],
  }),
  component: PublicCatalog,
});

type CartItem = {
  key: string;
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  variation?: string | undefined;
  image?: string | undefined;
};

const filters = ["Todos", "Novidades", "Mais vendidos", "Promoções"] as const;

const LOGO_SIZES: Record<string, string> = {
  sm: "size-12",
  md: "size-16",
  lg: "size-24",
};

function PublicCatalog() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const [filter, setFilter] = useState<string>("Todos");
  const [selected, setSelected] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartBump, setCartBump] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["public-catalog", slug],
    queryFn: async () => {
      const { data: catalog, error } = await supabase
        .from("catalogs")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      if (!catalog) return null;
      const [{ data: categories }, { data: products }, { data: banners }] = await Promise.all([
        supabase.from("categories").select("*").eq("catalog_id", catalog.id).order("position"),
        supabase
          .from("products")
          .select("*")
          .eq("catalog_id", catalog.id)
          .order("position")
          .order("created_at"),
        supabase
          .from("banners")
          .select("*")
          .eq("catalog_id", catalog.id)
          .order("position"),
      ]);
      return {
        catalog: catalog as Catalog,
        categories: (categories ?? []) as Category[],
        products: (products ?? []) as unknown as Product[],
        banners: (banners ?? []) as Banner[],
      };
    },
  });

  const catalog = data?.catalog;

  useEffect(() => {
    if (!catalog) return;
    if (user && user.id === catalog.user_id) return;
    const visitKey = `vc_visit_${catalog.id}`;
    try {
      const stored = localStorage.getItem(visitKey);
      if (stored) {
        const ts = Number(stored);
        if (Date.now() - ts < 30 * 60 * 1000) return;
      }
    } catch {
      /* ignore */
    }
    supabase
      .from("catalog_visits")
      .insert({ catalog_id: catalog.id })
      .then(() => {
        try {
          localStorage.setItem(visitKey, String(Date.now()));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {
        /* silent */
      });
  }, [catalog, user]);

  const products = useMemo(() => {
    const all = data?.products ?? [];
    if (filter === "Todos") return all;
    if (filter === "Novidades") return all.filter((p) => p.is_new);
    if (filter === "Mais vendidos") return all.filter((p) => p.is_bestseller);
    if (filter === "Promoções") return all.filter((p) => p.sale_price != null && p.sale_price > 0);
    return all.filter((p) => p.category_id === filter);
  }, [data, filter]);

  const total = cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);

  const addToCart = useCallback((item: CartItem) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.key === item.key);
      if (existing) {
        return prev.map((i) =>
          i.key === item.key ? { ...i, quantity: i.quantity + item.quantity } : i,
        );
      }
      return [...prev, item];
    });
    setCartBump((b) => b + 1);
    setSelected(null);
    toast.success("Adicionado ao carrinho");
  }, []);

  const changeQty = useCallback((key: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.key === key ? { ...i, quantity: i.quantity + delta } : i))
        .filter((i) => i.quantity > 0),
    );
  }, []);

  const removeItem = useCallback((key: string) => {
    setCart((prev) => prev.filter((i) => i.key !== key));
  }, []);

  const finishOrder = useCallback(
    (customerName: string, customerPhone: string, note: string) => {
      if (!catalog) return;
      if (!catalog.whatsapp) {
        toast.error("Esta loja ainda não cadastrou o WhatsApp.");
        return;
      }

      if (customerName.trim()) {
        supabase
          .from("orders")
          .insert({
            catalog_id: catalog.id,
            customer_name: customerName.trim(),
            customer_phone: customerPhone.trim() || null,
            items: cart.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              variation: i.variation,
            })),
            note: note.trim() || null,
            total,
            status: "pending",
          })
          .then(() => {})
          .catch(() => {});
      }

      const message = buildWhatsappMessage({
        storeName: catalog.store_name,
        items: cart.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          variation: i.variation,
        })),
        total,
        note: customerName.trim() ? `Cliente: ${customerName.trim()}` : undefined,
      });

      window.open(whatsappLink(catalog.whatsapp, message), "_blank");
      setCart([]);
      setCartOpen(false);
    },
    [catalog, cart, total],
  );

  if (isLoading) {
    return (
      <div className="app-shell grid place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app-shell grid place-items-center px-6 text-center">
        <p className="text-sm text-muted-foreground">Catálogo não encontrado.</p>
      </div>
    );
  }

  const { catalog: loadedCatalog, categories, banners } = data;
  const logoSizeClass = LOGO_SIZES[loadedCatalog.logo_size] ?? "size-16";
  const logoJustify =
    loadedCatalog.logo_position === "left"
      ? "flex-start"
      : loadedCatalog.logo_position === "right"
        ? "flex-end"
        : "center";

  const theme = {
    "--shop-primary": loadedCatalog.primary_color,
    "--shop-accent": loadedCatalog.accent_color,
  } as React.CSSProperties;

  return (
    <div className="app-shell pb-28" style={theme}>
      <header className="relative">
        <div
          className="h-32 w-full bg-cover bg-center"
          style={{
            backgroundColor: loadedCatalog.accent_color,
            backgroundImage: loadedCatalog.cover_url
              ? `url(${loadedCatalog.cover_url})`
              : undefined,
          }}
        />
        <div className="px-5">
          <div
            className="-mt-8 flex items-end gap-3"
            style={{ justifyContent: logoJustify }}
          >
            <div
              className={`${logoSizeClass} shrink-0 overflow-hidden rounded-2xl border-4 border-background bg-muted`}
              style={{ backgroundColor: loadedCatalog.accent_color }}
            >
              {loadedCatalog.logo_url && (
                <img
                  src={loadedCatalog.logo_url}
                  alt={loadedCatalog.store_name}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
          </div>
          <h1
            className="mt-3 text-2xl font-bold text-foreground"
            style={{ fontFamily: getFontFamily(loadedCatalog.store_font) }}
          >
            {loadedCatalog.store_name}
          </h1>
          <p className="text-sm text-muted-foreground">Peça pelo WhatsApp, sem criar conta.</p>
        </div>
      </header>

      {loadedCatalog.banner_enabled && banners.length > 0 && (
        <BannerCarousel
          banners={banners}
          autoplay={loadedCatalog.banner_autoplay}
          interval={loadedCatalog.banner_interval}
          indicators={loadedCatalog.banner_indicators}
        />
      )}

      <nav className="no-scrollbar mt-5 flex gap-2 overflow-x-auto px-5">
        {[...filters, ...categories.map((c) => c.name)].map((label, i) => {
          const value = i < filters.length ? label : categories[i - filters.length]!.id;
          const active = filter === value;
          return (
            <button
              key={label + i}
              onClick={() => setFilter(value)}
              className="shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition"
              style={
                active
                  ? {
                      background: loadedCatalog.primary_color,
                      color: "#fff",
                      borderColor: loadedCatalog.primary_color,
                    }
                  : {
                      borderColor: "var(--color-border)",
                      color: "var(--color-muted-foreground)",
                    }
              }
            >
              {label}
            </button>
          );
        })}
      </nav>

      <section className="mt-5 grid grid-cols-2 gap-3 px-5">
        {products.length === 0 && (
          <p className="col-span-2 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhum produto nesta seção.
          </p>
        )}
        {products.map((product) => (
          <article
            key={product.id}
            className="overflow-hidden rounded-2xl border border-border bg-card"
          >
            <button onClick={() => setSelected(product)} className="block w-full text-left">
              <div className="aspect-square w-full bg-muted">
                {product.images?.[0] && (
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="p-3">
                <p className="line-clamp-2 text-sm font-semibold text-foreground">{product.name}</p>
                <p className="mt-1 text-sm">
                  {product.sale_price ? (
                    <>
                      <span className="text-xs text-muted-foreground line-through">
                        {formatBRL(Number(product.price))}
                      </span>{" "}
                      <span className="font-bold" style={{ color: loadedCatalog.primary_color }}>
                        {formatBRL(Number(product.sale_price))}
                      </span>
                    </>
                  ) : (
                    <span className="font-bold text-foreground">
                      {formatBRL(Number(product.price))}
                    </span>
                  )}
                </p>
              </div>
            </button>
            <div className="px-3 pb-3">
              <button
                disabled={!product.available}
                onClick={() => setSelected(product)}
                className="w-full rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: loadedCatalog.primary_color }}
              >
                {product.available ? "+ Adicionar" : "Esgotado"}
              </button>
            </div>
          </article>
        ))}
      </section>

      {count > 0 && (
        <button
          key={cartBump}
          onClick={() => setCartOpen(true)}
          className="cart-bump fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-full px-5 py-4 text-white shadow-xl"
          style={{ background: loadedCatalog.primary_color }}
        >
          <CartIcon style={loadedCatalog.cart_style} className="size-5" />
          <span className="text-sm font-semibold">
            {count} {count === 1 ? "item" : "itens"}
          </span>
          <span className="font-bold">{formatBRL(total)}</span>
        </button>
      )}

      {selected && (
        <ProductSheet
          product={selected}
          primary={loadedCatalog.primary_color}
          onClose={() => setSelected(null)}
          onAdd={addToCart}
        />
      )}

      {cartOpen && (
        <CartSheet
          items={cart}
          total={total}
          primary={loadedCatalog.primary_color}
          onClose={() => setCartOpen(false)}
          onChangeQty={changeQty}
          onRemove={removeItem}
          onFinish={finishOrder}
        />
      )}
    </div>
  );
}

function BannerCarousel({
  banners,
  autoplay,
  interval,
  indicators,
}: {
  banners: Banner[];
  autoplay: boolean;
  interval: number;
  indicators: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (!autoplay || paused || banners.length <= 1) return;
    const ms = Math.max(2, interval) * 1000;
    const id = window.setInterval(() => {
      const el = ref.current;
      if (!el) return;
      const next = (activeIdx + 1) % banners.length;
      el.scrollTo({ left: el.clientWidth * next, behavior: "smooth" });
      setActiveIdx(next);
    }, ms);
    return () => clearInterval(id);
  }, [autoplay, paused, interval, activeIdx, banners.length]);

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIdx(idx);
  }

  return (
    <div
      className="px-5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setTimeout(() => setPaused(false), 200)}
    >
      <div
        ref={ref}
        onScroll={onScroll}
        className="no-scrollbar mt-4 flex snap-x snap-mandatory gap-3 overflow-x-auto rounded-2xl"
      >
        {banners.map((b) => (
          <div key={b.id} className="w-full shrink-0 snap-center">
            {b.href ? (
              <a href={b.href} target="_blank" rel="noopener noreferrer">
                <img
                  src={b.image_url}
                  alt=""
                  className="h-48 w-full rounded-2xl object-cover"
                />
              </a>
            ) : (
              <img
                src={b.image_url}
                alt=""
                className="h-48 w-full rounded-2xl object-cover"
              />
            )}
          </div>
        ))}
      </div>
      {indicators && banners.length > 1 && (
        <div className="mt-3 flex justify-center gap-2">
          {banners.map((b, i) => (
            <span
              key={b.id}
              className="inline-block size-2 rounded-full transition-colors"
              style={{
                backgroundColor:
                  i === activeIdx ? "var(--shop-primary)" : "var(--color-border)",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProductSheet({
  product,
  primary,
  onClose,
  onAdd,
}: {
  product: Product;
  primary: string;
  onClose: () => void;
  onAdd: (item: CartItem) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const price = finalPrice(product);

  function handleAdd() {
    const missing = (product.variations ?? []).find((g) => g.options.length && !choices[g.name]);
    if (missing) {
      toast.error(`Escolha: ${missing.name}`);
      return;
    }
    const variation = Object.entries(choices)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
    onAdd({
      key: `${product.id}-${variation}`,
      productId: product.id,
      name: product.name,
      unitPrice: price,
      quantity,
      variation: variation || undefined,
      image: product.images?.[0],
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-foreground/40">
      <div className="mt-8 flex w-full max-w-[30rem] flex-col overflow-hidden rounded-t-3xl bg-background">
        <div className="relative">
          <div className="aspect-square max-h-[45vh] w-full bg-muted">
            {product.images?.[0] && (
              <img src={product.images[0]} alt={product.name} className="h-full w-full object-cover" />
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Voltar"
            className="absolute left-4 top-4 grid size-10 place-items-center rounded-full bg-background/90"
          >
            <ChevronLeft className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {product.images.length > 1 && (
            <div className="no-scrollbar mb-4 flex gap-2 overflow-x-auto">
              {product.images.slice(1).map((url) => (
                <img
                  key={url}
                  src={url}
                  alt={product.name}
                  className="size-16 shrink-0 rounded-xl object-cover"
                />
              ))}
            </div>
          )}

          <h2 className="text-xl font-bold text-foreground">{product.name}</h2>
          <p className="mt-1 text-lg font-bold" style={{ color: primary }}>
            {formatBRL(price)}
            {product.sale_price != null && product.sale_price > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground line-through">
                {formatBRL(Number(product.price))}
              </span>
            )}
          </p>
          {product.description && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          )}

          {(product.variations ?? []).map((group) => (
            <div key={group.name} className="mt-5">
              <p className="text-sm font-semibold text-foreground">{group.name}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.options.map((option) => {
                  const active = choices[group.name] === option;
                  return (
                    <button
                      key={option}
                      onClick={() => setChoices({ ...choices, [group.name]: option })}
                      className="rounded-full border px-4 py-2 text-sm font-medium"
                      style={
                        active
                          ? { background: primary, color: "#fff", borderColor: primary }
                          : { borderColor: "var(--color-border)" }
                      }
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mt-6 flex items-center gap-4">
            <span className="text-sm font-semibold text-foreground">Quantidade</span>
            <div className="flex items-center gap-3 rounded-full border border-border px-3 py-1.5">
              <button onClick={() => setQuantity(Math.max(1, quantity - 1))} aria-label="Diminuir">
                <Minus className="size-4" />
              </button>
              <span className="w-6 text-center font-semibold">{quantity}</span>
              <button onClick={() => setQuantity(quantity + 1)} aria-label="Aumentar">
                <Plus className="size-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-border p-5">
          <button
            onClick={handleAdd}
            disabled={!product.available}
            className="w-full rounded-2xl py-4 font-semibold text-white disabled:opacity-50"
            style={{ background: primary }}
          >
            {product.available
              ? `Adicionar • ${formatBRL(price * quantity)}`
              : "Produto esgotado"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CartSheet({
  items,
  total,
  primary,
  onClose,
  onChangeQty,
  onRemove,
  onFinish,
}: {
  items: CartItem[];
  total: number;
  primary: string;
  onClose: () => void;
  onChangeQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onFinish: (name: string, phone: string, note: string) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [observation, setObservation] = useState("");

  function handleFinish() {
    if (!customerName.trim()) {
      toast.error("Informe seu nome para continuar.");
      return;
    }
    onFinish(customerName, customerPhone, observation);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-foreground/40">
      <div className="mt-16 flex w-full max-w-[30rem] flex-col rounded-t-3xl bg-background">
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-5 py-4">
          <h2 className="truncate text-lg font-bold text-foreground">Seu carrinho</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-9 shrink-0 place-items-center rounded-full border border-border"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
          {items.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">Carrinho vazio.</p>
          )}
          {items.map((item) => (
            <div key={item.key} className="flex gap-3 rounded-2xl border border-border bg-card p-3">
              <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                {item.image && (
                  <img src={item.image} alt={item.name} className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{item.name}</p>
                {item.variation && (
                  <p className="truncate text-xs text-muted-foreground">{item.variation}</p>
                )}
                <p className="text-sm font-semibold" style={{ color: primary }}>
                  {formatBRL(item.unitPrice * item.quantity)}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="flex items-center gap-3 rounded-full border border-border px-3 py-1">
                    <button onClick={() => onChangeQty(item.key, -1)} aria-label="Diminuir">
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-5 text-center text-sm font-semibold">{item.quantity}</span>
                    <button onClick={() => onChangeQty(item.key, 1)} aria-label="Aumentar">
                      <Plus className="size-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={() => onRemove(item.key)}
                    aria-label="Excluir item"
                    className="text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-border p-5">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Subtotal</span>
            <span>{formatBRL(total)}</span>
          </div>
          <div className="flex items-center justify-between text-base font-bold text-foreground">
            <span>Total</span>
            <span>{formatBRL(total)}</span>
          </div>

          {items.length > 0 && (
            <div className="space-y-3 rounded-2xl border border-border p-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-foreground">
                  Seu nome <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Ex: Maria"
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-foreground">
                  WhatsApp (opcional)
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="DDD + número"
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-foreground">
                  Observação (opcional)
                </label>
                <textarea
                  value={observation}
                  onChange={(e) => setObservation(e.target.value)}
                  placeholder="Alguma preferência ou informação extra..."
                  rows={2}
                  className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                />
              </div>
            </div>
          )}

          <button
            onClick={handleFinish}
            disabled={items.length === 0}
            className="w-full rounded-2xl py-4 font-semibold text-white disabled:opacity-50"
            style={{ background: primary }}
          >
            Finalizar pedido pelo WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}
