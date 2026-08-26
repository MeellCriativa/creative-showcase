import { supabase } from "@/integrations/supabase/client";

export type MetaConnection = {
  id: string;
  catalog_id: string;
  user_id: string;
  facebook_user_id: string;
  business_id: string;
  business_name: string | null;
  catalog_id_meta: string;
  catalog_name: string | null;
  sync_status: string;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
};

export type MetaProductMapping = {
  id: string;
  catalog_id: string;
  product_id: string;
  meta_retailer_id: string;
  meta_item_id: string | null;
  sync_state: string;
  last_synced_at: string | null;
  error_message: string | null;
};

export type MetaSyncLog = {
  id: number;
  catalog_id: string;
  operation: string;
  status: string;
  items_total: number;
  items_created: number;
  items_updated: number;
  items_deleted: number;
  items_failed: number;
  error_details: unknown;
  started_at: string;
  completed_at: string | null;
};

export const META_FUNCTIONS_URL =
  `${import.meta.env["VITE_SUPABASE_URL"]}/functions/v1`;

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    Authorization: `Bearer ${session?.access_token ?? ""}`,
    apikey: import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ?? "",
    "Content-Type": "application/json" as const,
  };
}

export async function fetchMetaConnection(
  catalogId: string,
): Promise<MetaConnection | null> {
  const { data } = await supabase
    .from("meta_catalog_connections" as any)
    .select("*")
    .eq("catalog_id", catalogId)
    .maybeSingle();
  return (data as MetaConnection | null) ?? null;
}

export async function fetchMetaMappings(
  catalogId: string,
): Promise<MetaProductMapping[]> {
  const { data } = await supabase
    .from("meta_product_mapping" as any)
    .select("*")
    .eq("catalog_id", catalogId);
  return (data ?? []) as MetaProductMapping[];
}

export async function fetchMetaSyncLogs(
  catalogId: string,
): Promise<MetaSyncLog[]> {
  const { data } = await supabase
    .from("meta_sync_logs" as any)
    .select("*")
    .eq("catalog_id", catalogId)
    .order("started_at", { ascending: false })
    .limit(10);
  return (data ?? []) as MetaSyncLog[];
}

export async function startOAuth(catalogId: string): Promise<string> {
  const headers = await authHeaders();
  const res = await fetch(
    `${META_FUNCTIONS_URL}/meta-oauth-start?catalog_id=${catalogId}`,
    { headers },
  );
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.url;
}

export async function completeOAuth(code: string, state: string) {
  const headers = await authHeaders();
  const res = await fetch(`${META_FUNCTIONS_URL}/meta-oauth-callback`, {
    method: "POST",
    headers,
    body: JSON.stringify({ code, catalog_id: state }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function syncProductsNow(catalogId: string) {
  const headers = await authHeaders();
  const res = await fetch(`${META_FUNCTIONS_URL}/meta-sync-products`, {
    method: "POST",
    headers,
    body: JSON.stringify({ catalog_id: catalogId }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function disconnectMeta(catalogId: string) {
  const headers = await authHeaders();
  const res = await fetch(`${META_FUNCTIONS_URL}/meta-disconnect`, {
    method: "POST",
    headers,
    body: JSON.stringify({ catalog_id: catalogId }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function getRetailerId(productId: string) {
  return `vc-${productId}`;
}
