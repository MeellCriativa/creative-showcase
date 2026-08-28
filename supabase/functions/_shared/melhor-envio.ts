import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

const USER_AGENT = "VitrineCriativa/1.0 (MeellCriativa)";

export const BASES: Record<string, string> = {
  sandbox: "https://sandbox.melhorenvio.com.br",
  production: "https://melhorenvio.com.br",
};

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

export function getPlatformEnv(): "sandbox" | "production" {
  const v = Deno.env.get("ME_ENV") || "sandbox";
  return v === "production" ? "production" : "sandbox";
}

export function getBase(env?: string): string {
  const e = env || getPlatformEnv();
  return BASES[e] || BASES.sandbox;
}

export function hasPlatformCredentials(): boolean {
  return !!(Deno.env.get("ME_CLIENT_ID") && Deno.env.get("ME_CLIENT_SECRET"));
}

export async function getAccount(catalogId: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("melhor_envio_accounts")
    .select("*")
    .eq("catalog_id", catalogId)
    .maybeSingle();
  return data || null;
}

export async function ensureValidAccessToken(catalogId: string): Promise<string | null> {
  const account = await getAccount(catalogId);
  if (!account || !account.connected) return null;

  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const now = Date.now();

  // Token still valid (> 1h left) -> use it
  if (account.access_token && now < expiresAt - 60 * 60 * 1000) {
    return account.access_token as string;
  }

  // Try to refresh
  if (!account.refresh_token) {
    console.error("[melhor-envio] sem refresh_token", catalogId);
    return account.access_token as string || null;
  }

  const platform = getPlatformEnv();
  const base = getBase(platform);
  const res = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: Deno.env.get("ME_CLIENT_ID") || "",
      client_secret: Deno.env.get("ME_CLIENT_SECRET") || "",
      refresh_token: account.refresh_token,
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.error("[melhor-envio] falha ao renovar token", res.status, JSON.stringify(data));
    return null;
  }

  const admin = getSupabaseAdmin();
  const newExpires = Date.now() + (data.expires_in || 30 * 24 * 60 * 60) * 1000;
  await admin
    .from("melhor_envio_accounts")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || account.refresh_token,
      token_expires_at: new Date(newExpires).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("catalog_id", catalogId);

  return data.access_token as string;
}

export async function meApi(
  reqInit: {
    catalogId: string;
    method?: string;
    path: string;
    query?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ res: Response; data: unknown }> {
  const { catalogId, method, path, query, body } = reqInit;
  const token = await ensureValidAccessToken(catalogId);
  if (!token) {
    const r = new Response(
      JSON.stringify({ success: false, error: "not_connected", message: "A loja ainda não conectou à Melhor Envio." }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
    return { res: r, data: await r.json() };
  }

  const base = getBase();
  const url = new URL(`${base}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    method: method || "GET",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  let data: unknown = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  return { res, data };
}

export function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}
