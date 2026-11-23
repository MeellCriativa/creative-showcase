import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, LayoutGrid, Loader2, Minus, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { supabase, getSupabaseError } from "@/integrations/supabase/client";
import { CartIcon } from "@/components/CartIcons";
import { CurrencyPicker } from "@/components/CurrencyPicker";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCurrencyRates } from "@/hooks/useRates";
import { LanguageSelector, useI18n, type MessageKey } from "@/i18n";
import { countdownParts, parseCheckoutConfig, type CheckoutBannerConfig, type TestimonialConfig } from "@/lib/checkoutConfig";
import {
  buildWhatsappMessage,
  finalPrice,
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
import {
  CURRENCIES,
  convertAmount,
  formatMoney,
  fromMinorUnits,
  resolveStoreCurrency,
  toMinorUnits,
} from "@/lib/currency";
import {
  createPixOrder,
  declarePixPaid,
  getPixConfig,
  getPixOrderStatus,
  type PixOrderResult,
  type PixPublicConfig,
} from "@/lib/pixManual";
import {
  IMAGE_WIDTHS,
  imageFallback,
  optimizedImageSrcSet,
  optimizedImageUrl,
} from "@/lib/imageUrls";
import { parseProductCheckoutParams } from "@/lib/productLinks";
import { notifySellerAboutOrder } from "@/lib/sellerNotifications";
import { SITE_OG_IMAGE } from "@/lib/site";
import { quoteShipping } from "@/lib/shipping";
import {
  createPayment,
  createSecureOrder,
  getPaymentStatus,
  isVisiblePaymentProvider,
  listPaymentMethods,
  PROVIDER_LABELS,
  type PaymentProviderKey,
  type PublicPaymentMethod,
} from "@/lib/payments";

const PRODUCT_QUERY_COLUMNS =
  "id,catalog_id,category_id,name,description,price,sale_price,images,variations,available,is_new,is_bestseller,position,created_at,updated_at,price_options,weight_grams,length_cm,width_cm,height_cm,product_type,digital_file_path,digital_file_name,digital_file_mime,digital_file_size,digital_file_checksum,digital_instructions,digital_link_ttl_minutes,digital_max_downloads,additional_info,digital_delivery_mode,checkout_enabled,checkout_desktop_config,checkout_mobile_config";

/**
 * Lojas em produção podem estar em um schema anterior, sem as colunas de
 * personalização de checkout. Nesse caso repetimos a consulta sem elas para
 * que o catálogo continue abrindo; os campos ausentes viram `undefined` e
 * já têm fallback no componente.
 */
const PRODUCT_QUERY_COLUMNS_LEGACY =
  "id,catalog_id,category_id,name,description,price,sale_price,images,variations,available,is_new,is_bestseller,position,created_at,updated_at,price_options,weight_grams,length_cm,width_cm,height_cm,product_type,digital_file_path,digital_file_name,digital_file_mime,digital_file_size,digital_file_checksum,digital_instructions,digital_link_ttl_minutes,digital_max_downloads";

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
    const storeImage = catalog?.cover_url || catalog?.logo_url;
    const ogImage = storeImage || SITE_OG_IMAGE;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: catalog?.store_name || title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:image", content: ogImage },
        ...(storeImage
          ? []
          : [
              { property: "og:image:type", content: "image/png" },
              { property: "og:image:width", content: "1200" },
              { property: "og:image:height", content: "630" },
            ]),
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: ogImage },
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
  product_type?: "fisico" | "digital" | null;
  weight_grams?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
};

/**
 * Filtros fixos da vitrine.
 *
 * `id` é o valor interno usado no estado (não muda com o idioma); `key` é a
 * chave de tradução resolvida no render.
 */
const FILTERS: { id: string; key: MessageKey }[] = [
  { id: "all", key: "catalog.filters.all" },
  { id: "new", key: "catalog.filters.new" },
  { id: "bestsellers", key: "catalog.filters.bestsellers" },
  { id: "sales", key: "catalog.filters.sales" },
];

/** Rótulos do sistema das formas de entrega (o valor gravado no banco não muda). */
const DELIVERY_LABEL_KEYS: Record<string, MessageKey> = {
  local_pickup: "catalog.deliveryMethods.localPickup",
  local_delivery: "catalog.deliveryMethods.localDelivery",
  melhor_envio: "catalog.deliveryMethods.melhorEnvio",
};

/** Rótulos do sistema das formas de pagamento. */
const PAYMENT_LABEL_KEYS: Record<string, MessageKey> = {
  pix: "catalog.paymentMethods.pix",
  credit_card: "catalog.paymentMethods.creditCard",
  debit_card: "catalog.paymentMethods.debitCard",
  pix_auto: "catalog.paymentMethods.pixAuto",
  cash: "catalog.paymentMethods.cash",
};

type Translate = (key: MessageKey, values?: Record<string, string | number>) => string;

/** Rótulo traduzido de uma forma de entrega; cai no rótulo original se desconhecida. */
function deliveryMethodLabel(key: string, t: Translate, fallback?: string | undefined) {
  const labelKey = DELIVERY_LABEL_KEYS[key];
  if (labelKey) return t(labelKey);
  return fallback ?? DELIVERY_METHODS.find((d) => d.key === key)?.label ?? key;
}

/** Rótulo traduzido de uma forma de pagamento; cai no rótulo original se desconhecida. */
function paymentMethodLabel(key: string, t: Translate, fallback?: string | undefined) {
  const labelKey = PAYMENT_LABEL_KEYS[key];
  if (labelKey) return t(labelKey);
  return fallback ?? PAYMENT_METHODS.find((m) => m.key === key)?.label ?? key;
}

const LOGO_SIZES: Record<string, string> = {
  pequena: "size-12",
  medio: "size-16",
  grande: "size-36",
};

/** Pedido aguardando confirmação no retorno do provedor. */
const PENDING_PAYMENT_KEY = "vc_pending_payment";

type PaymentReturnState = {
  status: "checking" | "settled" | "failed" | "pending";
  provider: PaymentProviderKey | null;
};

type PendingPayment = {
  orderId: string;
  token: string;
  provider?: PaymentProviderKey;
  at?: number;
};

function readPendingPayment(): PendingPayment | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PAYMENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingPayment;
    if (!parsed?.orderId || !parsed?.token) return null;
    // Descarta pedidos antigos (24h) para não consultar token expirado.
    if (parsed.at && Date.now() - parsed.at > 24 * 60 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPendingPayment() {
  try {
    sessionStorage.removeItem(PENDING_PAYMENT_KEY);
  } catch {
    /* ignore */
  }
}

function PublicCatalog() {
  const { slug } = Route.useParams();
  const { user } = useAuth();
  const { t, tp } = useI18n();
  /**
   * O efeito de retorno do pagamento tem `[]` como dependência (não pode
   * reiniciar quando o idioma muda), então lê sempre o `t` mais recente.
   */
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartBump, setCartBump] = useState(0);
  // Quem volta do checkout não deve ver a capa de boas-vindas de novo.
  const [entered, setEntered] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("payment") === "return";
  });
  const [paymentReturn, setPaymentReturn] = useState<PaymentReturnState | null>(null);
  /** Link direto recebido pelo comprador (produto e, opcionalmente, valor). */
  const [deepLink, setDeepLink] = useState<{
    productId: string;
    priceOptionId: string | null;
  } | null>(null);
  const handledDeepLink = useRef<string | null>(null);
  /** Moeda escolhida pelo comprador; `null` = usar a moeda da loja. */
  const [displayCurrency, setDisplayCurrency] = useState<string | null>(null);
  const currencyChosenByBuyer = useRef(false);
  const ratesQuery = useCurrencyRates();

  const {
    data,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: ["public-catalog", slug],
    queryFn: async () => {
      const connError = getSupabaseError();
      if (connError) {
        console.error("[catalog] supabase init error:", connError);
        throw new Error(t("catalog.errors.supabaseConfig"));
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
      const catalogId = String(catalog.id);
      const fetchProducts = async () => {
        const full = await supabase
          .from("products")
          .select(PRODUCT_QUERY_COLUMNS)
          .eq("catalog_id", catalogId)
          .order("position")
          .order("created_at");
        if (!full.error || !/42703|does not exist/i.test(full.error.message)) return full;

        console.warn("[catalog] schema antigo detectado, consultando colunas básicas:", full.error.message);
        return supabase
          .from("products")
          .select(PRODUCT_QUERY_COLUMNS_LEGACY)
          .eq("catalog_id", catalogId)
          .order("position")
          .order("created_at");
      };
      const [{ data: categories }, { data: products }, { data: banners }] = await Promise.all([
        supabase.from("categories").select("*").eq("catalog_id", catalogId).order("position"),
        fetchProducts(),
        supabase.from("banners").select("*").eq("catalog_id", catalogId).order("position"),
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

  /** Moeda da loja (lojas antigas = BRL): usada em cálculos, pedidos e cobrança. */
  const currency = resolveStoreCurrency(catalog?.currency);

  useEffect(() => {
    if (!catalog || currencyChosenByBuyer.current) return;
    setDisplayCurrency(resolveStoreCurrency(catalog.currency));
  }, [catalog]);

  const rates = ratesQuery.data?.ok ? ratesQuery.data.rates : null;
  const unavailableCurrencyCodes = useMemo(
    () => (rates ? CURRENCIES.filter((c) => !(c.code in rates)).map((c) => c.code) : []),
    [rates],
  );
  const selectedCurrency = displayCurrency ?? currency;
  const conversionAvailable =
    selectedCurrency === currency || !!(rates && rates[currency] && rates[selectedCurrency]);
  /**
   * Formatação para exibição: converte o valor da moeda da loja para a moeda
   * escolhida pelo comprador. Nunca altera preços gravados nem valores de
   * cobrança — o pagamento continua na moeda da loja.
   */
  const money = (value: number) => {
    if (selectedCurrency === currency) return formatMoney(value, currency);
    const converted = convertAmount(value, currency, selectedCurrency, rates);
    return formatMoney(converted ? converted.value : value, converted ? selectedCurrency : currency);
  };

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
      .then(
        () => {},
        () => {
          /* silent */
        },
      );
  }, [catalog, user]);

  useEffect(() => {
    if (!catalog) return;
    const ogImage = catalog.logo_url || catalog.cover_url || SITE_OG_IMAGE;
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
    setMeta(
      "og:description",
      catalog.store_description || `Catálogo ${catalog.store_name} — Vitrine Criativa`,
    );
    if (ogImage) setMeta("og:image", ogImage);
    document.title = `${catalog.store_name} — Vitrine Criativa`;
    return () => {
      setMeta("og:title", "Catálogo digital — Vitrine Criativa");
      setMeta("og:description", "Escolha seus produtos e finalize o pedido direto pelo WhatsApp.");
      document.title = "Vitrine Criativa";
    };
  }, [catalog]);

  /** Link direto: entra na loja já com o produto e o valor escolhidos. */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const { productId, priceOptionId } = parseProductCheckoutParams(window.location.search);
    if (!productId || !data?.products?.length) return;
    const key = `${productId}|${priceOptionId ?? ""}`;
    if (handledDeepLink.current === key) return;
    const product = data.products.find((item) => item.id === productId);
    if (!product) return;
    handledDeepLink.current = key;
    setDeepLink({ productId, priceOptionId });
    setEntered(true);
    setSelected(product);
  }, [data?.products]);

  /**
   * Confirmação no retorno do comprador (auditoria M6).
   *
   * Ao voltar do Mercado Pago a página consulta o status oficial —
   * inclusive pedindo uma verificação ao provedor (`refresh=1`) — em vez de
   * esperar o webhook. Se o webhook já chegou, a primeira consulta resolve.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "return") return;

    const orderFromUrl = params.get("order") ?? "";
    const stored = readPendingPayment();
    const orderId = orderFromUrl || stored?.orderId || "";
    const token = stored?.token ?? "";
    const provider =
      ((stored?.provider ?? params.get("provider")) as PaymentProviderKey | null) ?? null;

    // Limpa a URL para um refresh não reabrir o polling.
    try {
      const clean = new URL(window.location.href);
      ["payment", "provider", "order"].forEach((key) => clean.searchParams.delete(key));
      window.history.replaceState({}, "", clean.pathname + clean.search);
    } catch {
      /* ignore */
    }

    if (!orderId || !token) {
      setPaymentReturn({ status: "pending", provider });
      return;
    }

    setPaymentReturn({ status: "checking", provider });
    let cancelled = false;
    let timer = 0;
    let attempts = 0;

    const tick = async () => {
      attempts += 1;
      // Primeira consulta e depois a cada 3ª: verificação oficial sob demanda.
      const res = await getPaymentStatus({
        orderId,
        checkoutToken: token,
        refresh: attempts === 1 || attempts % 3 === 0,
      });
      if (cancelled) return;

      if (res.success && res.settled) {
        clearPendingPayment();
        setPaymentReturn({ status: "settled", provider });
        toast.success(tRef.current("catalog.toast.paymentConfirmed"));
        return;
      }
      if (res.success && res.failed) {
        clearPendingPayment();
        setPaymentReturn({ status: "failed", provider });
        toast.error(tRef.current("catalog.toast.paymentFailed"));
        return;
      }
      if (attempts >= 10) {
        // Não descartamos o token: o webhook pode chegar depois e a próxima
        // visita confirma o pagamento.
        setPaymentReturn({ status: "pending", provider });
        return;
      }
      timer = window.setTimeout(tick, 3000);
    };

    timer = window.setTimeout(tick, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  /**
   * Métodos de pagamento online realmente habilitados nesta loja.
   *
   * A lista vem do backend (que confere conexão do vendedor + moeda). Se nada
   * estiver habilitado — ou se a função ainda não estiver disponível — o
   * checkout continua exatamente como antes (pedido pelo WhatsApp).
   */
  const { data: paymentMethods } = useQuery({
    queryKey: ["public-payment-methods", catalog?.id],
    enabled: !!catalog?.id,
    retry: 0,
    staleTime: 60_000,
    queryFn: async (): Promise<PublicPaymentMethod[]> => {
      const res = await listPaymentMethods({ catalogId: catalog!.id });
      return res.success && Array.isArray(res.methods)
        ? res.methods.filter((method) => isVisiblePaymentProvider(method.provider))
        : [];
    },
  });

  const { data: pixConfig } = useQuery<PixPublicConfig | null>({
    queryKey: ["public-pix-config", catalog?.id],
    enabled: !!catalog?.id,
    retry: 0,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await getPixConfig({ catalogId: catalog!.id });
      return res.success ? res : null;
    },
  });

  const products = useMemo(() => {
    const all = data?.products ?? [];
    // `filter` guarda o id interno do filtro (ou o id da categoria), nunca o texto.
    if (filter === "all") return all;
    if (filter === "new") return all.filter((p) => p.is_new);
    if (filter === "bestsellers") return all.filter((p) => p.is_bestseller);
    if (filter === "sales") return all.filter((p) => p.sale_price != null && p.sale_price > 0);
    return all.filter((p) => p.category_id === filter);
  }, [data, filter]);

  /**
   * Soma SEMPRE em unidades mínimas (centavos) para evitar artefatos de ponto
   * flutuante (ex.: 19.99 × 3 = 59.97000000000001) no total exibido e no total
   * gravado no pedido.
   */
  const total = useMemo(
    () =>
      fromMinorUnits(
        cart.reduce((sum, item) => sum + toMinorUnits(item.unitPrice, currency) * item.quantity, 0),
        currency,
      ),
    [cart, currency],
  );
  const count = cart.reduce((sum, item) => sum + item.quantity, 0);

  const addToCart = useCallback(
    (item: CartItem) => {
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
      toast.success(t("catalog.toast.addedToCart"));
    },
    [t],
  );

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
    async (
      customerName: string,
      customerPhone: string,
      customerEmail: string,
      note: string,
      shipping: {
        deliveryMethod: string;
        shippingZip?: string;
        address?: CustomerAddress;
        quote?: ShippingQuote | null;
        shippingCost: number;
      },
      payment: { provider: PaymentProviderKey | "pix_manual" } | null,
    ): Promise<boolean | PixOrderResult> => {
      if (!catalog) return false;
      const onlinePaymentAvailable = (paymentMethods?.length ?? 0) > 0 || !!pixConfig?.available;
      // Com pagamento online, o WhatsApp deixa de ser canal de finalização.
      if (!payment && onlinePaymentAvailable) {
        toast.error(t("catalog.errors.onlinePaymentRequired"));
        return false;
      }
      if (!payment && !catalog.whatsapp) {
        toast.error(t("catalog.errors.storeWithoutWhatsapp"));
        return false;
      }
      if (!customerName.trim()) {
        toast.error(t("catalog.errors.nameRequired"));
        return false;
      }

      const customerLine = customerName.trim()
        ? `${t("catalog.whatsapp.customerLabel")}: ${customerName.trim()}${customerPhone.trim() ? ` | ${t("catalog.whatsapp.phoneLabel")}: ${customerPhone.trim()}` : ""}${note.trim() ? `\n${t("catalog.whatsapp.noteLabel")}: ${note.trim()}` : ""}`
        : note.trim() || undefined;
      const shipAddress = shipping.address;
      const localShippingCost = Math.max(0, Number(shipping.shippingCost ?? 0));

      /** Mensagem do WhatsApp montada localmente (também usada no fallback). */
      const buildMessage = (subtotalValue: number, totalValue: number, shippingValue: number) =>
        buildWhatsappMessage(
          {
            storeName: catalog.store_name,
            currency,
            items: cart.map((i) => ({
              name: i.name,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              variation: i.variation,
            })),
            subtotal: subtotalValue,
            total: totalValue,
            shipping: {
              ...(shipping.deliveryMethod ? { deliveryMethod: shipping.deliveryMethod } : {}),
              ...(shipping.quote?.name ? { serviceName: shipping.quote.name } : {}),
              ...(shippingValue ? { cost: shippingValue } : {}),
              ...(shipping.quote?.delivery_text
                ? { etaText: shipping.quote.delivery_text }
                : shipping.deliveryMethod === "local_delivery"
                  ? { etaText: t("catalog.whatsapp.localDeliveryEta") }
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
          },
          {
            intro: t("catalog.whatsapp.message.intro"),
            product: t("catalog.whatsapp.message.product"),
            variation: t("catalog.whatsapp.message.variation"),
            quantity: t("catalog.whatsapp.message.quantity"),
            unitPrice: t("catalog.whatsapp.message.unitPrice"),
            subtotal: t("catalog.whatsapp.message.subtotal"),
            shippingDelivery: t("catalog.whatsapp.message.shippingDelivery"),
            service: t("catalog.whatsapp.message.service"),
            shippingCost: t("catalog.whatsapp.message.shippingCost"),
            estimatedDelivery: t("catalog.whatsapp.message.estimatedDelivery"),
            address: t("catalog.whatsapp.message.address"),
            zip: t("catalog.whatsapp.message.zip"),
            pickup: t("catalog.whatsapp.message.pickup"),
            localDeliveryEta: t("catalog.whatsapp.message.localDeliveryEta"),
            localDelivery: t("catalog.whatsapp.message.localDelivery"),
            orderTotal: t("catalog.whatsapp.message.orderTotal"),
            shippingIncluded: t("catalog.whatsapp.message.shippingIncluded"),
            closing: t("catalog.whatsapp.message.closing"),
          },
        );

      const openWhatsapp = (message: string) => {
        const url = whatsappLink(catalog.whatsapp!, message);
        const opened = window.open(url, "_blank");
        // Alguns navegadores bloqueiam window.open após uma chamada assíncrona.
        if (!opened) window.location.href = url;
      };

      /**
       * A função `payments` pode ainda não estar publicada no projeto Supabase.
       * Nesse caso (404 / função inexistente / rede) o pedido NÃO pode ser
       * perdido: ele é gravado direto no Supabase, exatamente como antes da
       * etapa de pagamentos, e o WhatsApp continua sendo aberto.
       *
       * Falhas de validação do backend (estoque, produto inexistente, etc.)
       * NÃO entram aqui — essas precisam ser mostradas ao comprador.
       */
      const isPaymentsBackendUnavailable = (result: { error?: string; code?: string }) => {
        const message = String(result.error ?? "");
        return (
          result.code === "NOT_FOUND" ||
          /status 404|not found|function was not found|erro de rede ao chamar o servidor/i.test(
            message,
          )
        );
      };

      /** Gravação direta (comportamento anterior à etapa 2). */
      const insertOrderDirectly = async (): Promise<boolean> => {
        const { error } = await supabase.from("orders").insert({
          catalog_id: catalog.id,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim() || null,
          customer_email: customerEmail.trim().toLowerCase() || null,
          items: cart.map((i) => ({
            product_id: i.productId,
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            variation: i.variation,
            product_type: i.product_type ?? null,
            weight_grams: i.weight_grams ?? null,
            length_cm: i.length_cm ?? null,
            width_cm: i.width_cm ?? null,
            height_cm: i.height_cm ?? null,
          })),
          note: note.trim() || null,
          subtotal: total,
          total: fromMinorUnits(
            toMinorUnits(total, currency) + toMinorUnits(localShippingCost, currency),
            currency,
          ),
          status: "novo",
          currency,
          delivery_method: shipping.deliveryMethod || null,
          shipping_zip: shipping.shippingZip ? shipping.shippingZip.replace(/\D/g, "") : null,
          shipping_service: shipping.quote?.serviceId || null,
          shipping_service_name: shipping.quote?.name || null,
          shipping_cost: localShippingCost || null,
          shipping_eta_days: shipping.quote?.delivery_min ?? null,
          shipping_eta_text: shipping.quote?.delivery_text || null,
          customer_street: shipAddress?.street || null,
          customer_number: shipAddress?.number || null,
          customer_complement: shipAddress?.complement || null,
          customer_district: shipAddress?.district || null,
          customer_city: shipAddress?.city || null,
          customer_state: shipAddress?.state || null,
        } as never);
        if (error) {
          console.error("[checkout] gravação direta do pedido falhou:", error);
          return false;
        }
        // Não há SELECT público em orders: a função localiza o pedido recém-criado
        // pelo catálogo + nome do cliente e dispara o aviso ao vendedor.
        void notifySellerAboutOrder({ catalogId: catalog.id, customerName: customerName.trim() });
        return true;
      };

      // ── Pix manual: pedido + dados de pagamento sem provedor automático ───
      if (payment?.provider === "pix_manual") {
        const pixOrder = await createPixOrder({
          catalogId: catalog.id,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim() || null,
          customerEmail: customerEmail.trim().toLowerCase() || null,
          note: note.trim() || null,
          items: cart.map((i) => ({
            product_id: i.productId,
            quantity: i.quantity,
            variation: i.variation ?? null,
          })),
          deliveryMethod: shipping.deliveryMethod || null,
          shippingZip: shipping.shippingZip ? shipping.shippingZip.replace(/\D/g, "") : null,
          shippingService: shipping.quote?.serviceId || null,
          address: shipping.address
            ? {
                street: shipping.address.street || null,
                number: shipping.address.number || null,
                complement: shipping.address.complement || null,
                district: shipping.address.district || null,
                city: shipping.address.city || null,
                state: shipping.address.state || null,
              }
            : null,
        });
        if (!pixOrder.success || !pixOrder.order_id) {
          toast.error(String(pixOrder.error || t("catalog.pix.invalid")), { duration: 9000 });
          return false;
        }
        setCart([]);
        return pixOrder;
      }

      const created = await createSecureOrder({
        catalogId: catalog.id,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || null,
        customerEmail: customerEmail.trim().toLowerCase() || null,
        note: note.trim() || null,
        items: cart.map((i) => ({
          product_id: i.productId,
          quantity: i.quantity,
          variation: i.variation ?? null,
        })),
        deliveryMethod: shipping.deliveryMethod || null,
        shippingZip: shipping.shippingZip ? shipping.shippingZip.replace(/\D/g, "") : null,
        shippingService: shipping.quote?.serviceId ?? null,
        address: shipping.address
          ? {
              street: shipping.address.street || null,
              number: shipping.address.number || null,
              complement: shipping.address.complement || null,
              district: shipping.address.district || null,
              city: shipping.address.city || null,
              state: shipping.address.state || null,
            }
          : null,
      });

      if (!created.success || !created.order_id) {
        const reason = String(created.error || t("catalog.errors.orderNotRegistered"));

        /**
         * Backend de pagamentos ausente: grava o pedido direto no Supabase
         * (comportamento anterior à etapa 2) e segue para o WhatsApp, para que
         * o pedido continue aparecendo no painel do vendedor.
         */
        if (isPaymentsBackendUnavailable(created)) {
          // Quem escolheu pagar online nunca é redirecionado para o WhatsApp.
          if (payment) {
            toast.error(t("catalog.errors.paymentUnavailable"), { duration: 9000 });
            return false;
          }
          const registered = await insertOrderDirectly();
          if (registered) {
            const localTotal = fromMinorUnits(
              toMinorUnits(total, currency) + toMinorUnits(localShippingCost, currency),
              currency,
            );
            if (catalog.whatsapp) openWhatsapp(buildMessage(total, localTotal, localShippingCost));
            setCart([]);
            setCartOpen(false);
            return true;
          }
        }

        /**
         * Fallback do WhatsApp (auditoria A5).
         *
         * Se o backend não registrar o pedido, o comprador não pode ficar
         * travado. Abrimos o WhatsApp com a mensagem montada localmente e
         * deixamos explícito que o pedido NÃO entrou no painel — o vendedor
         * precisa cadastrá-lo manualmente.
         */
        if (!payment && catalog.whatsapp) {
          toast.warning(t("catalog.errors.whatsappFallback", { reason }), {
            duration: 12_000,
          });
          const localTotal = fromMinorUnits(
            toMinorUnits(total, currency) + toMinorUnits(localShippingCost, currency),
            currency,
          );
          openWhatsapp(buildMessage(total, localTotal, localShippingCost));
          setCart([]);
          setCartOpen(false);
          return true;
        }
        toast.error(payment ? t("catalog.errors.paymentUnavailable") : reason, {
          duration: 9000,
        });
        return false;
      }

      // Valores oficiais devolvidos pelo backend.
      const subtotal = Number(created.subtotal ?? 0);
      const grandTotal = Number(created.total ?? 0);
      const serverShipping = Number(created.shipping_cost ?? 0);

      // ── Pagamento online ────────────────────────────────────────────────
      if (payment) {
        const returnUrl = `${window.location.origin}/c/${catalog.slug}?payment=return&provider=${payment.provider}&order=${created.order_id}`;
        const paid = await createPayment({
          orderId: created.order_id,
          checkoutToken: created.checkout_token,
          provider: payment.provider,
          returnUrl,
          cancelUrl: returnUrl,
        });

        if (!paid.success || !paid.checkout_url) {
          toast.error(String(paid.error || t("catalog.errors.paymentOpenFailed")), {
            duration: 9000,
          });
          return false;
        }

        /**
         * Guarda o token do pedido para o retorno do provedor.
         *
         * O token é de uso único: depois de criar a cobrança ele não serve mais
         * para pagar, mas continua servindo para CONSULTAR o status — é assim
         * que a página confirma o pagamento quando o comprador volta.
         */
        try {
          sessionStorage.setItem(
            PENDING_PAYMENT_KEY,
            JSON.stringify({
              orderId: created.order_id,
              token: created.checkout_token,
              provider: payment.provider,
              at: Date.now(),
            }),
          );
        } catch {
          /* navegador sem sessionStorage: o polling simplesmente não roda */
        }

        setCart([]);
        setCartOpen(false);
        window.location.href = String(paid.checkout_url);
        return true;
      }

      // ── Finalização pelo WhatsApp (apenas sem pagamento online) ────────
      if (payment) {
        toast.error(t("catalog.errors.paymentUnavailable"), { duration: 9000 });
        return false;
      }
      openWhatsapp(buildMessage(subtotal, grandTotal, serverShipping));

      setCart([]);
      setCartOpen(false);
      return true;
    },
    [catalog, cart, currency, paymentMethods, pixConfig, t, total],
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
        <p className="text-sm text-muted-foreground">{t("catalog.errors.loadCatalog")}</p>
        <p className="mt-4 w-full max-w-md break-all rounded-xl bg-muted p-3 text-xs text-muted-foreground">
          {queryError.message}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="app-shell grid place-items-center px-6 text-center">
        <p className="text-sm text-muted-foreground">{t("catalog.errors.catalogNotFound")}</p>
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

  const paymentProviderLabel = paymentReturn?.provider
    ? PROVIDER_LABELS[paymentReturn.provider]
    : t("catalog.paymentReturn.providerFallback");

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
      {/* Seletor de idioma: barra fixa no topo direito, sobre a capa e sem
          bloquear cliques (o wrapper não captura eventos). */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-end px-4 pt-3">
        <div className="pointer-events-auto">
          <LanguageSelector align="end" />
        </div>
      </div>
      {/* Aviso de retorno do pagamento: `pt-12` mantém o texto abaixo do
          seletor de idioma fixo no topo. */}
      {paymentReturn && (
        <div className="px-5 pt-12">
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              paymentReturn.status === "settled"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : paymentReturn.status === "failed"
                  ? "border-red-300 bg-red-50 text-red-900"
                  : paymentReturn.status === "pending"
                    ? "border-amber-300 bg-amber-50 text-amber-900"
                    : "border-primary/30 bg-primary/5 text-foreground"
            }`}
            role="status"
            aria-live="polite"
          >
            {paymentReturn.status === "checking" && (
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
                {t("catalog.paymentReturn.checking", { provider: paymentProviderLabel })}
              </span>
            )}
            {paymentReturn.status === "settled" && (
              <span>{t("catalog.paymentReturn.settled")}</span>
            )}
            {paymentReturn.status === "failed" && <span>{t("catalog.paymentReturn.failed")}</span>}
            {paymentReturn.status === "pending" && (
              <span>{t("catalog.paymentReturn.pending", { provider: paymentProviderLabel })}</span>
            )}
          </div>
        </div>
      )}
      <header className="relative">
        <div
          className="relative h-36 w-full bg-cover bg-center"
          style={{ backgroundColor: loadedCatalog.accent_color ?? "#f3eefc" }}
        >
          {loadedCatalog.cover_url && (
            <img
              src={
                optimizedImageUrl(loadedCatalog.cover_url, IMAGE_WIDTHS.card) ??
                loadedCatalog.cover_url
              }
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              onError={imageFallback(loadedCatalog.cover_url)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="cover-glass h-full w-full" />
        </div>
        <div className="px-5">
          <div className="mt-2 flex items-end gap-3" style={{ justifyContent: logoJustify }}>
            <div
              className={`${logoSizeClass} shrink-0 overflow-hidden rounded-full border-4 border-background bg-muted`}
              style={{ backgroundColor: loadedCatalog.accent_color ?? "#f3eefc" }}
            >
              {loadedCatalog.logo_url && (
                <img
                  src={
                    optimizedImageUrl(loadedCatalog.logo_url, IMAGE_WIDTHS.card) ??
                    loadedCatalog.logo_url
                  }
                  alt={loadedCatalog.store_name}
                  loading="eager"
                  decoding="async"
                  onError={imageFallback(loadedCatalog.logo_url)}
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
            <span className="text-sm text-muted-foreground">{t("catalog.header.cart")}</span>
          </div>
          <p className="mt-1 text-center text-sm text-muted-foreground">
            {t("catalog.header.orderHint")}
          </p>
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
        {[
          ...FILTERS.map((f) => ({ id: f.id, label: t(f.key) })),
          ...categories.map((c) => ({ id: c.id, label: c.name })),
        ].map(({ id, label }) => {
          const active = filter === id;
          return (
            <button
              key={id}
              onClick={() => setFilter(id)}
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
            {t("catalog.filters.empty")}
          </p>
        )}
        {products.map((product, index) => (
          <article
            key={product.id}
            className="overflow-hidden rounded-2xl border border-border bg-card"
          >
            <button onClick={() => setSelected(product)} className="block w-full text-left">
              <div className="aspect-square w-full bg-muted">
                {product.images?.[0] && (
                  <img
                    src={
                      optimizedImageUrl(product.images[0], IMAGE_WIDTHS.card) ?? product.images[0]
                    }
                    srcSet={optimizedImageSrcSet(product.images[0]) ?? undefined}
                    sizes="(max-width: 640px) 33vw, 240px"
                    alt={product.name}
                    width={IMAGE_WIDTHS.card}
                    height={IMAGE_WIDTHS.card}
                    loading={index === 0 ? "eager" : "lazy"}
                    fetchPriority={index === 0 ? "high" : "auto"}
                    decoding="async"
                    onError={imageFallback(product.images[0])}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="p-2">
                <p className="line-clamp-2 text-xs font-semibold text-foreground">{product.name}</p>
                <p className="mt-0.5 text-xs">
                  {product.price_options && product.price_options.length > 0 ? (
                    <span
                      className="font-bold"
                      style={{ color: loadedCatalog.primary_color ?? "#8b5cf6" }}
                    >
                      {product.price_options.length === 1
                        ? money(product.price_options[0]!.price)
                        : `${money(Math.min(...product.price_options.map((o) => o.price)))} – ${money(Math.max(...product.price_options.map((o) => o.price)))}`}
                    </span>
                  ) : product.sale_price ? (
                    <>
                      <span className="text-xs text-muted-foreground line-through">
                        {money(Number(product.price))}
                      </span>{" "}
                      <span
                        className="font-bold"
                        style={{ color: loadedCatalog.primary_color ?? "#8b5cf6" }}
                      >
                        {money(Number(product.sale_price))}
                      </span>
                    </>
                  ) : (
                    <span className="font-bold text-foreground">
                      {money(Number(product.price))}
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
                {product.available ? t("catalog.product.add") : t("catalog.product.soldOut")}
              </button>
            </div>
          </article>
        ))}
      </section>

      {/* ── Formas de pagamento (catalog view) ── */}
      {(activePayments.length > 0 || (paymentMethods?.length ?? 0) > 0) && (
        <section className="mt-8 px-5">
          <h2
            className="text-lg font-bold text-center"
            style={{
              fontFamily: getFontFamily(loadedCatalog.store_font ?? "moderna"),
              color: primary,
            }}
          >
            {t("catalog.paymentMethods.title")}
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {(paymentMethods ?? []).map((m) => (
              <div
                key={m.provider}
                className="flex items-center gap-3 rounded-2xl border p-4"
                style={{
                  borderColor: `${primary}20`,
                  backgroundColor: bgColor === "#FFFFFF" || !bgColor ? `${primary}06` : accent,
                }}
              >
                <div
                  className="flex size-9 items-center justify-center rounded-full text-xs font-bold"
                  style={{ background: `${primary}15`, color: primary }}
                >
                  MP
                </div>
                <span className="text-sm font-medium text-foreground">{m.label}</span>
              </div>
            ))}
            {activePayments.map((m) => (
              <div
                key={m.key}
                className="flex items-center gap-3 rounded-2xl border p-4"
                style={{
                  borderColor: `${primary}20`,
                  backgroundColor: bgColor === "#FFFFFF" || !bgColor ? `${primary}06` : accent,
                }}
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
                <span className="text-sm font-medium text-foreground">
                  {paymentMethodLabel(m.key, t, m.label)}
                </span>
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
          <span className="text-sm font-semibold">{tp("common.itemsCount", count)}</span>
          <span className="font-bold">{money(total)}</span>
        </button>
      )}

      {selected && (
        <ProductSheet
          key={`${selected.id}-${deepLink?.productId === selected.id ? (deepLink.priceOptionId ?? "") : ""}`}
          product={selected}
          primary={loadedCatalog.primary_color ?? "#8b5cf6"}
          money={money}
          initialPriceOptionId={
            deepLink?.productId === selected.id ? deepLink.priceOptionId : null
          }
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
          currency={currency}
          money={money}
          displayCurrency={selectedCurrency}
          conversionAvailable={conversionAvailable}
          ratesLoading={ratesQuery.isLoading}
          unavailableCurrencyCodes={unavailableCurrencyCodes}
          onCurrencyChange={(code) => {
            currencyChosenByBuyer.current = true;
            setDisplayCurrency(code);
          }}
          deliveryMethods={
            Array.isArray(loadedCatalog.delivery_methods) ? loadedCatalog.delivery_methods : []
          }
          paymentMethods={paymentMethods ?? []}
          pixConfig={pixConfig ?? null}
          onlinePaymentAvailable={(paymentMethods?.length ?? 0) > 0 || !!pixConfig?.available}
          onClose={() => setCartOpen(false)}
          onChangeQty={changeQty}
          onRemove={removeItem}
          onFinish={finishOrder}
        />
      )}

      {/* Botão flutuante WhatsApp */}
      {loadedCatalog.whatsapp && !isOwner && (
        <a
          href={whatsappLink(
            loadedCatalog.whatsapp,
            t("catalog.whatsapp.helloStore", { store: loadedCatalog.store_name }),
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="whatsapp-float fixed bottom-6 right-6 z-40 grid size-14 place-items-center rounded-full text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
          style={{ background: whatsappColor }}
          aria-label={t("catalog.whatsapp.contactStore")}
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
            {t("catalog.footer.backHome")}
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
  const { t } = useI18n();
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
    if (!touchRef.current) {
      setPaused(false);
      return;
    }
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
                    src={optimizedImageUrl(b.image_url, IMAGE_WIDTHS.card) ?? b.image_url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={imageFallback(b.image_url)}
                    className="h-48 w-full rounded-2xl object-cover"
                    style={{ objectPosition: b.object_position ?? "center" }}
                  />
                </a>
              ) : (
                <img
                  src={optimizedImageUrl(b.image_url, IMAGE_WIDTHS.card) ?? b.image_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  onError={imageFallback(b.image_url)}
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
              aria-label={t("catalog.banner.previous")}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => scrollToIdx(activeIdx < banners.length - 1 ? activeIdx + 1 : 0)}
              className="absolute right-2 top-1/2 -translate-y-1/2 grid size-8 place-items-center rounded-full bg-black/30 text-white backdrop-blur-sm transition hover:bg-black/50 max-sm:hidden"
              aria-label={t("catalog.banner.next")}
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
                backgroundColor: i === activeIdx ? "var(--shop-primary)" : "var(--color-border)",
              }}
              aria-label={t("catalog.banner.goTo", { index: i + 1 })}
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
  money,
  initialPriceOptionId,
  onClose,
  onAdd,
}: {
  product: Product;
  primary: string;
  money: (value: number) => string;
  initialPriceOptionId?: string | null;
  onClose: () => void;
  onAdd: (item: CartItem) => void;
}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [quantity, setQuantity] = useState(1);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [selectedPriceOption, setSelectedPriceOption] = useState<string | null>(() =>
    product.price_options?.some((option) => option.id === initialPriceOptionId)
      ? (initialPriceOptionId ?? null)
      : null,
  );
  const [imgIdx, setImgIdx] = useState(0);
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  const [checkoutBanner, setCheckoutBanner] = useState<CheckoutBannerConfig | null>(null);
  const [checkoutTestimonials, setCheckoutTestimonials] = useState<TestimonialConfig[]>([]);
  const [countdownNow, setCountdownNow] = useState(Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const images = product.images ?? [];
  const hasPriceOptions = (product.price_options?.length ?? 0) > 0;
  const checkoutConfig = useMemo(
    () =>
      parseCheckoutConfig(
        isMobile ? product.checkout_mobile_config : product.checkout_desktop_config,
      ),
    [product, isMobile],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ data: banners }, { data: testimonials }] = await Promise.all([
        supabase
          .from("banners")
          .select("image_url, object_position, href")
          .eq("product_id", product.id)
          .eq("device", isMobile ? "mobile" : "desktop")
          .limit(1),
        supabase
          .from("product_testimonials")
          .select("id, customer_name, content, stars, truth_confirmed")
          .eq("product_id", product.id)
          .eq("truth_confirmed", true)
          .order("position", { ascending: true }),
      ]);
      if (!active) return;
      const first = banners?.[0];
      setCheckoutBanner(
        first
          ? {
              imageUrl: first.image_url,
              objectPosition: first.object_position ?? "center",
              href: first.href ?? "",
            }
          : null,
      );
      setCheckoutTestimonials(
        (testimonials ?? []).map((row) => ({
          id: row.id,
          customerName: row.customer_name,
          content: row.content,
          stars: row.stars,
          truthConfirmed: row.truth_confirmed,
        })),
      );
    })();
    return () => {
      active = false;
    };
  }, [product.id, isMobile]);

  useEffect(() => {
    if (!checkoutConfig.countdown.enabled) return;
    const id = window.setInterval(() => setCountdownNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [checkoutConfig.countdown.enabled]);

  const countdown = countdownParts(checkoutConfig.countdown.endsAt, countdownNow);

  const activePriceOption = hasPriceOptions
    ? (product.price_options.find((o) => o.id === selectedPriceOption) ?? null)
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
      toast.error(t("catalog.product.priceChoiceRequired"));
      return;
    }
    const missing = (product.variations ?? []).find((g) => g.options.length && !choices[g.name]);
    if (missing) {
      toast.error(t("catalog.product.variationRequired", { name: missing.name }));
      return;
    }
    const variation = [
      activePriceOption
        ? t("catalog.product.priceOptionPrefix", { label: activePriceOption.label })
        : "",
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
      product_type: product.product_type ?? null,
      weight_grams: product.weight_grams,
      length_cm: product.length_cm,
      width_cm: product.width_cm,
      height_cm: product.height_cm,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-foreground/40">
      <div
        className="mt-8 flex w-full max-w-[30rem] flex-col overflow-hidden rounded-t-3xl bg-background"
        style={
          product.checkout_enabled
            ? ({
                "--shop-primary": checkoutConfig.primaryColor,
                "--shop-accent": checkoutConfig.secondaryColor,
                background: checkoutConfig.backgroundColor,
                color: checkoutConfig.textColor,
              } as React.CSSProperties)
            : undefined
        }
      >
        {product.checkout_enabled && checkoutBanner?.imageUrl && (
          <img
            src={
              optimizedImageUrl(checkoutBanner.imageUrl, IMAGE_WIDTHS.card) ??
              checkoutBanner.imageUrl
            }
            srcSet={optimizedImageSrcSet(checkoutBanner.imageUrl) ?? undefined}
            sizes="100vw"
            alt=""
            loading="lazy"
            decoding="async"
            onError={imageFallback(checkoutBanner.imageUrl)}
            className="w-full object-cover"
            style={{ aspectRatio: isMobile ? "390 / 156" : "480 / 192", objectPosition: checkoutBanner.objectPosition }}
          />
        )}
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
                    src={optimizedImageUrl(url, IMAGE_WIDTHS.detail) ?? url}
                    srcSet={optimizedImageSrcSet(url) ?? undefined}
                    sizes="(max-width: 640px) 100vw, 480px"
                    alt={`${product.name} ${i + 1}`}
                    width={IMAGE_WIDTHS.detail}
                    height={IMAGE_WIDTHS.detail}
                    loading={i === 0 || Math.abs(i - imgIdx) <= 1 ? "eager" : "lazy"}
                    fetchPriority={i === 0 ? "high" : "auto"}
                    decoding="async"
                    onError={imageFallback(url)}
                    className="h-full w-full object-cover"
                  />
                </div>
              </button>
            ))}
            {images.length === 0 && <div className="aspect-square max-h-[45vh] w-full bg-muted" />}
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
            aria-label={t("common.back")}
            className="absolute left-4 top-4 grid size-10 place-items-center rounded-full bg-background/90"
          >
            <ChevronLeft className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <h2 className="text-xl font-bold text-foreground">{product.name}</h2>
          <p className="mt-1 text-lg font-bold" style={{ color: primary }}>
            {money(price)}
            {!activePriceOption && product.sale_price != null && product.sale_price > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground line-through">
                {money(Number(product.price))}
              </span>
            )}
          </p>
          {product.description && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          )}

          {product.checkout_enabled && checkoutConfig.countdown.enabled && (
            <div
              className={`mt-4 rounded-xl px-3 py-2 text-center text-sm ${countdown.expired ? "opacity-70" : ""}`}
              style={{
                background: checkoutConfig.countdown.backgroundColor,
                color: checkoutConfig.countdown.textColor,
              }}
            >
              {checkoutConfig.countdown.message}:{" "}
              <strong style={{ color: checkoutConfig.countdown.numberColor }}>
                {String(countdown.hours).padStart(2, "0")}:
                {String(countdown.minutes).padStart(2, "0")}:
                {String(countdown.seconds).padStart(2, "0")}
              </strong>
            </div>
          )}

          {product.checkout_enabled && checkoutConfig.guarantee.enabled && (
            <p
              className="mt-3 rounded-xl border px-3 py-2 text-center text-sm font-semibold"
              style={{ color: checkoutConfig.guarantee.color, borderColor: checkoutConfig.guarantee.color }}
            >
              🛡 {checkoutConfig.guarantee.text} · {checkoutConfig.guarantee.days}{" "}
              {t("checkoutEditor.guarantee.daysSuffix")}
            </p>
          )}

          {product.checkout_enabled && (checkoutConfig.benefits || checkoutConfig.included) && (
            <div className="mt-4 rounded-xl bg-muted/60 p-3 text-sm">
              {checkoutConfig.benefits && (
                <p className="whitespace-pre-line">{checkoutConfig.benefits}</p>
              )}
              {checkoutConfig.included && (
                <p className="mt-2 whitespace-pre-line">{checkoutConfig.included}</p>
              )}
            </div>
          )}

          {product.checkout_enabled && product.additional_info && (
            <p className="mt-3 whitespace-pre-line text-xs text-muted-foreground">
              {product.additional_info}
            </p>
          )}

          {product.checkout_enabled &&
            checkoutConfig.testimonialsEnabled &&
            checkoutTestimonials.length > 0 && (
              <div className="mt-5 space-y-2">
                {checkoutTestimonials.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border p-3 text-sm">
                    <div className="flex gap-0.5 text-amber-500">
                      {Array.from({ length: item.stars }, (_, i) => (
                        <span key={i}>★</span>
                      ))}
                    </div>
                    <p>{item.content}</p>
                    <p className="text-xs text-muted-foreground">— {item.customerName}</p>
                  </div>
                ))}
              </div>
            )}

          {hasPriceOptions && (
            <div className="mt-5">
              <p className="text-sm font-semibold text-foreground">
                {t("catalog.product.priceChoice")}
              </p>
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
                      {opt.label} — {money(opt.price)}
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
            <span className="text-sm font-semibold text-foreground">{t("common.quantity")}</span>
            <div className="flex items-center gap-3 rounded-full border border-border px-3 py-1.5">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                aria-label={t("catalog.product.decrease")}
              >
                <Minus className="size-4" />
              </button>
              <span className="w-6 text-center font-semibold">{quantity}</span>
              <button
                onClick={() => setQuantity(quantity + 1)}
                aria-label={t("catalog.product.increase")}
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="border-t border-border p-5">
          <button
            onClick={handleAdd}
            disabled={!product.available}
            className={`btn-shimmer btn-elevated w-full font-semibold disabled:opacity-50 transition-transform hover:scale-[1.02] ${
              product.checkout_enabled && checkoutConfig.buttonStyle === "outline"
                ? "border bg-transparent rounded-2xl py-4"
                : product.checkout_enabled && checkoutConfig.buttonStyle === "rounded"
                  ? "rounded-full py-4"
                  : "rounded-2xl py-4"
            } ${
              product.checkout_enabled && checkoutConfig.buttonSize === "lg"
                ? "py-5 text-lg"
                : product.checkout_enabled && checkoutConfig.buttonSize === "sm"
                  ? "py-2.5 text-sm"
                  : ""
            }`}
            style={{
              background:
                product.checkout_enabled && checkoutConfig.buttonStyle !== "outline"
                  ? checkoutConfig.buttonColor
                  : product.checkout_enabled
                    ? "transparent"
                    : primary,
              color:
                product.checkout_enabled && checkoutConfig.buttonStyle !== "outline"
                  ? checkoutConfig.buttonTextColor
                  : product.checkout_enabled
                    ? checkoutConfig.buttonColor
                    : "#fff",
              borderColor: product.checkout_enabled ? checkoutConfig.buttonColor : undefined,
            }}
          >
            {!product.available
              ? t("catalog.product.soldOutTitle")
              : product.checkout_enabled && checkoutConfig.buttonText
                ? `${checkoutConfig.buttonText} · ${money(price * quantity)}`
                : t("catalog.product.addWithPrice", { price: money(price * quantity) })}
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
            aria-label={t("common.close")}
            className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/20 text-white backdrop-blur-sm"
          >
            <X className="size-5" />
          </button>
          <img
            src={optimizedImageUrl(zoomUrl, IMAGE_WIDTHS.detail, 90) ?? zoomUrl}
            alt={product.name}
            loading="eager"
            onError={imageFallback(zoomUrl)}
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
  currency,
  money,
  displayCurrency,
  conversionAvailable,
  ratesLoading,
  unavailableCurrencyCodes,
  onCurrencyChange,
  deliveryMethods,
  paymentMethods,
  pixConfig,
  onlinePaymentAvailable,
  onClose,
  onChangeQty,
  onRemove,
  onFinish,
}: {
  catalogId: string;
  items: CartItem[];
  total: number;
  primary: string;
  currency: string;
  money: (value: number) => string;
  displayCurrency: string;
  conversionAvailable: boolean;
  ratesLoading: boolean;
  unavailableCurrencyCodes: string[];
  onCurrencyChange: (code: string) => void;
  deliveryMethods: string[];
  paymentMethods: PublicPaymentMethod[];
  pixConfig: PixPublicConfig | null;
  onlinePaymentAvailable: boolean;
  onClose: () => void;
  onChangeQty: (key: string, delta: number) => void;
  onRemove: (key: string) => void;
  onFinish: (
    name: string,
    phone: string,
    email: string,
    note: string,
    shipping: {
      deliveryMethod: string;
      shippingZip?: string;
      address?: CustomerAddress;
      quote?: ShippingQuote | null;
      shippingCost: number;
    },
    payment: { provider: PaymentProviderKey | "pix_manual" } | null,
  ) => Promise<boolean | PixOrderResult>;
}) {
  const { t } = useI18n();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [observation, setObservation] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<string>("");
  const [cep, setCep] = useState("");
  const [quotes, setQuotes] = useState<ShippingQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<string>("");
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [quoteMsg, setQuoteMsg] = useState<string>("");
  const [coverageMsg, setCoverageMsg] = useState<string>("");
  /** `null` = finalizar pelo WhatsApp (apenas se a loja não tiver pagamento online). */
  const [paymentProvider, setPaymentProvider] = useState<PaymentProviderKey | "pix_manual" | null>(
    null,
  );
  const defaultOnlineProvider: PaymentProviderKey | "pix_manual" =
    paymentMethods[0]?.provider ?? "pix_manual";
  /** Com pagamento online habilitado, o WhatsApp deixa de ser oferecido. */
  const effectiveProvider: PaymentProviderKey | "pix_manual" | null = onlinePaymentAvailable
    ? (paymentProvider ?? defaultOnlineProvider)
    : null;
  const [pixOrder, setPixOrder] = useState<PixOrderResult | null>(null);
  const [qrZoom, setQrZoom] = useState(false);
  const [pixDeclared, setPixDeclared] = useState(false);
  const [pixApproved, setPixApproved] = useState(false);
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
  const shippingCost = deliveryMethod === "melhor_envio" ? (selected?.price ?? 0) : 0;
  const grandTotal = fromMinorUnits(
    toMinorUnits(subtotal, currency) + toMinorUnits(shippingCost, currency),
    currency,
  );

  const hasMelhorEnvio = deliveryMethods.includes("melhor_envio");
  const hasPhysical = items.some((i) => i.product_type !== "digital");
  const hasDigital = items.some((i) => i.product_type === "digital");

  useEffect(() => {
    if (!pixOrder) return;
    let active = true;
    const check = async () => {
      const status = await getPixOrderStatus(pixOrder.order_id, pixOrder.checkout_token);
      if (!active || !status.success) return;
      if (status.payment_status === "approved") setPixApproved(true);
      else if (status.pix_declared_at) setPixDeclared(true);
    };
    void check();
    const id = window.setInterval(() => void check(), 5000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [pixOrder]);

  useEffect(() => {
    if (!deliveryMethod && deliveryMethods.length === 1) {
      setDeliveryMethod(deliveryMethods[0]!);
    }
  }, [deliveryMethods, deliveryMethod]);

  async function handleQuote() {
    if (!isValidCep(cep)) {
      toast.error(t("catalog.shippingErrors.invalidCep"));
      return;
    }
    const physical = items.filter((i) => i.product_type !== "digital");
    if (physical.length === 0) {
      setQuotes([]);
      setSelectedQuote("");
      setQuoteMsg(t("catalog.shippingErrors.digitalOnly"));
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
        product_type: i.product_type ?? null,
        weight_grams: i.weight_grams ?? null,
        length_cm: i.length_cm ?? null,
        width_cm: i.width_cm ?? null,
        height_cm: i.height_cm ?? null,
        quantity: i.quantity,
        unit_price: i.unitPrice,
      })),
    });
    setQuoting(false);
    console.log(
      "[ME quote] cep=",
      cep,
      "| items=",
      items.map((i) => ({
        name: i.name,
        qty: i.quantity,
        type: i.product_type ?? "fisico",
        weight_grams: i.weight_grams ?? null,
        dims: [i.length_cm, i.width_cm, i.height_cm].some((v) => v != null)
          ? `${i.length_cm ?? "?"}x${i.width_cm ?? "?"}x${i.height_cm ?? "?"}cm`
          : null,
      })),
      "| =>",
      res.success && Array.isArray(res.quotes)
        ? res.quotes.map((q) => ({
            id: q.serviceId,
            name: q.name,
            price: q.price,
            delivery: q.delivery_text,
          }))
        : { error: res.error, type: res.error_type, http: res.http_status },
    );
    setCoverageMsg(res.coverage_message ?? "");
    if (res.success && Array.isArray(res.quotes) && res.quotes.length) {
      setQuotes(res.quotes as ShippingQuote[]);
    } else {
      setQuoteMsg(
        res.error === "not_connected"
          ? t("catalog.shippingErrors.notConnected")
          : res.error === "needs_reconnect"
            ? (res.message ?? t("catalog.shippingErrors.needsReconnect"))
            : res.error === "no_origin"
              ? (res.message ?? t("catalog.shippingErrors.noOrigin"))
              : res.error === "products_no_dimensions"
                ? (res.message ?? t("catalog.shippingErrors.noDimensions"))
                : res.error === "no_options"
                  ? res.coverage_message
                    ? t("catalog.shippingErrors.noOptionsWithCoverage", {
                        coverage: res.coverage_message,
                      })
                    : t("catalog.shippingErrors.noOptionsRetry")
                  : res.error && res.error.length > 60
                    ? res.error
                    : res.error && res.error !== "no_options"
                      ? res.error
                      : t("catalog.shippingErrors.noOptionsCheck"),
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
        if (autoFill) toast.error(t("catalog.shippingErrors.cepNotFound"));
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
    } else {
      setAddress((prev) => ({
        ...prev,
        street: "",
        district: "",
        city: "",
        state: "",
      }));
      setQuotes([]);
      setSelectedQuote("");
      setQuoteMsg("");
      setCoverageMsg("");
    }
  }

  async function submit(shipping: {
    deliveryMethod: string;
    shippingZip?: string;
    address?: CustomerAddress;
    quote?: ShippingQuote | null;
    shippingCost: number;
  }) {
    if (submitting) return;
    setSubmitting(true);
    try {
      const result = await onFinish(
        customerName,
        customerPhone,
        customerEmail,
        observation,
        shipping,
        effectiveProvider ? { provider: effectiveProvider } : null,
      );
      if (result && typeof result === "object" && result.pix) {
        setQrZoom(false);
        setPixOrder(result);
      } else if (result) {
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleFinish() {
    // Trava anti-duplo clique: evita dois pedidos iguais.
    if (submitting) return;
    if (!customerName.trim()) {
      toast.error(t("catalog.errors.nameRequired"));
      return;
    }
    if (hasDigital) {
      const email = customerEmail.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        toast.error(t("catalog.errors.emailRequired"));
        return;
      }
      if (email !== confirmEmail.trim().toLowerCase()) {
        toast.error(t("catalog.errors.emailMismatch"));
        return;
      }
    }
    if (hasMelhorEnvio && deliveryMethod === "melhor_envio") {
      const physical = items.filter((i) => i.product_type !== "digital");
      if (physical.length === 0) {
        void submit({
          deliveryMethod,
          ...(cep ? { shippingZip: cep } : {}),
          address,
          quote: null,
          shippingCost: 0,
        });
        return;
      }
      if (!isValidCep(cep)) {
        toast.error(t("catalog.shippingErrors.cepRequired"));
        return;
      }
      if (quotes.length === 0) {
        toast.error(t("catalog.shippingErrors.noOptionsFinish"));
        return;
      }
      if (!selected) {
        toast.error(t("catalog.shippingErrors.chooseMethod"));
        return;
      }
    }
    void submit({
      deliveryMethod,
      ...(cep ? { shippingZip: cep } : {}),
      address,
      quote: selected,
      shippingCost,
    });
  }

  async function handleDeclarePix() {
    if (!pixOrder) return;
    const result = await declarePixPaid(pixOrder.order_id, pixOrder.checkout_token);
    if (result.success) {
      setPixDeclared(true);
      toast.success(t("catalog.pix.declared"));
    } else {
      toast.error(String(result.error ?? t("catalog.pix.invalid")));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-foreground/40 md:items-center md:p-6">
      <div className="relative flex h-full w-full max-w-[30rem] flex-col rounded-t-3xl bg-background shadow-xl md:h-auto md:max-h-[calc(100dvh-3rem)] md:max-w-[34rem] md:rounded-2xl">
        <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-5 py-4">
          <h2 className="truncate text-lg font-bold text-foreground">{t("catalog.cart.title")}</h2>
          <button
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid size-9 shrink-0 place-items-center rounded-full border border-border"
          >
            <X className="size-4" />
          </button>
        </header>

        {pixOrder && (
          <div className="absolute inset-0 z-10 flex flex-col bg-background">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
              <h3 className="text-lg font-bold text-foreground">{t("catalog.pix.title")}</h3>
              <p className="text-sm text-muted-foreground">
                {money(pixOrder.total)} · {pixOrder.pix.holderName
                  ? `${t("catalog.pix.holder")}: ${pixOrder.pix.holderName}`
                  : ""}
              </p>

              {pixOrder.pix.qrUrl && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">
                    {t("catalog.pix.qrTitle")}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("catalog.pix.scanQr")}
                  </p>
                  <button
                    type="button"
                    onClick={() => setQrZoom(true)}
                    aria-label={t("catalog.pix.qrTitle")}
                    className="mx-auto block w-full max-w-[19rem] rounded-2xl border border-border bg-white p-3 shadow-sm transition hover:border-primary"
                  >
                    <img
                      src={pixOrder.pix.qrUrl}
                      alt={t("catalog.pix.qrTitle")}
                      loading="eager"
                      decoding="async"
                      className="mx-auto aspect-square w-full object-contain"
                    />
                    <span className="mt-2 block text-center text-xs font-medium text-primary">
                      {t("catalog.pix.qrZoomHint")}
                    </span>
                  </button>
                </div>
              )}

              {pixOrder.pix.keyValue && (
                <div className="space-y-2 rounded-2xl border border-border p-4">
                  <p className="text-sm font-semibold text-foreground">
                    {t("catalog.pix.keyTitle")} ({pixOrder.pix.keyType})
                  </p>
                  <p className="break-all font-mono text-sm text-foreground">
                    {pixOrder.pix.keyValue}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(String(pixOrder.pix.keyValue));
                      toast.success(t("catalog.pix.copied"));
                    }}
                    className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground"
                  >
                    {t("catalog.pix.copyKey")}
                  </button>
                </div>
              )}

              {pixApproved ? (
                <p className="rounded-xl bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-700">
                  {t("catalog.pix.approved")}
                </p>
              ) : pixDeclared ? (
                <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-700">
                  {t("catalog.pix.declared")}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("catalog.pix.waiting")}</p>
              )}
            </div>

            <div className="space-y-2 border-t border-border p-4">
              <button
                type="button"
                disabled={pixDeclared || pixApproved}
                onClick={() => void handleDeclarePix()}
                className="w-full rounded-2xl bg-primary py-3.5 font-semibold text-primary-foreground disabled:opacity-50"
              >
                {t("catalog.pix.declarePaid")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setQrZoom(false);
                  setPixOrder(null);
                  onClose();
                }}
                className="w-full rounded-2xl border border-border py-3 text-sm font-semibold text-muted-foreground"
              >
                {t("common.close")}
              </button>
            </div>

            {qrZoom && pixOrder.pix.qrUrl && (
              <div
                className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/95 p-5"
                onClick={() => setQrZoom(false)}
              >
                <button
                  type="button"
                  onClick={() => setQrZoom(false)}
                  aria-label={t("common.close")}
                  className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/20 text-white backdrop-blur-sm"
                >
                  <X className="size-5" />
                </button>
                <img
                  src={pixOrder.pix.qrUrl}
                  alt={t("catalog.pix.qrTitle")}
                  loading="eager"
                  className="max-h-[75vh] max-w-full rounded-xl bg-white object-contain p-3"
                />
                <p className="text-center text-sm text-white/80">{t("catalog.pix.scanQr")}</p>
              </div>
            )}
          </div>
        )}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pt-4 pb-4">
          <div className="space-y-2">
            {items.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                {t("catalog.cart.empty")}
              </p>
            )}
            {items.map((item) => (
              <div
                key={item.key}
                className="flex gap-3 rounded-2xl border border-border bg-card p-3"
              >
                <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
                  {item.image && (
                    <img
                      src={optimizedImageUrl(item.image, IMAGE_WIDTHS.thumb) ?? item.image}
                      alt={item.name}
                      width={IMAGE_WIDTHS.thumb}
                      height={IMAGE_WIDTHS.thumb}
                      loading="lazy"
                      decoding="async"
                      onError={imageFallback(item.image)}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">{item.name}</p>
                  {item.variation && (
                    <p className="truncate text-xs text-muted-foreground">{item.variation}</p>
                  )}
                  <p className="text-sm font-semibold" style={{ color: primary }}>
                    {money(item.unitPrice * item.quantity)}
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex items-center gap-3 rounded-full border border-border px-3 py-1">
                      <button
                        onClick={() => onChangeQty(item.key, -1)}
                        aria-label={t("catalog.product.decrease")}
                      >
                        <Minus className="size-3.5" />
                      </button>
                      <span className="w-5 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => onChangeQty(item.key, 1)}
                        aria-label={t("catalog.product.increase")}
                      >
                        <Plus className="size-3.5" />
                      </button>
                    </div>
                    <button
                      onClick={() => onRemove(item.key)}
                      aria-label={t("catalog.cart.removeItem")}
                      className="text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {items.length > 0 && (
            <div className="space-y-3 rounded-2xl border border-border p-4">
              {deliveryMethods.length > 1 && (
                <div>
                  <label className="mb-2 block text-sm font-semibold text-foreground">
                    {t("catalog.cart.deliveryQuestion")}
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {deliveryMethods.map((m) => {
                      const meta = DELIVERY_METHODS.find((d) => d.key === m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDeliveryMethod(m)}
                          className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                            deliveryMethod === m
                              ? "border-[var(--shop-primary)] bg-[var(--shop-accent)] text-foreground"
                              : "border-border bg-card text-muted-foreground"
                          }`}
                        >
                          <span className="text-lg">{meta?.icon ?? "📦"}</span>
                          {deliveryMethodLabel(m, t, meta?.label)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {deliveryMethods.length === 1 && (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-foreground">
                  <span className="text-lg">
                    {DELIVERY_METHODS.find((d) => d.key === deliveryMethod)?.icon ?? "📦"}
                  </span>
                  {deliveryMethodLabel(deliveryMethod, t)}
                </div>
              )}

              {deliveryMethod === "melhor_envio" && !hasPhysical && (
                <p className="text-xs text-muted-foreground">{t("catalog.cart.digitalNotice")}</p>
              )}

              {deliveryMethod === "melhor_envio" && hasPhysical && (
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-foreground">
                    {t("catalog.cart.cepLabel")} <span className="text-destructive">*</span>
                  </label>
                  <p className="text-xs text-muted-foreground">{t("catalog.cart.cepHint")}</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={cep}
                      onChange={(e) => handleCepChange(e.target.value)}
                      placeholder="00000-000"
                      maxLength={9}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
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
                        t("catalog.cart.calculateShipping")
                      )}
                    </button>
                  </div>

                  {quoteMsg && <p className="text-xs text-muted-foreground">{quoteMsg}</p>}

                  {quotes.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 pt-1">
                      {quotes.map((q) => (
                        <button
                          key={q.serviceId}
                          type="button"
                          onClick={() => setSelectedQuote(q.serviceId)}
                          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${
                            selectedQuote === q.serviceId
                              ? "border-[var(--shop-primary)] bg-[var(--shop-accent)] text-foreground"
                              : "border-border bg-card text-muted-foreground"
                          }`}
                        >
                          <span className="font-semibold">{q.name}</span>
                          <span className="text-right">
                            <span className="block font-bold text-foreground">
                              {money(q.price)}
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

                  {quotes.length > 0 && coverageMsg && (
                    <p className="rounded-lg bg-[var(--shop-accent)]/60 px-3 py-2 text-xs font-medium text-foreground/80">
                      {coverageMsg}
                    </p>
                  )}
                </div>
              )}

              {(deliveryMethod === "melhor_envio" || deliveryMethod === "local_delivery") && (
                <div className="space-y-2 border-t border-dashed border-border pt-3">
                  <p className="text-sm font-semibold text-foreground">
                    {t("catalog.cart.addressTitle")}
                  </p>
                  <div>
                    <input
                      type="text"
                      value={address.street}
                      onChange={(e) => setAddress((p) => ({ ...p, street: e.target.value }))}
                      placeholder={t("catalog.cart.street")}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={address.number}
                      onChange={(e) => setAddress((p) => ({ ...p, number: e.target.value }))}
                      placeholder={t("catalog.cart.number")}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                    <input
                      type="text"
                      value={address.complement}
                      onChange={(e) => setAddress((p) => ({ ...p, complement: e.target.value }))}
                      placeholder={t("catalog.cart.complement")}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={address.district}
                      onChange={(e) => setAddress((p) => ({ ...p, district: e.target.value }))}
                      placeholder={t("catalog.cart.district")}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      type="text"
                      value={address.city}
                      onChange={(e) => setAddress((p) => ({ ...p, city: e.target.value }))}
                      placeholder={t("catalog.cart.city")}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                    <input
                      type="text"
                      value={address.state}
                      onChange={(e) => setAddress((p) => ({ ...p, state: e.target.value }))}
                      placeholder={t("catalog.cart.state")}
                      maxLength={2}
                      className="w-16 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-semibold text-foreground">
                  {t("catalog.cart.nameLabel")} <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder={t("catalog.cart.namePlaceholder")}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-foreground">
                  {t("catalog.cart.phoneLabel")}
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder={t("catalog.cart.phonePlaceholder")}
                  className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                />
              </div>
              {hasDigital && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-foreground">
                      {t("catalog.cart.emailLabel")} <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      inputMode="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder={t("catalog.cart.emailPlaceholder")}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-foreground">
                      {t("catalog.cart.confirmEmailLabel")} <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      inputMode="email"
                      value={confirmEmail}
                      onChange={(e) => setConfirmEmail(e.target.value)}
                      placeholder={t("catalog.cart.confirmEmailPlaceholder")}
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("catalog.cart.digitalEmailHint")}
                    </p>
                  </div>
                </>
              )}
              <div>
                <label className="mb-1 block text-sm font-semibold text-foreground">
                  {t("catalog.cart.noteLabel")}
                </label>
                <textarea
                  value={observation}
                  onChange={(e) => setObservation(e.target.value)}
                  placeholder={t("catalog.cart.notePlaceholder")}
                  rows={2}
                  className="w-full resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--shop-primary)]"
                />
              </div>

              {onlinePaymentAvailable && (
                <div>
                  <label className="mb-2 block text-sm font-semibold text-foreground">
                    {t("catalog.cart.paymentQuestion")}
                  </label>
                  <div className="grid grid-cols-1 gap-2">
                    {pixConfig?.available && (
                      <button
                        type="button"
                        onClick={() => setPaymentProvider("pix_manual")}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                          effectiveProvider === "pix_manual"
                            ? "border-[var(--shop-primary)] bg-[var(--shop-accent)] text-foreground"
                            : "border-border bg-card text-muted-foreground"
                        }`}
                      >
                        <span className="text-lg">⚡</span>
                        <span>
                          {t("catalog.pix.payWith")}
                          <span className="block text-xs font-normal text-muted-foreground">
                            {t("catalog.paymentMethods.pix")}
                          </span>
                        </span>
                      </button>
                    )}
                    {paymentMethods.map((method) => (
                      <button
                        key={method.provider}
                        type="button"
                        onClick={() => setPaymentProvider(method.provider)}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm font-medium transition-colors ${
                          effectiveProvider === method.provider
                            ? "border-[var(--shop-primary)] bg-[var(--shop-accent)] text-foreground"
                            : "border-border bg-card text-muted-foreground"
                        }`}
                      >
                        <span className="text-lg">💳</span>
                        <span>
                          {method.label}
                          <span className="block text-xs font-normal text-muted-foreground">
                            {t("catalog.cart.payOnlineIn", { currency: method.currency })}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("catalog.cart.paymentNotice")}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t border-border px-4 py-2.5">
          <div className="flex items-center gap-2" title={t("catalog.cart.currencyHint")}>
            <span className="shrink-0 text-[11px] font-semibold text-foreground">
              {t("catalog.cart.currencyLabel")}
            </span>
            <CurrencyPicker
              value={displayCurrency}
              onChange={onCurrencyChange}
              unavailableCodes={unavailableCurrencyCodes}
              compact
              className="min-w-0 flex-1"
            />
            {ratesLoading && (
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {t("catalog.cart.currencyLoading")}
              </span>
            )}
          </div>
          <p className="text-[10px] leading-tight text-muted-foreground">
            {conversionAvailable
              ? t("catalog.cart.currencyChargedIn", {
                  display: displayCurrency,
                  charge: currency,
                })
              : t("catalog.cart.currencyNoRate", {
                  display: displayCurrency,
                  charge: currency,
                })}
          </p>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("common.subtotal")}</span>
            <span>{money(subtotal)}</span>
          </div>
          {deliveryMethod === "melhor_envio" && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {t("catalog.cart.shipping")} {selected ? `(${selected.name})` : ""}
              </span>
              <span>{shippingCost > 0 ? money(shippingCost) : "—"}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm font-bold text-foreground">
            <span>{t("common.total")}</span>
            <span>{money(grandTotal)}</span>
          </div>
          <button
            onClick={handleFinish}
            disabled={items.length === 0 || submitting}
            className="btn-shimmer btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl py-3 font-semibold text-white disabled:opacity-50 transition-transform hover:scale-[1.02]"
            style={{ background: primary }}
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting
              ? effectiveProvider
                ? t("catalog.cart.openingPayment")
                : t("catalog.cart.submittingOrder")
              : effectiveProvider === "pix_manual"
                ? t("catalog.pix.payWith")
                : effectiveProvider
                  ? t("catalog.cart.payWith", {
                      provider: PROVIDER_LABELS[effectiveProvider] ?? "Mercado Pago",
                    })
                  : t("catalog.cart.finishWhatsapp")}
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
  const { t } = useI18n();
  const primary = catalog.primary_color ?? "#8b5cf6";
  const accent = catalog.accent_color ?? "#f3eefc";
  const bgColor = catalog.background_color ?? "#FFFFFF";
  const whatsappColor = catalog.whatsapp_button_color ?? "#8b5cf6";
  const activePayments = Array.isArray(catalog.payment_methods)
    ? PAYMENT_METHODS.filter((m) => (catalog.payment_methods as string[]).includes(m.key))
    : [];
  const hasOwnerInfo =
    catalog.owner_photo_url || catalog.owner_name || catalog.owner_bio || catalog.owner_hours;

  return (
    <div className="app-shell pb-20" style={{ ...theme, backgroundColor: bgColor }}>
      {/* Seletor de idioma: disponível já na capa, antes de entrar no catálogo. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-end px-4 pt-3">
        <div className="pointer-events-auto">
          <LanguageSelector align="end" />
        </div>
      </div>
      {/* ── Cover + Logo + Name ── */}
      <header className="relative">
        <div
          className="relative h-40 w-full bg-cover bg-center"
          style={{ backgroundColor: accent }}
        >
          {catalog.cover_url && (
            <img
              src={optimizedImageUrl(catalog.cover_url, IMAGE_WIDTHS.card) ?? catalog.cover_url}
              alt=""
              aria-hidden="true"
              loading="eager"
              decoding="async"
              onError={imageFallback(catalog.cover_url)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="cover-glass h-full w-full" />
        </div>
        <div className="px-5">
          <div className="mt-2 flex items-end gap-3" style={{ justifyContent: logoJustify }}>
            <div
              className={`${logoSizeClass} shrink-0 overflow-hidden rounded-full border-4 border-background bg-muted`}
              style={{ backgroundColor: accent }}
            >
              {catalog.logo_url && (
                <img
                  src={optimizedImageUrl(catalog.logo_url, IMAGE_WIDTHS.card) ?? catalog.logo_url}
                  alt={catalog.store_name}
                  loading="eager"
                  decoding="async"
                  onError={imageFallback(catalog.logo_url)}
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
            <CartIcon style={catalog.cart_style ?? "carrinho"} className="size-5" color={primary} />
            <span className="text-sm text-muted-foreground">{t("catalog.header.cart")}</span>
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
          {t("catalog.welcome.enter")}
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
            {t("catalog.welcome.followInstagram")}
          </a>
        </div>
      )}

      {/* ── WhatsApp button ── */}
      {catalog.whatsapp && (
        <div className="px-5 mt-3">
          <a
            href={whatsappLink(
              catalog.whatsapp,
              t("catalog.whatsapp.helloStore", { store: catalog.store_name }),
            )}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-shimmer btn-elevated flex w-full items-center justify-center gap-2 rounded-2xl py-4 font-semibold text-white transition-transform hover:scale-[1.02]"
            style={{ background: whatsappColor }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
            </svg>
            {t("catalog.whatsapp.contactStore")}
          </a>
        </div>
      )}

      {/* ── Como Funciona ── */}
      <section className="mt-8 px-5">
        <h2
          className="text-lg font-bold text-center"
          style={{ fontFamily: getFontFamily(catalog.store_font ?? "moderna"), color: primary }}
        >
          {t("catalog.welcome.howItWorks")}
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
              <p className="font-semibold text-foreground">{t("catalog.welcome.step1Title")}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t("catalog.welcome.step1Text")}
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
              <p className="font-semibold text-foreground">{t("catalog.welcome.step2Title")}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {t("catalog.welcome.step2Text")}
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
            {t("catalog.paymentMethods.title")}
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {activePayments.map((m) => (
              <div
                key={m.key}
                className="flex items-center gap-3 rounded-2xl border p-4"
                style={{
                  borderColor: `${primary}20`,
                  backgroundColor: bgColor === "#FFFFFF" || !bgColor ? `${primary}06` : accent,
                }}
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
                <span className="text-sm font-medium text-foreground">
                  {paymentMethodLabel(m.key, t, m.label)}
                </span>
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
            {t("catalog.welcome.about")}
          </h2>
          <div
            className="mt-4 flex flex-col items-center gap-4 rounded-2xl border p-5 text-center"
            style={{
              borderColor: `${primary}20`,
              backgroundColor: bgColor === "#FFFFFF" || !bgColor ? `${primary}06` : accent,
            }}
          >
            {catalog.owner_photo_url && (
              <img
                src={
                  optimizedImageUrl(catalog.owner_photo_url, IMAGE_WIDTHS.thumb) ??
                  catalog.owner_photo_url
                }
                alt={catalog.owner_name ?? t("catalog.welcome.ownerPhotoAlt")}
                loading="lazy"
                decoding="async"
                onError={imageFallback(catalog.owner_photo_url)}
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
              <p className="text-sm leading-relaxed text-muted-foreground">{catalog.owner_bio}</p>
            )}
            {catalog.owner_hours && (
              <div
                className="mt-1 flex items-center gap-2 rounded-xl px-4 py-2 text-sm text-muted-foreground"
                style={{ background: `${primary}0A` }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="size-4 shrink-0"
                >
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
          href={whatsappLink(
            catalog.whatsapp,
            t("catalog.whatsapp.helloStore", { store: catalog.store_name }),
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="whatsapp-float fixed bottom-6 right-6 z-40 grid size-14 place-items-center rounded-full text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
          style={{ background: whatsappColor }}
          aria-label={t("catalog.whatsapp.contactStore")}
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
            {t("catalog.footer.backHome")}
          </Link>
        </div>
      </nav>
    </div>
  );
}
