/**
 * Criação segura de pedidos.
 *
 * Substitui o INSERT anônimo direto em `orders`. O navegador envia apenas:
 *   catálogo, itens (id + quantidade + variação), dados do comprador e a
 *   modalidade de entrega escolhida. Preços, frete, moeda, subtotal e total são
 *   recalculados aqui, a partir dos dados oficiais do banco.
 */
import { adminClient, createCheckoutSession, type CatalogRow } from "./db.ts";
import { isValidEmail, normalizeEmail } from "../digital_delivery_pure.ts";
import { priceCart, computeTotals, type CartItemInput, type OfficialProduct, type PricedItem } from "./pricing.ts";
import { fromMinorUnits, resolveStoreCurrency, toMinorUnits } from "../../../../src/lib/currency.ts";
import { notifySellerNewOrder } from "../seller_notifications.ts";

export type SecureOrderInput = {
  catalogId: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  note?: string | null;
  items: CartItemInput[];
  deliveryMethod?: string | null;
  shippingZip?: string | null;
  shippingService?: string | null;
  /** Modalidade de pagamento usada por fluxos manuais (ex.: Pix manual). */
  paymentMethod?: "pix_manual" | null;
  address?: {
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    district?: string | null;
    city?: string | null;
    state?: string | null;
  } | null;
};

export type SecureOrderResult =
  | {
      ok: true;
      orderId: string;
      checkoutToken: string;
      currency: string;
      subtotal: number;
      shippingCost: number;
      total: number;
      items: PricedItem[];
      catalog: { id: string; slug: string; storeName: string; whatsapp: string | null };
    }
  | { ok: false; status: number; code: string; error: string };

const MAX_NAME = 120;
const MAX_NOTE = 1000;

function digits(value: string | null | undefined): string {
  return String(value ?? "").replace(/\D/g, "");
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

type QuoteItem = {
  product_type?: string | null;
  weight_grams?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  quantity: number;
  unit_price?: number;
};

/** Re-cota o frete no backend (nunca confia no valor enviado pelo navegador). */
async function reQuoteShipping(input: {
  catalogId: string;
  destinationZip: string;
  items: QuoteItem[];
  includeDigital?: boolean;
}): Promise<{ ok: true; quotes: Array<{ serviceId: string; name: string; price: number; delivery_min: number | null; delivery_text: string | null }> } | { ok: false; error: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return { ok: false, error: "Serviço de frete indisponível." };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const res = await fetch(`${supabaseUrl}/functions/v1/melhor-envio?action=quote`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        catalog_id: input.catalogId,
        destination_zip: input.destinationZip,
        items: input.items,
        include_digital: input.includeDigital === true,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      return {
        ok: false,
        error:
          data?.error ||
          "Não foi possível confirmar o frete agora. Tente novamente em instantes.",
      };
    }
    const quotes = Array.isArray(data.quotes)
      ? data.quotes.map((q: Record<string, unknown>) => ({
          serviceId: String(q.serviceId ?? ""),
          name: String(q.name ?? ""),
          price: Number(q.price ?? 0),
          delivery_min: q.delivery_min == null ? null : Number(q.delivery_min),
          delivery_text: (q.delivery_text as string | null) ?? null,
        }))
      : [];
    return { ok: true, quotes };
  } catch (error) {
    console.error("[orders] re-quote falhou", (error as Error).message);
    return {
      ok: false,
      error: "Não foi possível confirmar o frete agora. Tente novamente em instantes.",
    };
  }
}

export async function createSecureOrder(input: SecureOrderInput): Promise<SecureOrderResult> {
  const admin = adminClient();

  const { data: catalogData } = await admin
    .from("catalogs")
    .select("id, user_id, slug, store_name, whatsapp, currency, payment_methods, delivery_methods, shipping_origin_zip")
    .eq("id", input.catalogId)
    .maybeSingle();
  const catalog = catalogData as CatalogRow | null;
  if (!catalog) {
    return { ok: false, status: 404, code: "catalog_not_found", error: "Loja não encontrada." };
  }

  const currency = resolveStoreCurrency(catalog.currency);
  const customerName = cleanText(input.customerName, MAX_NAME);
  if (!customerName) {
    return { ok: false, status: 400, code: "missing_customer_name", error: "Informe seu nome para continuar." };
  }

  const requestedIds = (input.items ?? [])
    .map((item) => String(item.product_id ?? item.productId ?? "").trim())
    .filter(Boolean);
  if (requestedIds.length === 0) {
    return { ok: false, status: 400, code: "empty_cart", error: "O carrinho está vazio." };
  }

  const { data: productsData, error: productsError } = await admin
    .from("products")
    .select("id, catalog_id, name, price, sale_price, price_options, variations, available, product_type, weight_grams, length_cm, width_cm, height_cm, images")
    .eq("catalog_id", catalog.id)
    .in("id", Array.from(new Set(requestedIds)));
  if (productsError) {
    return { ok: false, status: 500, code: "products_unavailable", error: "Não foi possível validar os produtos." };
  }

  const priced = priceCart((productsData ?? []) as OfficialProduct[], input.items ?? [], currency);
  if (!priced.ok) {
    return { ok: false, status: 400, code: priced.code, error: priced.error };
  }

  // E-mail é obrigatório somente quando há produto digital no carrinho.
  // O tipo vem do banco (nunca do navegador).
  const customerEmail = normalizeEmail(String(input.customerEmail ?? ""));
  if (priced.items.some((item) => item.product_type === "digital")) {
    if (!isValidEmail(customerEmail)) {
      return {
        ok: false,
        status: 400,
        code: "invalid_customer_email",
        error: "Informe um e-mail válido para receber o produto digital.",
      };
    }
  }

  // ── Entrega ──────────────────────────────────────────────────────────────
  const deliveryMethods = Array.isArray(catalog.delivery_methods)
    ? (catalog.delivery_methods as string[])
    : [];
  const deliveryMethod = cleanText(input.deliveryMethod, 40);

  let shippingMinor = 0;
  let shippingService: string | null = null;
  let shippingServiceName: string | null = null;
  let shippingEtaDays: number | null = null;
  let shippingEtaText: string | null = null;
  let shippingZip: string | null = null;

  if (deliveryMethod) {
    if (deliveryMethods.length > 0 && !deliveryMethods.includes(deliveryMethod)) {
      /**
       * O checkout oferece frete automaticamente para produtos físicos quando
       * a loja conectou o Melhor Envio, mesmo que "Envio" não esteja marcado
       * em `delivery_methods`. Aceitamos a modalidade nesse caso — desde que
       * a conta realmente esteja conectada. A cotação oficial abaixo ainda
       * valida CEP, serviço, pesos e dimensões antes de gravar o pedido.
       */
      const meEnabled =
        deliveryMethod === "melhor_envio" &&
        (await admin
          .from("melhor_envio_accounts")
          .select("connected")
          .eq("catalog_id", catalog.id)
          .maybeSingle()
          .then(({ data }) => !!data?.connected));
      if (!meEnabled) {
        return {
          ok: false,
          status: 400,
          code: "invalid_delivery_method",
          error: "Modalidade de entrega não disponível nesta loja.",
        };
      }
    }
    if (deliveryMethod === "melhor_envio") {
      const physical = priced.items.filter((item) => item.product_type !== "digital");
      // Lojas que marcaram "Envio" podem cobrar frete mesmo em carrinho só de
      // itens digitais (material impresso, por exemplo). O volume padrão é
      // aplicado pela Edge Function de frete.
      const digitalOnlyShipping = physical.length === 0 && deliveryMethods.includes("melhor_envio");
      const zip = digits(input.shippingZip).slice(0, 8);
      if (physical.length > 0 || digitalOnlyShipping) {
        if (zip.length !== 8) {
          return { ok: false, status: 400, code: "invalid_zip", error: "Informe um CEP válido para o envio." };
        }
        const requestedService = cleanText(input.shippingService, 60);
        if (!requestedService) {
          return { ok: false, status: 400, code: "missing_shipping_service", error: "Escolha uma modalidade de envio." };
        }
        const requote = await reQuoteShipping({
          catalogId: catalog.id,
          destinationZip: zip,
          includeDigital: digitalOnlyShipping,
          items: priced.items.map((item) => ({
            product_type: item.product_type,
            weight_grams: item.weight_grams,
            length_cm: item.length_cm,
            width_cm: item.width_cm,
            height_cm: item.height_cm,
            quantity: item.quantity,
            unit_price: item.unitPrice,
          })),
        });
        if (!requote.ok) {
          return { ok: false, status: 502, code: "shipping_unavailable", error: requote.error };
        }
        const chosen =
          requote.quotes.find((q) => q.serviceId === requestedService) ??
          requote.quotes.find((q) => q.name === requestedService) ??
          null;
        if (!chosen) {
          return {
            ok: false,
            status: 409,
            code: "shipping_changed",
            error: "O valor do frete mudou. Recalcule o frete e tente novamente.",
          };
        }
        shippingMinor = toMinorUnits(chosen.price, currency);
        shippingService = chosen.serviceId;
        shippingServiceName = chosen.name;
        shippingEtaDays = chosen.delivery_min;
        shippingEtaText = chosen.delivery_text;
        shippingZip = zip;
      } else {
        shippingZip = zip.length === 8 ? zip : null;
      }
    }
  }

  const totals = computeTotals({
    currency,
    subtotalMinor: priced.subtotal_minor,
    shippingMinor,
    discountMinor: 0,
  });

  const address = input.address ?? null;
  const insertPayload = {
    catalog_id: catalog.id,
    customer_name: customerName,
    customer_phone: cleanText(input.customerPhone, 40),
    customer_email: customerEmail || null,
    items: priced.items,
    note: cleanText(input.note, MAX_NOTE),
    subtotal: totals.subtotal,
    total: totals.total,
    status: "novo",
    payment_status: "pending",
    ...(input.paymentMethod ? { payment_method: input.paymentMethod } : {}),
    currency,
    delivery_method: deliveryMethod,
    shipping_zip: shippingZip,
    shipping_service: shippingService,
    shipping_service_name: shippingServiceName,
    shipping_cost: totals.shipping > 0 ? totals.shipping : null,
    shipping_eta_days: shippingEtaDays,
    shipping_eta_text: shippingEtaText,
    customer_street: cleanText(address?.street, 160),
    customer_number: cleanText(address?.number, 20),
    customer_complement: cleanText(address?.complement, 120),
    customer_district: cleanText(address?.district, 80),
    customer_city: cleanText(address?.city, 80),
    customer_state: cleanText(address?.state, 40),
  };

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert(insertPayload)
    .select("id")
    .maybeSingle();

  if (orderError || !order) {
    console.error("[orders] insert", orderError?.message);
    return {
      ok: false,
      status: 500,
      code: "order_insert_failed",
      error: "Não foi possível registrar o pedido. Tente novamente.",
    };
  }

  const orderId = order.id as string;
  // Best-effort: falha no e-mail nunca impede a criação do pedido.
  await notifySellerNewOrder(orderId);

  let checkoutToken = "";
  try {
    checkoutToken = await createCheckoutSession(orderId, catalog.id);
  } catch (error) {
    console.error("[orders] checkout session", (error as Error).message);
    return {
      ok: false,
      status: 500,
      code: "checkout_session_failed",
      error: "Pedido registrado, mas o pagamento não pôde ser iniciado. Tente novamente.",
    };
  }

  return {
    ok: true,
    orderId,
    checkoutToken,
    currency,
    subtotal: totals.subtotal,
    shippingCost: totals.shipping,
    total: totals.total,
    items: priced.items,
    catalog: {
      id: catalog.id,
      slug: catalog.slug,
      storeName: catalog.store_name,
      whatsapp: catalog.whatsapp,
    },
  };
}

export { fromMinorUnits };
