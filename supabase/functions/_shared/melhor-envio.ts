import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";
import { decryptMeToken, encryptMeToken } from "./melhor-envio-oauth.ts";

const USER_AGENT = "VitrineCriativa/1.0 (MeellCriativa)";

export const BASES: Record<string, string> = {
  sandbox: "https://sandbox.melhorenvio.com.br",
  production: "https://melhorenvio.com.br",
};

export function getSupabaseAdmin() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
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

type MeAccount = {
  id: string;
  catalog_id: string;
  environment: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  connected: boolean;
  [key: string]: unknown;
};

/** Lê a conta da loja e descriptografa tokens cifrados em repouso. */
export async function getAccount(catalogId: string): Promise<MeAccount | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("melhor_envio_accounts")
    .select("*")
    .eq("catalog_id", catalogId)
    .maybeSingle();
  if (!data) return null;
  const row = data as MeAccount;
  return {
    ...row,
    access_token: await decryptMeToken(row.access_token),
    refresh_token: await decryptMeToken(row.refresh_token),
  };
}

async function markDisconnected(catalogId: string) {
  try {
    const admin = getSupabaseAdmin();
    await admin
      .from("melhor_envio_accounts")
      .update({ connected: false, updated_at: new Date().toISOString() })
      .eq("catalog_id", catalogId);
  } catch (e) {
    console.error("[melhor-envio] falha ao marcar conta como desconectada", e);
  }
}

export async function ensureValidAccessToken(
  catalogId: string,
  accountInput?: MeAccount | null,
): Promise<string | null> {
  const account = accountInput ?? (await getAccount(catalogId));
  if (!account || !account.connected) return null;

  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  const now = Date.now();

  // Token still valid (> 1h left) -> use it
  if (account.access_token && now < expiresAt - 60 * 60 * 1000) {
    return account.access_token;
  }

  // Token expired and there is no refresh token -> the owner must reconnect.
  // Mark the account disconnected so the panel and the buyer both see the truth.
  if (!account.refresh_token) {
    console.error("[melhor-envio] token expirado e sem refresh_token", catalogId);
    await markDisconnected(catalogId);
    return null;
  }

  // O token pertence ao ambiente em que a loja conectou (sandbox ou produção).
  // Usar o ambiente global aqui misturaria tokens de um ambiente no outro.
  const base = getBase(account.environment || getPlatformEnv());
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
    await markDisconnected(catalogId);
    return null;
  }

  const admin = getSupabaseAdmin();
  const newExpires = Date.now() + (data.expires_in || 30 * 24 * 60 * 60) * 1000;
  await admin
    .from("melhor_envio_accounts")
    .update({
      access_token: await encryptMeToken(data.access_token as string),
      refresh_token: await encryptMeToken(
        (data.refresh_token as string) || (account.refresh_token as string),
      ),
      token_expires_at: new Date(newExpires).toISOString(),
      connected: true,
      updated_at: new Date().toISOString(),
    })
    .eq("catalog_id", catalogId);

  return data.access_token as string;
}

export async function meApi(reqInit: {
  catalogId: string;
  method?: string;
  path: string;
  query?: Record<string, string>;
  body?: unknown;
}): Promise<{ res: Response; data: unknown }> {
  const { catalogId, method, path, query, body } = reqInit;
  const account = await getAccount(catalogId);
  const token = await ensureValidAccessToken(catalogId, account);
  if (!token) {
    const r = new Response(
      JSON.stringify({
        success: false,
        error: "not_connected",
        message: "A loja ainda não conectou à Melhor Envio.",
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
    return { res: r, data: await r.json() };
  }

  // Cada loja usa o ambiente do próprio token, não o ambiente global da plataforma.
  const base = getBase(account?.environment || getPlatformEnv());
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
