import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const META_API_VERSION = Deno.env.get("META_CATALOG_API_VERSION") || "v23.0";
const GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}`;

export function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function verifyUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export async function refreshLongLivedToken(
  refreshToken: string,
  appId: string,
  appSecret: string,
): Promise<{ access_token: string; expires_in: number }> {
  const url = `${GRAPH_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${refreshToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return { access_token: data.access_token, expires_in: data.expires_in };
}

export async function getBusinessCatalogs(accessToken: string) {
  const url = `${GRAPH_URL}/me/accounts?fields=id,name,access_token&access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.data ?? [];
}

export async function getCatalogsForBusiness(
  businessId: string,
  accessToken: string,
) {
  const url = `${GRAPH_URL}/${businessId}/owned_product_catalogs?fields=id,name&access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.data ?? [];
}

export type MetaProductItem = {
  id: string;
  title: string;
  description: string;
  availability: string;
  condition: string;
  price: string;
  link: string;
  image_link: string;
  brand: string;
};

export function mapProductToMeta(
  product: {
    id: string;
    name: string;
    description: string | null;
    price: number;
    sale_price: number | null;
    images: string[];
    available: boolean;
  },
  catalogUrl: string,
  storeName: string,
): MetaProductItem {
  const effectivePrice =
    product.sale_price != null && product.sale_price > 0
      ? product.sale_price
      : product.price;

  return {
    id: `vc-${product.id}`,
    title: (product.name || "Produto").substring(0, 200),
    description: (product.description || product.name || "").substring(0, 9999),
    availability: product.available ? "in stock" : "out of stock",
    condition: "new",
    price: `${Number(effectivePrice).toFixed(2)} BRL`,
    link: catalogUrl,
    image_link: product.images?.[0] || "",
    brand: storeName || "Vitrine Criativa",
  };
}

export async function sendBatch(
  catalogIdMeta: string,
  accessToken: string,
  requests: Array<{ method: string; data: Record<string, unknown> }>,
): Promise<{ handle?: string; validation_status?: unknown[] }> {
  const url = `${GRAPH_URL}/${catalogIdMeta}/items_batch`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ item_type: "PRODUCT_ITEM", requests }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

export async function checkBatchStatus(
  catalogIdMeta: string,
  accessToken: string,
  handle: string,
): Promise<{ status: string; errors?: unknown[] }> {
  const url = `${GRAPH_URL}/${catalogIdMeta}/check_batch_request_status?handle=${handle}&access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

export async function batchWithRetry(
  catalogIdMeta: string,
  accessToken: string,
  requests: Array<{ method: string; data: Record<string, unknown> }>,
  maxRetries = 3,
): Promise<{ handle?: string; validation_status?: unknown[] }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await sendBatch(catalogIdMeta, accessToken, requests);
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const msg = lastError.message.toLowerCase();
      if (msg.includes("190") || msg.includes("invalid") || msg.includes("expired")) {
        throw lastError;
      }
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}
