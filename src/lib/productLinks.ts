/**
 * Links diretos para o checkout público de um produto (Etapa 3).
 *
 * O link abre a loja com o produto — e, quando informado, o valor escolhido —
 * já selecionado. Nenhum preço é codificado na URL: o backend continua sendo
 * a única fonte oficial de preços.
 */

export const PRODUCT_QUERY_PARAM = "produto";
export const PRICE_OPTION_QUERY_PARAM = "valor";

/** Monta o link público canônico de um produto ou de uma opção de valor. */
export function buildProductCheckoutUrl(
  origin: string,
  slug: string,
  productId: string,
  priceOptionId?: string | null,
): string {
  const cleanOrigin = String(origin ?? "")
    .trim()
    .replace(/\/+$/, "");
  const cleanSlug = String(slug ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const params = new URLSearchParams();
  if (productId) params.set(PRODUCT_QUERY_PARAM, productId);
  if (priceOptionId) params.set(PRICE_OPTION_QUERY_PARAM, priceOptionId);
  const query = params.toString();
  const path = cleanSlug ? `/c/${encodeURIComponent(cleanSlug)}` : "/";
  return `${cleanOrigin}${path}${query ? `?${query}` : ""}`;
}

/** Lê os parâmetros de um link de produto, ignorando quaisquer outros. */
export function parseProductCheckoutParams(search: string): {
  productId: string | null;
  priceOptionId: string | null;
} {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  return {
    productId: params.get(PRODUCT_QUERY_PARAM) || null,
    priceOptionId: params.get(PRICE_OPTION_QUERY_PARAM) || null,
  };
}
