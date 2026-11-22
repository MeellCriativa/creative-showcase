/**
 * Precificação oficial de pedidos — fonte única de verdade.
 *
 * Executado pelo backend (Edge Function) e pelos testes locais. Nunca recebe
 * preço, subtotal ou total do navegador: apenas ids de produto, quantidades e
 * a variação textual escolhida. Todo valor monetário vem do banco.
 *
 * Módulo puro: sem dependências de Deno/Node, para poder rodar nos dois.
 */
import {
  fromMinorUnits,
  isKnownCurrency,
  toMinorUnits,
} from "../../../../src/lib/currency.ts";

export type OfficialPriceOption = {
  id?: string;
  label: string;
  price: number;
};

export type OfficialVariationGroup = {
  name: string;
  options: string[];
};

export type OfficialProduct = {
  id: string;
  catalog_id: string;
  name: string;
  price: number | string;
  sale_price: number | string | null;
  price_options: OfficialPriceOption[] | null;
  variations: OfficialVariationGroup[] | null;
  available: boolean | null;
  product_type?: string | null;
  weight_grams?: number | string | null;
  length_cm?: number | string | null;
  width_cm?: number | string | null;
  height_cm?: number | string | null;
  images?: string[] | null;
};

export type CartItemInput = {
  product_id?: string;
  productId?: string;
  quantity?: number | string;
  variation?: string | null;
};

export type PricedItem = {
  product_id: string;
  name: string;
  quantity: number;
  /** Mantém o nome histórico usado pelo painel (`item.unitPrice`). */
  unitPrice: number;
  line_total: number;
  variation: string | null;
  image: string | null;
  product_type: "fisico" | "digital" | null;
  weight_grams: number | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
};

export type PricingResult =
  | {
      ok: true;
      items: PricedItem[];
      subtotal: number;
      subtotal_minor: number;
      currency: string;
    }
  | { ok: false; error: string; code: PricingErrorCode };

export type PricingErrorCode =
  | "invalid_currency"
  | "empty_cart"
  | "item_limit"
  | "product_not_found"
  | "product_unavailable"
  | "invalid_quantity"
  | "invalid_variation"
  | "price_unavailable";

export const MAX_ITEMS_PER_ORDER = 100;
export const MAX_QUANTITY_PER_ITEM = 999;

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = toNumber(value);
  return Number.isFinite(n) ? n : null;
}

/** Preço efetivo do produto, igual a `finalPrice` do catálogo público. */
export function officialBasePrice(product: {
  price: number | string;
  sale_price: number | string | null;
}): number {
  const sale = product.sale_price === null ? 0 : toNumber(product.sale_price);
  return sale > 0 ? sale : toNumber(product.price);
}

/** Converte a variação textual do carrinho em opção de preço + grupos. */
export function parseVariationSelection(variation: string | null | undefined): {
  priceLabel: string | null;
  groups: Record<string, string>;
  unknownTokens: string[];
} {
  const groups: Record<string, string> = {};
  const unknownTokens: string[] = [];
  let priceLabel: string | null = null;

  const raw = (variation ?? "").trim();
  if (!raw) return { priceLabel, groups, unknownTokens };

  for (const part of raw.split("|")) {
    const token = part.trim();
    if (!token) continue;
    const idx = token.indexOf(":");
    if (idx < 0) {
      unknownTokens.push(token);
      continue;
    }
    const key = token.slice(0, idx).trim();
    const value = token.slice(idx + 1).trim();
    if (!key) {
      unknownTokens.push(token);
      continue;
    }
    // O prefixo é traduzido no navegador (Valor/Price/Precio), mas o backend
    // precisa reconhecer todos para não rejeitar opções de valor em outros idiomas.
    if (["valor", "price", "precio"].includes(key.toLowerCase())) {
      priceLabel = value;
      continue;
    }
    groups[key] = value;
  }

  return { priceLabel, groups, unknownTokens };
}

export type ResolvedUnitPrice =
  | { ok: true; unitPrice: number; canonicalVariation: string | null }
  | { ok: false; code: PricingErrorCode; error: string };

/**
 * Resolve o preço unitário oficial a partir do produto do banco e da variação
 * escolhida pelo comprador. Qualquer divergência é rejeitada — nunca
 * "corrigimos" silenciosamente o preço enviado pelo navegador.
 */
export function resolveUnitPrice(
  product: OfficialProduct,
  variation: string | null | undefined,
): ResolvedUnitPrice {
  const options = Array.isArray(product.price_options) ? product.price_options : [];
  const parsed = parseVariationSelection(variation);

  if (parsed.unknownTokens.length > 0) {
    return {
      ok: false,
      code: "invalid_variation",
      error: "Variação inválida no carrinho.",
    };
  }

  let unitPrice: number;

  if (options.length > 0) {
    if (!parsed.priceLabel) {
      return {
        ok: false,
        code: "invalid_variation",
        error: "Escolha uma opção de valor para este produto.",
      };
    }
    const chosen = options.find(
      (o) => String(o.label).trim() === String(parsed.priceLabel).trim(),
    );
    if (!chosen) {
      return {
        ok: false,
        code: "invalid_variation",
        error: "A opção de valor escolhida não existe mais. Atualize o carrinho.",
      };
    }
    unitPrice = toNumber(chosen.price);
  } else {
    if (parsed.priceLabel) {
      return {
        ok: false,
        code: "invalid_variation",
        error: "Este produto não possui opções de valor.",
      };
    }
    unitPrice = officialBasePrice(product);
  }

  // Grupos de variação: todos os obrigatórios devem estar presentes e válidos.
  const groups = Array.isArray(product.variations) ? product.variations : [];
  const required = groups.filter((g) => Array.isArray(g.options) && g.options.length > 0);
  for (const group of required) {
    const value = parsed.groups[group.name];
    if (!value) {
      return {
        ok: false,
        code: "invalid_variation",
        error: `Escolha a opção "${group.name}".`,
      };
    }
    if (!group.options.includes(value)) {
      return {
        ok: false,
        code: "invalid_variation",
        error: `Opção inválida para "${group.name}".`,
      };
    }
  }
  // Chaves desconhecidas também invalidam (evita injeção de texto no pedido).
  const knownNames = new Set(required.map((g) => g.name));
  for (const key of Object.keys(parsed.groups)) {
    if (!knownNames.has(key)) {
      return {
        ok: false,
        code: "invalid_variation",
        error: `Variação desconhecida: "${key}".`,
      };
    }
  }

  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return {
      ok: false,
      code: "price_unavailable",
      error: "Este produto está sem preço válido.",
    };
  }

  // Reconstrói a variação canônica (mesma ordem exibida no catálogo).
  const canonicalParts: string[] = [];
  if (parsed.priceLabel) canonicalParts.push(`Valor: ${parsed.priceLabel}`);
  for (const group of required) {
    canonicalParts.push(`${group.name}: ${parsed.groups[group.name]}`);
  }
  const canonicalVariation = canonicalParts.length > 0 ? canonicalParts.join(" | ") : null;

  return { ok: true, unitPrice, canonicalVariation };
}

/**
 * Precifica o carrinho inteiro. Todos os itens devem pertencer ao mesmo
 * catálogo — não é permitido carrinho com vendedores diferentes.
 */
export function priceCart(
  products: OfficialProduct[],
  items: CartItemInput[],
  currency: string,
): PricingResult {
  if (!isKnownCurrency(currency)) {
    return {
      ok: false,
      code: "invalid_currency",
      error: "Moeda da loja inválida. O pedido não pode ser criado.",
    };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, code: "empty_cart", error: "O carrinho está vazio." };
  }
  if (items.length > MAX_ITEMS_PER_ORDER) {
    return {
      ok: false,
      code: "item_limit",
      error: `O carrinho excede o limite de ${MAX_ITEMS_PER_ORDER} itens.`,
    };
  }

  const byId = new Map(products.map((p) => [p.id, p]));
  const priced: PricedItem[] = [];
  let subtotalMinor = 0;

  for (const item of items) {
    const productId = String(item.product_id ?? item.productId ?? "").trim();
    if (!productId) {
      return { ok: false, code: "product_not_found", error: "Item sem produto informado." };
    }
    const product = byId.get(productId);
    if (!product) {
      return {
        ok: false,
        code: "product_not_found",
        error: "Um dos produtos não pertence a esta loja ou foi removido.",
      };
    }
    if (product.available === false) {
      return {
        ok: false,
        code: "product_unavailable",
        error: `"${product.name}" não está mais disponível.`,
      };
    }

    const quantity = Number(item.quantity);
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY_PER_ITEM
    ) {
      return {
        ok: false,
        code: "invalid_quantity",
        error: `Quantidade inválida para "${product.name}".`,
      };
    }

    const resolved = resolveUnitPrice(product, item.variation ?? null);
    if (!resolved.ok) {
      return { ok: false, code: resolved.code, error: resolved.error };
    }

    const unitMinor = toMinorUnits(resolved.unitPrice, currency);
    subtotalMinor += unitMinor * quantity;

    const productType =
      product.product_type === "digital" ? "digital" : product.product_type === "fisico" ? "fisico" : null;

    priced.push({
      product_id: product.id,
      name: product.name,
      quantity,
      unitPrice: fromMinorUnits(unitMinor, currency),
      line_total: fromMinorUnits(unitMinor * quantity, currency),
      variation: resolved.canonicalVariation,
      image: Array.isArray(product.images) && product.images.length > 0 ? product.images[0]! : null,
      product_type: productType,
      weight_grams: toNullableNumber(product.weight_grams),
      length_cm: toNullableNumber(product.length_cm),
      width_cm: toNullableNumber(product.width_cm),
      height_cm: toNullableNumber(product.height_cm),
    });
  }

  return {
    ok: true,
    items: priced,
    subtotal: fromMinorUnits(subtotalMinor, currency),
    subtotal_minor: subtotalMinor,
    currency,
  };
}

export type TotalsInput = {
  currency: string;
  subtotalMinor: number;
  shippingMinor?: number;
  discountMinor?: number;
};

export type Totals = {
  currency: string;
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  subtotal_minor: number;
  shipping_minor: number;
  discount_minor: number;
  total_minor: number;
};

/**
 * Total oficial em unidades mínimas. Frete e desconto nunca vêm do navegador:
 * o frete é re-cotado no backend e o desconto é 0 (não existe regra de desconto
 * configurada na Etapa 1).
 */
export function computeTotals(input: TotalsInput): Totals {
  const currency = input.currency;
  const subtotalMinor = Math.max(0, Math.round(input.subtotalMinor));
  const shippingMinor = Math.max(0, Math.round(input.shippingMinor ?? 0));
  const discountMinor = Math.max(0, Math.round(input.discountMinor ?? 0));
  const totalMinor = Math.max(0, subtotalMinor + shippingMinor - discountMinor);

  return {
    currency,
    subtotal: fromMinorUnits(subtotalMinor, currency),
    shipping: fromMinorUnits(shippingMinor, currency),
    discount: fromMinorUnits(discountMinor, currency),
    total: fromMinorUnits(totalMinor, currency),
    subtotal_minor: subtotalMinor,
    shipping_minor: shippingMinor,
    discount_minor: discountMinor,
    total_minor: totalMinor,
  };
}

/** Frete aceito para uma modalidade: só "melhor_envio" pode ter custo. */
export function shippingAllowedForMethod(method: string | null | undefined): boolean {
  return method === "melhor_envio";
}
