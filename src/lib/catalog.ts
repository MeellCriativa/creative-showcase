import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_CURRENCY, formatMoney, resolveStoreCurrency } from "@/lib/currency";

export type VariationGroup = { name: string; options: string[] };

export const LILAS = "#8b5cf6";
export const LILAS_LIGHT = "#f3eefc";
export const WHITE = "#FFFFFF";

export type Catalog = {
  id: string;
  user_id: string;
  slug: string;
  store_name: string;
  logo_url: string | null;
  cover_url: string | null;
  whatsapp: string | null;
  primary_color: string;
  accent_color: string;
  background_color: string | null;
  store_font: string;
  logo_size: string;
  logo_position: string;
  cart_style: string;
  whatsapp_button_color: string | null;
  banner_enabled: boolean;
  banner_autoplay: boolean;
  banner_interval: number;
  banner_indicators: boolean;
  store_description: string | null;
  instagram_url: string | null;
  payment_methods: string[] | null;
  owner_photo_url: string | null;
  owner_name: string | null;
  owner_bio: string | null;
  owner_hours: string | null;
  meta_catalog_connected: boolean;
  delivery_methods: string[] | null;
  shipping_origin_zip: string | null;
  /** Moeda principal da loja (ISO 4217). Ausente em lojas antigas = BRL. */
  currency?: string | null;
  plan?: string;
};

export const DELIVERY_METHODS = [
  { key: "local_pickup", label: "Retirada no local", icon: "🏪" },
  { key: "local_delivery", label: "Entrega local", icon: "🛵" },
  { key: "melhor_envio", label: "Envio (Correios e transportadoras)", icon: "📦" },
] as const;

/** Metadados do arquivo digital devolvidos pelo upload no painel. */
export type DigitalFileMeta = {
  path: string;
  name: string;
  mime: string;
  size: number;
  checksum: string;
};

export const PAYMENT_METHODS = [
  { key: "pix", label: "Pix", icon: "💳" },
  { key: "credit_card", label: "Cartão de crédito", icon: "💳" },
  { key: "debit_card", label: "Cartão de débito", icon: "💳" },
  { key: "pix_auto", label: "Pix Automático", icon: "⚡" },
  { key: "cash", label: "Dinheiro", icon: "💵" },
] as const;

export type Category = {
  id: string;
  catalog_id: string;
  name: string;
  position: number;
};

export type PriceOption = {
  id: string;
  label: string;
  price: number;
};

export type Product = {
  id: string;
  catalog_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  sale_price: number | null;
  price_options: PriceOption[];
  images: string[];
  variations: VariationGroup[];
  available: boolean;
  is_new: boolean;
  is_bestseller: boolean;
  position: number;
  product_type: "fisico" | "digital" | null;
  weight_grams: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  /** Arquivo digital privado (caminho interno no Storage — nunca exposto ao comprador). */
  digital_file_path?: string | null;
  digital_file_name?: string | null;
  digital_file_mime?: string | null;
  digital_file_size?: number | null;
  digital_file_checksum?: string | null;
  digital_instructions?: string | null;
  digital_link_ttl_minutes?: number | null;
  digital_max_downloads?: number | null;
};

export type ProductType = "fisico" | "digital";

export type Banner = {
  id: string;
  catalog_id: string;
  image_url: string;
  href: string | null;
  position: number;
  object_position?: string;
};

export type Order = {
  id: string;
  catalog_id: string;
  customer_name: string;
  customer_phone: string | null;
  /** Usado para entrega automática de produtos digitais (somente vendedor vê). */
  customer_email?: string | null;
  items: OrderItem[];
  note: string | null;
  total: number;
  subtotal: number | null;
  delivery_method: string | null;
  shipping_zip: string | null;
  customer_street: string | null;
  customer_number: string | null;
  customer_complement: string | null;
  customer_district: string | null;
  customer_city: string | null;
  customer_state: string | null;
  shipping_service: string | null;
  shipping_service_name: string | null;
  shipping_cost: number | null;
  shipping_eta_days: number | null;
  shipping_eta_text: string | null;
  me_order_id: string | null;
  me_agency_id: string | null;
  me_tracking: string | null;
  me_status: string | null;
  me_protocol: string | null;
  me_label_id: string | null;
  me_label_url: string | null;
  status: string;
  created_at: string;
  /** Moeda do pedido no momento da compra (histórico). Ausente = moeda da loja. */
  currency?: string | null;
  /** Estado financeiro (Etapa 2). Ausente em pedidos anteriores à migration. */
  payment_status?: PaymentStatusValue | null;
  payment_provider?: "paypal" | "mercadopago" | null;
  payment_transaction_id?: string | null;
};

/** Estados financeiros mínimos da Etapa 2. */
export type PaymentStatusValue =
  | "pending"
  | "approved"
  | "authorized"
  | "captured"
  | "failed"
  | "cancelled"
  | "refunded"
  | "partially_refunded"
  | "disputed";

export type OrderItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  product_id?: string;
  variation?: string;
  product_type?: "fisico" | "digital" | null;
  weight_grams?: number | null;
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
};

export type DigitalDelivery = {
  id: string;
  order_id: string;
  product_id: string;
  customer_email: string;
  status: "pending" | "sent" | "failed" | "revoked" | string;
  attempts: number;
  sent_at: string | null;
  /** Confirmação oficial do pagamento (payment_transactions). */
  approved_at?: string | null;
  revoked_at: string | null;
  last_error: string | null;
  created_at: string;
  products?: { name: string } | null;
  token?: {
    expires_at: string;
    max_uses: number;
    used_count: number;
    revoked_at: string | null;
  } | null;
};

export type ShippingQuote = {
  serviceId: string;
  name: string;
  price: number;
  delivery_min: number | null;
  delivery_max: number | null;
  delivery_text: string | null;
  agencyRequired: boolean;
  collect: boolean;
};

export type CustomerAddress = {
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  zip?: string;
  recipient?: string;
  recipientPhone?: string;
  document?: string;
};

export const FONT_OPTIONS = [
  { key: "moderna", label: "Moderna", family: "Plus Jakarta Sans" },
  { key: "manuscrita", label: "Manuscrita", family: "Caveat" },
  { key: "delicada", label: "Delicada", family: "Quicksand" },
  { key: "elegante", label: "Elegante", family: "Playfair Display" },
  { key: "minimalista", label: "Minimalista", family: "Inter" },
  { key: "arredondada", label: "Arredondada", family: "Baloo 2" },
  { key: "serifada", label: "Serifada", family: "Lora" },
  { key: "divertida", label: "Divertida", family: "Fredoka" },
] as const;

export function getFontFamily(key: string) {
  return FONT_OPTIONS.find((f) => f.key === key)?.family ?? "Plus Jakarta Sans";
}

export function formatBRL(value: number) {
  return formatMoney(Number.isFinite(value) ? value : 0, DEFAULT_CURRENCY);
}

/**
 * Formata um valor na moeda da loja. Mantém `formatBRL` para
 * retrocompatibilidade, mas todo código novo deve usar `formatMoney`.
 */
export function formatCatalogMoney(
  value: number,
  catalog: { currency?: string | null } | null | undefined,
) {
  return formatMoney(Number.isFinite(value) ? value : 0, resolveStoreCurrency(catalog?.currency));
}

export function finalPrice(p: { price: number; sale_price: number | null }) {
  return p.sale_price != null && p.sale_price > 0 ? Number(p.sale_price) : Number(p.price);
}

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

/** Formata um CEP para o padrão 00000-000 (aceita entrada sem formatação). */
export function formatCep(value: string) {
  const d = onlyDigits(value).slice(0, 8);
  if (d.length <= 5) return d;
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

export function isValidCep(value: string) {
  return /^\d{8}$/.test(onlyDigits(value));
}

const TEN_YEARS = 60 * 60 * 24 * 365 * 10;

/** Envia uma imagem e devolve uma URL assinada de longa duração. */
export async function uploadImage(file: File, userId: string) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("catalog-images").upload(path, file, {
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  const { data, error: signError } = await supabase.storage
    .from("catalog-images")
    .createSignedUrl(path, TEN_YEARS);
  if (signError || !data) throw signError ?? new Error("Falha ao gerar link da imagem");
  return data.signedUrl;
}

/**
 * Rótulos do texto fixo da mensagem de pedido enviada ao WhatsApp.
 *
 * A mensagem é montada pelo sistema (nomes de produtos, valores e dados do
 * vendedor continuam intactos); apenas esses rótulos mudam com o idioma.
 */
export type WhatsappMessageLabels = {
  intro: string;
  product: string;
  variation: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  shippingDelivery: string;
  service: string;
  shippingCost: string;
  estimatedDelivery: string;
  address: string;
  zip: string;
  pickup: string;
  /** Usa `{{eta}}` para o prazo informado pela loja. */
  localDeliveryEta: string;
  localDelivery: string;
  orderTotal: string;
  shippingIncluded: string;
  closing: string;
};

/** Rótulos em português (comportamento original, usado como padrão). */
export const DEFAULT_WHATSAPP_LABELS: WhatsappMessageLabels = {
  intro: "Olá! Gostaria de fazer este pedido pelo seu catálogo:",
  product: "Produto",
  variation: "Variação",
  quantity: "Quantidade",
  unitPrice: "Valor unitário",
  subtotal: "Subtotal",
  shippingDelivery: "📦 Entrega: Envio (Correios e transportadoras)",
  service: "Modalidade",
  shippingCost: "Frete",
  estimatedDelivery: "Prazo estimado",
  address: "Endereço",
  zip: "CEP",
  pickup: "🏪 Entrega: Retirada no local",
  localDeliveryEta: "🛵 Entrega local: {{eta}}",
  localDelivery: "🛵 Entrega: local",
  orderTotal: "Total do pedido",
  shippingIncluded: "(já incluso o valor do frete)",
  closing: "Gostaria de finalizar meu pedido. \u{1F49C}",
};

export function buildWhatsappMessage(
  opts: {
    storeName: string;
    items: { name: string; quantity: number; unitPrice: number; variation?: string | undefined }[];
    total: number;
    /** Moeda da loja (ISO 4217). Padrão: BRL. */
    currency?: string | null;
    note?: string | undefined;
    shipping?:
      | {
          deliveryMethod?: string;
          serviceName?: string;
          cost?: number;
          etaText?: string;
          address?: {
            street?: string;
            number?: string;
            complement?: string;
            district?: string;
            city?: string;
            state?: string;
            zip?: string;
            recipient?: string;
          };
        }
      | undefined;
    subtotal?: number | undefined;
  },
  /** Rótulos traduzidos do texto fixo (padrão: português). */
  labels?: Partial<WhatsappMessageLabels>,
) {
  const L = { ...DEFAULT_WHATSAPP_LABELS, ...(labels ?? {}) };
  const lines: string[] = [L.intro, ""];
  const money = (value: number) => formatMoney(value, resolveStoreCurrency(opts.currency));
  for (const item of opts.items) {
    lines.push(`${L.product}: ${item.name}`);
    if (item.variation) lines.push(`${L.variation}: ${item.variation}`);
    lines.push(`${L.quantity}: ${item.quantity}`);
    lines.push(`${L.unitPrice}: ${money(item.unitPrice)}`);
    lines.push(`${L.subtotal}: ${money(item.unitPrice * item.quantity)}`);
    lines.push("");
  }
  const subtotal =
    opts.subtotal != null
      ? opts.subtotal
      : opts.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  lines.push(`${L.subtotal}: ${money(subtotal)}`);

  const ship = opts.shipping;
  if (ship?.deliveryMethod === "melhor_envio") {
    lines.push("");
    lines.push(L.shippingDelivery);
    if (ship.serviceName) lines.push(`${L.service}: ${ship.serviceName}`);
    if (ship.cost != null) lines.push(`${L.shippingCost}: ${money(ship.cost)}`);
    if (ship.etaText) lines.push(`${L.estimatedDelivery}: ${ship.etaText}`);
    const a = ship.address;
    if (a?.street || a?.city) {
      lines.push("");
      lines.push(`${L.address}:`);
      if (a.recipient) lines.push(a.recipient);
      lines.push(
        `${[a.street, a.number].filter(Boolean).join(", ")}${a.complement ? ` - ${a.complement}` : ""}`,
      );
      lines.push([a.district, a.city, a.state].filter(Boolean).join(" - "));
      if (a.zip) lines.push(`${L.zip}: ${a.zip}`);
    }
  } else if (ship?.deliveryMethod === "local_pickup") {
    lines.push("");
    lines.push(L.pickup);
  } else if (ship?.deliveryMethod === "local_delivery") {
    if (ship?.etaText) lines.push(L.localDeliveryEta.replace("{{eta}}", ship.etaText));
    else lines.push(L.localDelivery);
    if (ship?.cost != null) lines.push(`${L.shippingCost}: ${money(ship.cost)}`);
    const a = ship?.address;
    if (a?.street || a?.city) {
      lines.push("");
      lines.push(`${L.address}:`);
      if (a.recipient) lines.push(a.recipient);
      lines.push(
        `${[a.street, a.number].filter(Boolean).join(", ")}${a.complement ? ` - ${a.complement}` : ""}`,
      );
      lines.push([a.district, a.city, a.state].filter(Boolean).join(" - "));
      if (a.zip) lines.push(`${L.zip}: ${a.zip}`);
    }
  }

  lines.push("");
  lines.push(`${L.orderTotal}: ${money(opts.total)}`);
  if (ship?.cost != null && ship.cost > 0) {
    lines.push(L.shippingIncluded);
  }
  lines.push("");
  if (opts.note?.trim()) {
    lines.push(`${opts.note.trim()}`);
    lines.push("");
  }
  lines.push(L.closing);
  return lines.join("\n");
}

export function whatsappLink(phone: string, message: string) {
  const digits = onlyDigits(phone);
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}
