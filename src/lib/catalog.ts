import { supabase } from "@/integrations/supabase/client";

export type VariationGroup = { name: string; options: string[] };

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
};

export const PAYMENT_METHODS = [
  { key: "pix", label: "Pix", icon: "💳" },
  { key: "credit_card", label: "Cartão de crédito", icon: "💳" },
  { key: "debit_card", label: "Cartão de débito", icon: "💳" },
  { key: "cash", label: "Dinheiro", icon: "💵" },
] as const;

export type Category = {
  id: string;
  catalog_id: string;
  name: string;
  position: number;
};

export type Product = {
  id: string;
  catalog_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  sale_price: number | null;
  images: string[];
  variations: VariationGroup[];
  available: boolean;
  is_new: boolean;
  is_bestseller: boolean;
  position: number;
};

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
  items: OrderItem[];
  note: string | null;
  total: number;
  status: string;
  created_at: string;
};

export type OrderItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  variation?: string;
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
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number.isFinite(value) ? value : 0,
  );
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

export function buildWhatsappMessage(opts: {
  storeName: string;
  items: { name: string; quantity: number; unitPrice: number; variation?: string | undefined }[];
  total: number;
  note?: string | undefined;
}) {
  const lines: string[] = ["Olá! Gostaria de fazer este pedido pelo seu catálogo:", ""];
  for (const item of opts.items) {
    lines.push(`Produto: ${item.name}`);
    if (item.variation) lines.push(`Variação: ${item.variation}`);
    lines.push(`Quantidade: ${item.quantity}`);
    lines.push(`Valor unitário: ${formatBRL(item.unitPrice)}`);
    lines.push(`Subtotal: ${formatBRL(item.unitPrice * item.quantity)}`);
    lines.push("");
  }
  lines.push(`Total do pedido: ${formatBRL(opts.total)}`);
  lines.push("");
  if (opts.note?.trim()) {
    lines.push(`${opts.note.trim()}`);
    lines.push("");
  }
  lines.push("Gostaria de finalizar meu pedido. \u{1F49C}");
  return lines.join("\n");
}

export function whatsappLink(phone: string, message: string) {
  const digits = onlyDigits(phone);
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}
