import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, LayoutGrid, Loader2, Minus, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase, getSupabaseError } from "@/integrations/supabase/client";
import { CartIcon } from "@/components/CartIcons";
import { useAuth } from "@/hooks/useAuth";
import {
  buildWhatsappMessage,
  finalPrice,
  formatBRL,
  getFontFamily,
  whatsappLink,
  PAYMENT_METHODS,
  DELIVERY_METHODS,
  formatCep,
  isValidCep,
  type Banner,
  type Catalog,
  type Category,
  type Product,
  type ShippingQuote,
  type CustomerAddress,
} from "@/lib/catalog";
import { quoteShipping } from "@/lib/shipping";

export const Route = createFileRoute("/c/$slug")({
  loader: async ({ params }) => {
    try {
      const { data: catalog } = await supabase
        .from("catalogs_public")
        .select("store_name, store_description, logo_url, cover_url")
        .eq("slug", params.slug)
        .maybeSingle();
      return { catalog };
    } catch {
      return { catalog: null };
    }
  },
  head: ({ params, loaderData }) => {
    const catalog = loaderData?.catalog;
    const title = catalog?.store_name
      ? `${catalog.store_name} — Vitrine Criativa`
      : `Catálogo ${params.slug} — Vitrine Criativa`;
    const description =
      catalog?.store_description ||
      "Escolha seus produtos e finalize o pedido direto pelo WhatsApp.";
    const ogImage = catalog?.cover_url || catalog?.logo_url;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: catalog?.store_name || title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        ...(ogImage
          ? [{ property: "og:image", content: ogImage }]
          : []),
        { name: "twitter:card", content: ogImage ? "summary_large_image" : "summary" },
      ],
    };
  },
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
  weight_grams?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
};

const filters = ["Todos", "Novidades", "Mais vendidos", "Promoções"] as const;

const LOGO_SIZES: Record<string, string> = {
  pequena: "size-12",
  medio: "size-16",
  grande: "size-36",
};

function PublicCatalog() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const [filter, setFilter] = useState<string>("Todos");
  const [selected, setSelected] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartBump, setCartBump] = useState(0);
  const [entered, setEntered] = useState(false);

  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["public-catalog", slug],
    queryFn: async () => {
      const connError = getSupabaseError();
      if (connError) {
        console.error("[catalog] supabase init error:", connError);
        throw new Error("Não foi possível conectar ao servidor. Verifique a configuração do Supabase.");
      }

      const { data: catalog, error } = await supabase
        .from("catalogs_public")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (error) {
        console.error("[catalog] query error:", JSON.stringify(error));
        throw error;
      }
      if (!catalog) {
        console.warn("[catalog] no catalog found for slug:", slug);
        return null;
      }
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
        catalog: catalog as unknown as Catalog,
        categories: (categories ?? []) as Category[],
        products: (products ?? []) as unknown as Product[],
        banners: (banners ?? []) as Banner[],
      };
    },
    retry: 1,
    staleTime: 30_000,
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
      .then(() => {}, () => {
        /* silent */
      });
  }, [catalog, user]);

  useEffect(() => {
    if (!catalog) return;
    const ogImage = catalog.logo_url || catalog.cover_url;
    const setMeta = (property: string, content: string) => {
      let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("property", property);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    setMeta("og:title", catalog.store_name);
    setMeta("og:description", catalog.store_description || `Catálogo ${catalog.store_name} — Vitrine Criativa`);
    if (ogImage) setMeta("og:image", ogImage);
    document.title = `${catalog.store_name} — Vitrine Criativa`;
    return () => {
      setMeta("og:title", "Catálogo digital — Vitrine Criativa");
      setMeta("og:description", "Escolha seus produtos e finalize o pedido direto pelo WhatsApp.");
      document.title = "Vitrine Criativa";
    };
  }, [catalog]);

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
    (
      customerName: string,
      customerPhone: string,
      note: string,
      shipping: {
        deliveryMethod: string;
        shippingZip?: string;
        address?: CustomerAddress;
        quote?: ShippingQuote | null;
        shippingCost: number;
      },
    ) => {
      if (!catalog) return;
      if (!catalog.whatsapp) {
        toast.error("Esta loja ainda não cadastrou o WhatsApp.");
        return;
      }

      const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
      const grandTotal = subtotal + (shipping.shippingCost || 0);

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
              weight_grams: i.weight_grams ?? null,
              length_cm: i.length_cm ?? null,
              width_cm: i.width_cm ?? null,
              height_cm: i.height_cm ?? null,
            })),
            note: note.trim() || null,
            subtotal,
            total: grandTotal,
            status: "novo",
            delivery_method: shipping.deliveryMethod || null,
            shipping_zip: shipping.shippingZip ? shipping.shippingZip.replace(/\D/g, "") : null,
            shipping_service: shipping.quote?.serviceId || null,
            shipping_service_name: shipping.quote?.name || null,
            shipping_cost: shipping.shippingCost || null,
            shipping_eta_days: shipping.quote?.delivery_min ?? null,
            shipping_eta_text: shipping.quote?.delivery_text || null,
            customer_street: shipping.address?.street || null,
            customer_number: shipping.address?.number || null,
            customer_complement: shipping.address?.complement || null,
            customer_district: shipping.address?.district || null,
            customer_city: shipping.address?.city || null,
            customer_state: shipping.address?.state || null,
          } as any)
          .then(() => {}, () => {});
      }

      const customerLine = customerName.trim()
        ? `Cliente: ${customerName.trim()}${customerPhone.trim() ? ` | Tel: ${customerPhone.trim()}` : ""}${note.trim() ? `\nObs: ${note.trim()}` : ""}`
        : note.trim() || undefined;

      const shipAddress = shipping.address;
      const message = buildWhatsappMessage({
        storeName: catalog.store_name,
        items: cart.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          variation: i.variation,
        })),
        subtotal,
        total: grandTotal,
        shipping: {
          ...(shipping.deliveryMethod ? { deliveryMethod: shipping.deliveryMethod } : {}),
          ...(shipping.quote?.name ? { serviceName: shipping.quote.name } : {}),
          ...(shipping.shippingCost ? { cost: shipping.shippingCost } : {}),
          ...(shipping.quote?.delivery_text
            ? { etaText: shipping.quote.delivery_text }
            : shipping.deliveryMethod === "local_delivery"
              ? { etaText: "Combino a data com você" }
              : {}),
          ...(shipAddress
            ? {
                address: {
                  street: shipAddress.street,
                  number: shipAddress.number,
                  complement: shipAddress.complement,
                  district: shipAddress.district,
                  city: shipAddress.city,
                  state: shipAddress.state,
                  ...(shipping.shippingZip
                    ? { zip: shipping.shippingZip.replace(/\D/g, "") }
                    : {}),
                },
              }
            : {}),
        },
        note: customerLine,
      });

      window.open(whatsappLink(catalog.whatsapp, message), "_blank");
      setCart([]);
      setCartOpen(false);
    },
    [catalog, cart],
  );

  if (isLoading) {
    return (
      <div className="app-shell grid place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="app-shell grid place-items-center px-6 text-center">
        <p className="text-sm text-muted-foreground">
          Não foi possível carregar o catálogo. Tente novamente mais tarde.
        </p>
        <p className="mt-4 w-full max-w-md break-all rounded-xl bg-muted p-3 text-xs text-muted-foreground">
          {queryError.message}
        </p>
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
  const logoSizeClass = LOGO_SIZES[loadedCatalog.logo_size ?? "medio"] ?? "size-16";
  const logoJustify =
    loadedCatalog.logo_position === "esquerda"
      ? "flex-start"
      : loadedCatalog.logo_position === "direita"
        ? "flex-end"
        : "center";

  const primary = loadedCatalog.primary_color ?? "#8b5cf6";
  const accent = loadedCatalog.accent_color ?? "#f3eefc";
  const bgColor = loadedCatalog.background_color ?? "#FFFFFF";
  const whatsappColor = loadedCatalog.whatsapp_button_color ?? "#8b5cf6";
  const isOwner = user && user.id === loadedCatalog.user_id;
  const activePayments = Array.isArray(loadedCatalog.payment_methods)
    ? PAYMENT_METHODS.filter((m) => (loadedCatalog.payment_methods as string[]).includes(m.key))
    : [];

  const theme = {
    "--shop-primary": primary,
    "--shop-accent": accent,
    "--shop-bg": bgColor,
  } as React.CSSProperties;

  if (!entered) {
    return (
      <WelcomePage
        catalog={loadedCatalog}
        theme={theme}
        logoSizeClass={logoSizeClass}
        logoJustify={logoJustify}
        onEnter={() => setEntered(true)}
      />
    );
  }

  return (
    <div className="app-shell pb-28" style={{ ...theme, backgroundColor: bgColor }}>
      <header className="relative">
        <div
          className="h-36 w-full bg-cover bg-center"
          style={{
            backgroundColor: loadedCatalog.accent_color ?? "#f3eefc",
            backgroundImage: loadedCatalog.cover_url
              ? `url(${loadedCatalog.cover_url})`
              : undefined,
          }}
        >
          <div className="cover-glass h-full w-full" />
        </div>
        <div className="px-5">
          <div
            className="-mt-10 flex items-end gap-3"
            style={{ justifyContent: logoJustify }}
          >
            <div
              className={`${logoSizeClass} shrink-0 overflow-hidden rounded-full border-4 border-background bg-muted`}
              style={{ backgroundColor: loadedCatalog.accent_color ?? "#f3eefc" }}
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
            className="mt-3 text-2xl font-bold text-foreground text-center"
            style={{
              fontFamily: getFontFamily(loadedCatalog.store_font ?? "moderna"),
              color: loadedCatalog.primary_color ?? "#8b5cf6",
            }}
          >
            {loadedCatalog.store_name}
          </h1>
          <div className="mt-2 flex items-center justify-center gap-2">
            <CartIcon
              style={loadedCatalog.cart_style ?? "carrinho"}
              className="size-5"
              color={loadedCatalog.primary_color ?? "#8b5cf6"}
            />
            <span className="text-sm text-muted-foreground">Carrinho</span>
          </div>
          <p className="mt-1 text-center text-sm text-muted-foreground">Peça pelo WhatsApp, sem criar conta.</p>
        </div>
      </header>

      {loadedCatalog.banner_enabled && banners.length > 0 && (
        <BannerCarousel
          banners={banners}
          autoplay={loadedCatalog.banner_autoplay ?? true}
          interval={loadedCatalog.banner_interval ?? 4}
          indicators={loadedCatalog.banner_indicators ?? true}
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
                      background: loadedCatalog.primary_color ?? "#8b5cf6",
                      color: "#fff",
                      borderColor: loadedCatalog.primary_color ?? "#8b5cf6",
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

      <section className="mt-5 grid grid-cols-3 gap-2 px-5">
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
              <div className="p-2">
                <p className="line-clamp-2 text-xs font-semibold text-foreground">{product.name}</p>
                <p className="mt-0.5 text-xs">
                  {product.price_options && product.price_options.length > 0 ? (
                    <span className="font-bold" style={{ color: loadedCatalog.primary_color ?? "#8b5cf6" }}>
                      {product.price_options.length === 1
                        ? formatBRL(product.price_options[0]!.price)
                        : `${formatBRL(Math.min(...product.price_options.map((o) => o.price)))} – ${formatBRL(Math.max(...product.price_options.map((o) => o.price)))}`}
                    </span>
                  ) : product.sale_price ? (
                    <>
                      <span className="text-xs text-muted-foreground line-through">
                        {formatBRL(Number(product.price))}
                      </span>{" "}
                      <span className="font-bold" style={{ color: loadedCatalog.primary_color ?? "#8b5cf6" }}>
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
            <div className="px-2 pb-2">
              <button
                disabled={!product.available}
                onClick={() => setSelected(product)}
                className="btn-shimmer btn-elevated w-full rounded-lg py-1.5 text-xs font-semibold text-white disabled:opacity-50 transition-transform hover:scale-[1.02]"
                style={{ background: loadedCatalog.primary_color ?? "#8b5cf6" }}
              >
                {product.available ? "+ Adicionar" : "Esgotado"}
              </button>
            </div>
          </article>
        ))}
      </section>

      {/* ── Formas de pagamento (catalog view) ── */}
      {activePayments.length > 0 && (
        <section className="mt-8 px-5">
          <h2
            className="text-lg font-bold text-center"
            style={{ fontFamily: getFontFamily(loadedCatalog.store_font ?? "moderna"), color: primary }}
          >
            Formas de pagamento
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {activePayments.map((m) => (
              <div
                key={m.key}
                className="flex items-center gap-3 rounded-2xl border p-4"
                style={{ borderColor: `${primary}20`, backgroundColor: bgColor === "#FFFFFF" || !bgColor ? `${primary}06` : accent }}
              >
                <div
                  className="flex size-9 items-center justify-center rounded-full text-base"
                  style={{ background: `${primary}15` }}
                >
                  {m.key === "pix" && "⚡"}
                  {m.key === "credit_card" && "💳"}
                  {m.key === "debit_card" && "💳"}
                  {m.key === "pix_auto" && "🔄"}
                  {m.key === "cash" && "💵"}
                </div>
                <span className="text-sm font-medium text-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {count > 0 && (
        <button
          key={cartBump}
          onClick={() => setCartOpen(true)}
          className="cart-bump btn-elevated fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-full px-5 py-4 text-white shadow-xl"
          style={{ background: loadedCatalog.primary_color ?? "#8b5cf6" }}
        >
          <CartIcon style={loadedCatalog.cart_style ?? "carrinho"} className="size-5" />
          <span className="text-sm font-semibold">
            {count} {count === 1 ? "item" : "itens"}
          </span>
          <span className="font-bold">{formatBRL(total)}</span>
        </button>
      )}

      {selected && (
        <ProductSheet
          product={selected}
          primary={loadedCatalog.primary_color ?? "#8b5cf6"}
          onClose={() => setSelected(null)}
          onAdd={addToCart}
        />
      )}

      {cartOpen && (
        <CartSheet
          catalogId={loadedCatalog.id}
          items={cart}
          total={total}
          primary={loadedCatalog.primary_color ?? "#8b5cf6"}
          deliveryMethods={Array.isArray(loadedCatalog.delivery_methods) ? loadedCatalog.delivery_methods : []}
          onClose={() => setCartOpen(false)}
          onChangeQty={changeQty}
          onRemove={removeItem}
          onFinish={finishOrder}
        />
      )}

      {/* Botão flutuante WhatsApp */}
      {loadedCatalog.whatsapp && !isOwner && (
        <a
          href={whatsappLink(loadedCatalog.whatsapp, `Olá! Vim pelo catálogo ${loadedCatalog.store_name}`)}
          target="_blank"
          rel="noopener noreferrer"
          className="whatsapp-float fixed bottom-6 right-6 z-40 grid size-14 place-items-center rounded-full text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
          style={{ background: whatsappColor }}
          aria-label="Falar no WhatsApp"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-7">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
          </svg>
        </a>
      )}

      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-[30rem] -translate-x-1/2 border-t border-border bg-card/95 backdrop-blur">
        <div className="flex items-center justify-center py-3">
          <button
            onClick={() => setEntered(false)}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <LayoutGrid className="size-4" />
            Voltar ao início
          </button>
        </div>
      </nav>
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
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  const scrollToIdx = (idx: number, smooth = true) => {
    const el = ref.current;
    if (!el) return;
    const child = el.children[idx] as HTMLElement | undefined;
    if (!child) return;
    el.scrollTo({ left: child.offsetLeft, behavior: smooth ? "smooth" : "instant" });
    setActiveIdx(idx);
  };

  useEffect(() => {
    if (!autoplay || paused || banners.length <= 1) return;
    const ms = Math.max(2, interval) * 1000;
    const id = window.setInterval(() => {
      const next = (activeIdx + 1) % banners.length;
      scrollToIdx(next);
    }, ms);
    return () => clearInterval(id);
  }, [autoplay, paused, interval, activeIdx, banners.length]);

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
    setActiveIdx(closest);
  }

  function handleTouchStart(e: React.TouchEvent) {
    touchRef.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
    setPaused(true);
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!touchRef.current) { setPaused(false); return; }
    const dx = e.changedTouches[0]!.clientX - touchRef.current.x;
    const dy = e.changedTouches[0]!.clientY - touchRef.current.y;
    touchRef.current = null;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 30) {
      if (dx < 0 && activeIdx < banners.length - 1) {
        scrollToIdx(activeIdx + 1);
      } else if (dx > 0 && activeIdx > 0) {
        scrollToIdx(activeIdx - 1);
      } else if (dx < 0 && activeIdx === banners.length - 1) {
        scrollToIdx(0);
      } else if (dx > 0 && activeIdx === 0) {
        scrollToIdx(banners.length - 1);
      }
    }
    setTimeout(() => setPaused(false), 200);
  }

  if (banners.length === 0) return null;

  return (
    <div
      className="relative px-5 mt-4"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative overflow-hidden rounded-2xl">
        <div
          ref={ref}
          onScroll={onScroll}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
          style={{ scrollSnapStop: "always" }}
        >
          {banners.map((b) => (
            <div key={b.id} className="w-full shrink-0 snap-center px-1.5 first:pl-0 last:pr-0">
              {b.href ? (
                <a href={b.href} target="_blank" rel="noopener noreferrer">
                  <img
                    src={b.image_url}
                    alt=""
                    className="h-48 w-full rounded-2xl object-cover"
                    style={{ objectPosition: b.object_position ?? "center" }}
                  />
                </a>
              ) : (
                <img
                  src={b.image_url}
                  alt=""
                  className="h-48 w-full rounded-2xl object-cover"
                  style={{ objectPosition: b.object_position ?? "center" }}
                />
              )}
            </div>
          ))}
        </div>

        {banners.length > 1 && (
          <>
            <button
              onClick={() => scrollToIdx(activeIdx > 0 ? activeIdx - 1 : banners.length - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 grid size-8 place-items-center rounded-full bg-black/30 text-white backdrop-blur-sm transition hover:bg-black/50 max-sm:hidden"
              aria-label="Banner anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => scrollToIdx(activeIdx < banners.length - 1 ? activeIdx + 1 : 0)}
              className="absolute right-2 top-1/2 -translate-y-1/2 grid size-8 place-items-center rounded-full bg-black/30 text-white backdrop-blur-sm transition hover:bg-black/50 max-sm:hidden"
              aria-label="Próximo banner"
            >
              <ChevronLeft className="size-4 rotate-180" />
            </button>
          </>
        )}
      </div>

      {indicators && banners.length > 1 && (
        <div className="mt-3 flex justify-center gap-2">
          {banners.map((b, i) => (
            <button
              key={b.id}
              onClick={() => scrollToIdx(i)}
              className="inline-block size-2 rounded-full transition-colors"
              style={{
                backgroundColor:
                  i === activeIdx ? "var(--shop-primary)" : "var(--color-border)",
              }}
              aria-label={`Banner ${i + 1}`}
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
  const [selectedPriceOption, setSelectedPriceOption] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const images = product.images ?? [];
  const hasPriceOptions = (product.price_options?.length ?? 0) > 0;

  const activePriceOption = hasPriceOptions
    ? product.price_options.find((o) => o.id === selectedPriceOption) ?? null
    : null;
  const price = activePriceOption ? activePriceOption.price : finalPrice(product);

  function handleImgScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setImgIdx(idx);
  }

  function handleAdd() {
    if (hasPriceOptions && !activePriceOption) {
      toast.error("Escolha uma opção de valor");
      return;
    }
    const missing = (product.variations ?? []).find((g) => g.options.length && !choices[g.name]);
    if (missing) {
      toast.error(`Escolha: ${missing.name}`);
      return;
    }
    const variation = [
      activePriceOption ? `Valor: ${activePriceOption.label}` : "",
      ...Object.entries(choices).map(([k, v]) => `${k}: ${v}`),
    ]
      .filter(Boolean)
      .join(" | ");
    onAdd({
      key: `${product.id}-${variation}`,
      productId: product.id,
      name: product.name,
      unitPrice: price,
      quantity,
      variation: variation || undefined,
      image: images[0],
      weight_grams: product.weight_grams,
      length_cm: product.length_cm,
      width_cm: product.width_cm,
      height_cm: product.height_cm,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-foreground/40">
      <div className="mt-8 flex w-full max-w-[30rem] flex-col overflow-hidden rounded-t-3xl bg-background">
        {/* ── Image Carousel ── */}
        <div className="relative">
          <div
            ref={scrollRef}
            onScroll={handleImgScroll}
            className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
          >
            {images.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={() => setZoomUrl(url)}
                className="w-full shrink-0 snap-center"
              >
                <div className="aspect-square max-h-[45vh] w-full bg-muted">
                  <img
                    src={url}
                    alt={`${product.name} ${i + 1}`}
                    loading={Math.abs(i - imgIdx) <= 1 ? "eager" : "lazy"}
                    className="h-full w-full object-cover"
                  />
                </div>
              </button>
            ))}
            {images.length === 0 && (
              <div className="aspect-square max-h-[45vh] w-full bg-muted" />
            )}
          </div>

          {/* Position indicator */}
          {images.length > 1 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground/60 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
              {imgIdx + 1} / {images.length}
            </div>
          )}

          {/* Back button */}
          <button
            onClick={onClose}
            aria-label="Voltar"
            className="absolute left-4 top-4 grid size-10 place-items-center rounded-full bg-background/90"
          >
            <ChevronLeft className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <h2 className="text-xl font-bold text-foreground">{product.name}</h2>
          <p className="mt-1 text-lg font-bold" style={{ color: primary }}>
            {formatBRL(price)}
            {!activePriceOption && product.sale_price != null && product.sale_price > 0 && (
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

          {hasPriceOptions && (
            <div className="mt-5">
              <p className="text-sm font-semibold text-foreground">Escolha o valor</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {product.price_options.map((opt) => {
                  const active = selectedPriceOption === opt.id;
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedPriceOption(opt.id)}
                      className="rounded-full border px-4 py-2 text-sm font-medium"
                      style={
                        active
                          ? { background: primary, color: "#fff", borderColor: primary }
                          : { borderColor: "var(--color-border)" }
                      }
                    >
                      {opt.label} — {formatBRL(opt.price)}
                    </button>
                  );
                })}
              </div>
            </div>
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
            className="btn-shimmer btn-elevated w-full rounded-2xl py-4 font-semibold text-white disabled:opacity-50 transition-transform hover:scale-[1.02]"
            style={{ background: primary }}
          >
            {product.available
              ? `Adicionar • ${formatBRL(price * quantity)}`
              : "Produto esgotado"}
          </button>
        </div>
      </div>

      {/* ── Fullscreen Zoom Viewer ── */}
      {zoomUrl && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/95"
          onClick={() => setZoomUrl(null)}
        >
          <button
            onClick={() => setZoomUrl(null)}
            aria-label="Fechar"
            className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/20 text-white backdrop-blur-sm"
          >
            <X className="size-5" />
          </button>
          <img
            src={zoomUrl}
            alt={product.name}
            className="max-h-[90vh] max-w-[95vw] object-contain"
          />
        </div>
      )}
    </div>
  );
}

function CartSheet({
  catalogId,
  items,
  total,
  primary,
  deliveryMethods,
  onClose,
  onChangeQty,
  onRemove,
  onFinish,
}: {
  catalogId: string;
  items: CartItem[];
  total: number;
  primary: string;
  deliveryMethods: string[];
  onClose: () => void;
  onChangeQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onFinish: (
    name: string,
    phone: string,
    note: string,
    shipping: {
      deliveryMethod: string;
      shippingZip?: string;
      address?: CustomerAddress;
      quote?: ShippingQuote | null;
      shippingCost: number;
    },
  ) => void;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [observation, setObservation] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<string>("");
  const [cep, setCep] = useState("");
  const [quotes, setQuotes] = useState<ShippingQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<string>("");
  const [quoting, setQuoting] = useState(false);
  const [quoteMsg, setQuoteMsg] = useState<string>("");
  const [address, setAddress] = useState<CustomerAddress>({
    street: "",
    number: "",
    complement: "",
    district: "",
    city: "",
    state: "",
  });

  const subtotal = total;
  const selected = quotes.find((q) => q.serviceId === selectedQuote) ?? null;
  const shippingCost =
    deliveryMethod === "melhor_envio" ? selected?.price ?? 0 : 0;
  const grandTotal = subtotal + shippingCost;

  const hasMelhorEnvio = deliveryMethods.includes("melhor_envio");
  useEffect(() => {
    if (!deliveryMethod && deliveryMethods.length === 1) {
      setDeliveryMethod(deliveryMethods[0]!);
    }
  }, [deliveryMethods, deliveryMethod]);

  async function handleQuote() {
    if (!isValidCep(cep)) {
      toast.error("Informe um CEP válido.");
      return;
    }
    setQuoting(true);
    setQuoteMsg("");
    setQuotes([]);
    setSelectedQuote("");
    const res = await quoteShipping({
      catalogId,
      destinationZip: cep,
      items: items.map((i) => ({
        key: i.key,
        weight_grams: i.weight_grams ?? null,
        length_cm: i.length_cm ?? null,
        width_cm: i.width_cm ?? null,
        height_cm: i.height_cm ?? null,
        quantity: i.quantity,
        unit_price: i.unitPrice,
      })),
    });
    setQuoting(false);
    if (res.success && Array.isArray(res.quotes) && res.quotes.length) {
      setQuotes(res.quotes as ShippingQuote[]);
    } else {
      setQuoteMsg(
        res.error === "not_connected"
          ? "Esta loja ainda não ativou o envio por Correios e transportadoras."
          : res.error === "no_origin"
            ? "A loja ainda não definiu o CEP de origem do envio."
            : res.error || "Não foi possível calcular o frete. Tente outro CEP.",
      );
    }
  }

  async function lookupCep(autoFill = true) {
    const clean = cep.replace(/\D/g, "");
    if (clean.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${clean}/json/`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.erro) {
        if (autoFill) toast.error("CEP não encontrado.");
        return;
      }
      if (autoFill) {
        setCep(data.cep || cep);
        setAddress((prev) => ({
          ...prev,
          street: data.logradouro ?? prev.street,
          district: data.bairro ?? prev.district,
          city: data.localidade ?? prev.city,
          state: data.uf ?? prev.state,
        }));
      }
    } catch {
      /* silencioso */
    }
  }

  function handleCepChange(value: string) {
    const formatted = formatCep(value);
    setCep(formatted);
    if (formatted.replace(/\D/g, "").length === 8) {
      void lookupCep();
      if (deliveryMethod === "melhor_envio") {
        void handleQuote();
      }
    }
  }

  function handleFinish() {
    if (!customerName.trim()) {
      toast.error("Informe seu nome para continuar.");
      return;
    }
    if (hasMelhorEnvio && deliveryMethod === "melhor_envio") {
      if (!isValidCep(cep)) {
        toast.error("Informe seu CEP para calcular o frete.");
        return;
      }
      if (!selected) {
        toast.error("Escolha uma modalidade de entrega.");
        return;
      }
    }
    onFinish(customerName, customerPhone, observation, {
      deliveryMethod,
      ...(cep ? { shippingZip: cep } : {}),
      address,
      quote: selected,
      shippingCost,
    });
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
            <span>{formatBRL(subtotal)}</span>
          </div>
          {deliveryMethod === "melhor_envio" && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Frete {selected ? `(${selected.name})` : ""}</span>
              <span>{shippingCost > 0 ? formatBRL(shippingCost) : "—"}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-base font-bold text-foreground">
            <span>Total</span>
            <span>{formatBRL(grandTotal)}</span>
          </div>

          {items.length > 0 && (
            <div className="space-y-3 rounded-2xl border border-border p-4">
              {deliveryMethods.length > 1 && (
                <div>
                  <label className="mb-2 block text-sm font-semibold text-foreground">
                    Como você quer receber seu pedido?
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {deliveryMethods.map((m) => {
                      const meta = DELIVERY_METHODS.find((d) => d.key === m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDeliveryMethod(m)}
                          className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                            deliveryMethod === m
                              ? "border-[var(--shop-primary)] bg-[var(--shop-accent)] text-foreground"
                              : "border-border bg-card text-muted-foreground"
                          }`}
                        >
                          <span className="text-lg">{meta?.icon ?? "📦"}</span>
                          {meta?.label ?? (m === "melhor_envio" ? "Envio" : m)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {deliveryMethods.length === 1 && (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground">
                  <span className="text-lg">
                    {DELIVERY_METHODS.find((d) => d.key === deliveryMethod)?.icon ?? "📦"}
                  </span>
                  {DELIVERY_METHODS.find((d) => d.key === deliveryMethod)?.label ?? deliveryMethod}
                </div>
              )}

              {deliveryMethod === "melhor_envio" && (
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-foreground">
                    CEP para entrega <span className="text-destructive">*</span>
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Digite seu CEP para ver o frete + total na hora.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={cep}
                      onChange={(e) => handleCepChange(e.target.value)}
                      placeholder="00000-000"
                      maxLength={9}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                    <button
                      type="button"
                      onClick={() => void handleQuote()}
                      disabled={quoting}
                      className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.02] disabled:opacity-50"
                      style={{ background: primary }}
                    >
                      {quoting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        "Calcular frete"
                      )}                    </button>
                  </div>

                  {quoteMsg && (
                    <p className="text-xs text-muted-foreground">{quoteMsg}</p>
                  )}

                  {quotes.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 pt-1">
                      {quotes.map((q) => (
                        <button
                          key={q.serviceId}
                          type="button"
                          onClick={() => setSelectedQuote(q.serviceId)}
                          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                            selectedQuote === q.serviceId
                              ? "border-[var(--shop-primary)] bg-[var(--shop-accent)] text-foreground"
                              : "border-border bg-card text-muted-foreground"
                          }`}
                        >
                          <span className="font-semibold">{q.name}</span>
                          <span className="text-right">
                            <span className="block font-bold text-foreground">
                              {formatBRL(q.price)}
                            </span>
                            {q.delivery_text && (
                              <span className="block text-xs text-muted-foreground">
                                {q.delivery_text}
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {(deliveryMethod === "melhor_envio" ||
                deliveryMethod === "local_delivery") && (
                <div className="space-y-2 border-t border-dashed border-border pt-3">
                  <p className="text-sm font-semibold text-foreground">Endereço de entrega</p>
                  <div>
                    <input
                      type="text"
                      value={address.street}
                      onChange={(e) => setAddress((p) => ({ ...p, street: e.target.value }))}
                      placeholder="Rua / Logradouro"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={address.number}
                      onChange={(e) => setAddress((p) => ({ ...p, number: e.target.value }))}
                      placeholder="Número"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                    <input
                      type="text"
                      value={address.complement}
                      onChange={(e) => setAddress((p) => ({ ...p, complement: e.target.value }))}
                      placeholder="Complemento"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={address.district}
                      onChange={(e) => setAddress((p) => ({ ...p, district: e.target.value }))}
                      placeholder="Bairro"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      type="text"
                      value={address.city}
                      onChange={(e) => setAddress((p) => ({ ...p, city: e.target.value }))}
                      placeholder="Cidade"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                    <input
                      type="text"
                      value={address.state}
                      onChange={(e) => setAddress((p) => ({ ...p, state: e.target.value }))}
                      placeholder="UF"
                      maxLength={2}
                      className="w-16 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                  </div>
                </div>
              )}

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
            className="btn-shimmer btn-elevated w-full rounded-2xl py-4 font-semibold text-white disabled:opacity-50 transition-transform hover:scale-[1.02]"
            style={{ background: primary }}
          >
            Finalizar pedido pelo WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Welcome Page ──────────────────────────────────────────────── */

function WelcomePage({
  catalog,
  theme,
  logoSizeClass,
  logoJustify,
  onEnter,
}: {
  catalog: Catalog;
  theme: React.CSSProperties;
  logoSizeClass: string;
  logoJustify: string;
  onEnter: () => void;
}) {
  const primary = catalog.primary_color ?? "#8b5cf6";
  const accent = catalog.accent_color ?? "#f3eefc";
  const bgColor = catalog.background_color ?? "#FFFFFF";
  const whatsappColor = catalog.whatsapp_button_color ?? "#8b5cf6";
  const activePayments = Array.isArray(catalog.payment_methods)
    ? PAYMENT_METHODS.filter((m) => (catalog.payment_methods as string[]).includes(m.key))
    : [];
  const hasOwnerInfo = catalog.owner_photo_url || catalog.owner_name || catalog.owner_bio || catalog.owner_hours;

  return (
    <div className="app-shell pb-20" style={{ ...theme, backgroundColor: bgColor }}>
      {/* ── Cover + Logo + Name ── */}
      <header className="relative">
        <div
          className="h-40 w-full bg-cover bg-center"
          style={{
            backgroundColor: accent,
            backgroundImage: catalog.cover_url ? `url(${catalog.cover_url})` : undefined,
          }}
        >
          <div className="cover-glass h-full w-full" />
        </div>
        <div className="px-5">
          <div
            className="-mt-12 flex items-end gap-3"
            style={{ justifyContent: logoJustify }}
          >
            <div
              className={`${logoSizeClass} shrink-0 overflow-hidden rounded-full border-4 border-background bg-muted`}
              style={{ backgroundColor: accent }}
            >
              {catalog.logo_url && (
                <img
                  src={catalog.logo_url}
                  alt={catalog.store_name}
                  className="h-full w-full object-cover"
                />
              )}
            </div>
          </div>
          <h1
            className="mt-3 text-2xl font-bold text-center"
            style={{
              fontFamily: getFontFamily(catalog.store_font ?? "moderna"),
              color: primary,
            }}
          >
            {catalog.store_name}
          </h1>
          {catalog.store_description && (
            <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">
              {catalog.store_description}
            </p>
          )}
          <div className="mt-3 flex items-center justify-center gap-2">
            <CartIcon
              style={catalog.cart_style ?? "carrinho"}
              className="size-5"
              color={primary}
            />
            <span className="text-sm text-muted-foreground">Carrinho</span>
          </div>
        </div>
      </header>

      {/* ── Entrar button (primeiro) ── */}
      <div className="mt-6 px-5">
        <button
          onClick={onEnter}
          className="btn-shimmer btn-elevated w-full rounded-2xl py-4 font-semibold text-white transition-transform hover:scale-[1.02]"
          style={{ background: primary }}
        >
          ENTRAR PARA VER CATÁLOGO
        </button>
      </div>

      {/* ── Instagram button ── */}
      {catalog.instagram_url && (
        <div className="px-5 mt-3">
          <a
            href={catalog.instagram_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-shimmer btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#f09433] via-[#e6683c] to-[#bc1888] py-4 font-semibold text-white transition-transform hover:scale-[1.02]"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
              <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
            </svg>
            Siga no Instagram
          </a>
        </div>
      )}

      {/* ── WhatsApp button ── */}
      {catalog.whatsapp && (
        <div className="px-5 mt-3">
          <a
            href={whatsappLink(catalog.whatsapp, `Olá! Vim pelo catálogo ${catalog.store_name}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-shimmer btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-semibold text-white transition-transform hover:scale-[1.02]"
            style={{ background: whatsappColor }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            Falar no WhatsApp
          </a>
        </div>
      )}

      {/* ── Como Funciona ── */}
      <section className="mt-8 px-5">
        <h2
          className="text-lg font-bold text-center"
          style={{ fontFamily: getFontFamily(catalog.store_font ?? "moderna"), color: primary }}
        >
          Como funciona
        </h2>
          <div className="mt-4 space-y-3">
          <div
            className="flex items-start gap-4 rounded-2xl border p-4"
            style={{
              borderColor: `${primary}20`,
              backgroundColor: bgColor === "#FFFFFF" || !bgColor ? `${primary}06` : accent,
            }}
          >
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ background: primary }}
            >
              1
            </div>
            <div>
              <p className="font-semibold text-foreground">Escolha seu pedido</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Entre no catálogo e escolha os produtos que deseja comprar.
              </p>
            </div>
          </div>
          <div
            className="flex items-start gap-4 rounded-2xl border p-4"
            style={{
              borderColor: `${primary}20`,
              backgroundColor: bgColor === "#FFFFFF" || !bgColor ? `${primary}06` : accent,
            }}
          >
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{ background: primary }}
            >
              2
            </div>
            <div>
              <p className="font-semibold text-foreground">Envie pelo WhatsApp</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Abra o carrinho e selecione a opção para enviar o pedido diretamente pelo WhatsApp da loja.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Formas de pagamento ── */}
      {activePayments.length > 0 && (
        <section className="mt-8 px-5">
          <h2
            className="text-lg font-bold text-center"
            style={{ fontFamily: getFontFamily(catalog.store_font ?? "moderna"), color: primary }}
          >
            Formas de pagamento
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {activePayments.map((m) => (
              <div
                key={m.key}
                className="flex items-center gap-3 rounded-2xl border p-4"
                style={{ borderColor: `${primary}20`, backgroundColor: bgColor === "#FFFFFF" || !bgColor ? `${primary}06` : accent }}
              >
                <div
                  className="flex size-9 items-center justify-center rounded-full text-base"
                  style={{ background: `${primary}15` }}
                >
                  {m.key === "pix" && "⚡"}
                  {m.key === "credit_card" && "💳"}
                  {m.key === "debit_card" && "💳"}
                  {m.key === "pix_auto" && "🔄"}
                  {m.key === "cash" && "💵"}
                </div>
                <span className="text-sm font-medium text-foreground">{m.label}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Apresentação da dona ── */}
      {hasOwnerInfo && (
        <section className="mt-8 px-5">
          <h2
            className="text-lg font-bold text-center"
            style={{ fontFamily: getFontFamily(catalog.store_font ?? "moderna"), color: primary }}
          >
            Sobre a loja
          </h2>
          <div
            className="mt-4 flex flex-col items-center gap-4 rounded-2xl border p-5 text-center"
            style={{ borderColor: `${primary}20`, backgroundColor: bgColor === "#FFFFFF" || !bgColor ? `${primary}06` : accent }}
          >
            {catalog.owner_photo_url && (
              <img
                src={catalog.owner_photo_url}
                alt={catalog.owner_name ?? "Dona da loja"}
                className="size-20 rounded-full border-3 object-cover"
                style={{ borderColor: primary }}
              />
            )}
            {catalog.owner_name && (
              <p className="text-base font-bold" style={{ color: primary }}>
                {catalog.owner_name}
              </p>
            )}
            {catalog.owner_bio && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                {catalog.owner_bio}
              </p>
            )}
            {catalog.owner_hours && (
              <div
                className="mt-1 flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-muted-foreground"
                style={{ background: `${primary}0A` }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4 shrink-0">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {catalog.owner_hours}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── WhatsApp floating (always on welcome) ── */}
      {catalog.whatsapp && (
        <a
          href={whatsappLink(catalog.whatsapp, `Olá! Vim pelo catálogo ${catalog.store_name}`)}
          target="_blank"
          rel="noopener noreferrer"
          className="whatsapp-float fixed bottom-6 right-6 z-40 grid size-14 place-items-center rounded-full text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
          style={{ background: whatsappColor }}
          aria-label="Falar no WhatsApp"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="size-7">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
          </svg>
        </a>
      )}

      <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-[30rem] -translate-x-1/2 border-t border-border bg-card/95 backdrop-blur">
        <div className="flex items-center justify-center py-3">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <LayoutGrid className="size-4" />
            Voltar ao início
          </Link>
        </div>
      </nav>
    </div>
  );
}
