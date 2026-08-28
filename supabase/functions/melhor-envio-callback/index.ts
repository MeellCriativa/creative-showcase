import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import {
  getSupabaseAdmin,
  getBase,
  getPlatformEnv,
} from "../_shared/melhor-envio.ts";

const redirectError = (adminPanel: string, code: string) =>
  Response.redirect(`${adminPanel}?me_connected=0&error=${encodeURIComponent(code)}`, 302);

// Callback recebido pelo browser após o dono da loja autorizar na Melhor Envio.
serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // catalog_id
    const error = url.searchParams.get("error");
    const errorDesc = url.searchParams.get("error_description");

    const env = getPlatformEnv();
    console.log("[melhor-envio-callback] OAuth callback recebido", JSON.stringify({
      env,
      state,
      has_code: !!code,
      error: error || null,
      error_description: errorDesc || null,
    }));

    const vitrineUrl = Deno.env.get("VITRINE_URL") || "https://vitrine.meellcriativa.workers.dev";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://wdcufpvlbisnqtvmbyso.supabase.co";
    const adminPanel = `${vitrineUrl}/painel/envio`;

    // Melhor Envio rejected the authorization itself (e.g. invalid_scope,
    // redirect_uri mismatch → "Client invalid", access_denied).
    if (error) {
      const detail = errorDesc || error;
      console.error("[melhor-envio-callback] erro retornado pelo ME ao autorizar:", detail);
      return redirectError(adminPanel, `me_error:${detail}`);
    }

    const catalogId = state || "";
    if (!catalogId) {
      console.error("[melhor-envio-callback] parametro state (catalog_id) ausente");
      return redirectError(adminPanel, "missing_state");
    }
    if (!code) {
      console.error("[melhor-envio-callback] parametro code ausente");
      return redirectError(adminPanel, "missing_code");
    }

    console.log("[melhor-envio-callback] Authorization code recebido. Iniciando troca do code pelo token...");

    const base = getBase(env);
    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "VitrineCriativa/1.0 (MeellCriativa)",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: Deno.env.get("ME_CLIENT_ID") || "",
        client_secret: Deno.env.get("ME_CLIENT_SECRET") || "",
        redirect_uri: `${supabaseUrl}/functions/v1/melhor-envio-callback`,
        code,
      }),
    });

    const rawText = await tokenRes.text();
    let tokenData: Record<string, unknown> = {};
    try {
      tokenData = rawText ? JSON.parse(rawText) : {};
    } catch (e) {
      console.error("[melhor-envio-callback] resposta do token endpoint não é JSON", e?.toString?.());
    }

    console.log(`[melhor-envio-callback] Token endpoint respondeu HTTP ${tokenRes.status}`);
    console.log(`[melhor-envio-callback] Resposta da API: ${rawText}`);

    if (!tokenRes.ok || !tokenData.access_token) {
      const errCode = (tokenData.error as string) || `http_${tokenRes.status}`;
      const errDesc = (tokenData.error_description as string) || (tokenData.message as string) || rawText;
      console.error(
        `[melhor-envio-callback] troca de código falhou (${errCode}): ${errDesc}`,
      );
      return redirectError(adminPanel, `token_exchange:${errCode}`);
    }

    const expiresIn = (tokenData.expires_in as number) || 30 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const admin = getSupabaseAdmin();
    const { error: upsertError } = await admin.from("melhor_envio_accounts").upsert(
      {
        catalog_id: catalogId,
        environment: env,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        token_expires_at: expiresAt,
        connected: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "catalog_id" },
    );

    if (upsertError) {
      console.error("[melhor-envio-callback] Erro ao salvar integração no Supabase:", upsertError.message);
      return redirectError(adminPanel, "db_save_error");
    }

    console.log("[melhor-envio-callback] Tokens salvos no Supabase com sucesso para o catálogo:", catalogId);
    return Response.redirect(`${adminPanel}?me_connected=1&catalog=${encodeURIComponent(catalogId)}`, 302);
  } catch (err) {
    console.error("[melhor-envio-callback]", err);
    return new Response("Erro interno", { status: 500 });
  }
});
