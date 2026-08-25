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
  banner_enabled: boolean;
  banner_autoplay: boolean;
  banner_interval: number;
  banner_indicators: boolean;
};

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
  const lines: string[] = ["Olá! Quero fazer este pedido:", ""];
  for (const item of opts.items) {
    lines.push(`Produto: ${item.name}`);
    if (item.variation) lines.push(`Variação: ${item.variation}`);
    lines.push(`Quantidade: ${item.quantity}`);
    lines.push(`Valor: ${formatBRL(item.unitPrice * item.quantity)}`);
    lines.push("");
  }
  lines.push(`Total: ${formatBRL(opts.total)}`);
  if (opts.note?.trim()) {
    lines.push("");
    lines.push(`Observação: ${opts.note.trim()}`);
  }
  lines.push("");
  lines.push(`Pedido feito pelo catálogo ${opts.storeName}`);
  return lines.join("\n");
}

export function whatsappLink(phone: string, message: string) {
  const digits = onlyDigits(phone);
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(message)}`;
}
