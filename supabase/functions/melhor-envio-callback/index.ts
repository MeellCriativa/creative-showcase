import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { getSupabaseAdmin, getPlatformEnv } from "../_shared/melhor-envio.ts";
import {
  encryptMeToken,
  getRedirectUri,
  hashOAuthState,
  isMissingOptionalSchema,
  readOAuthState,
} from "../_shared/melhor-envio-oauth.ts";

const redirectError = (adminPanel: string, code: string) =>
  Response.redirect(`${adminPanel}?me_connected=0&error=${encodeURIComponent(code)}`, 302);

/**
 * Callback recebido pelo browser após o lojista autorizar na Melhor Envio.
 *
 * Nunca confia no `state` cru: ele é assinado, vinculado ao usuário autenticado
 * que iniciou o fluxo, à loja, ao ambiente e a um nonce de uso único.
 */
serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDesc = url.searchParams.get("error_description");

    const env = getPlatformEnv();
    console.log(
      "[melhor-envio-callback] OAuth callback recebido",
      JSON.stringify({
        env,
        has_state: !!state,
        has_code: !!code,
        error: error || null,
      }),
    );

    const vitrineUrl = Deno.env.get("VITRINE_URL") || "https://vitrine.meellcriativa.workers.dev";
    const adminPanel = `${vitrineUrl.replace(/\/+$/, "")}/painel/envio`;

    // Melhor Envio rejeitou a autorização (invalid_scope, redirect_uri
    // divergente → "Client invalid", access_denied etc.).
    if (error) {
      const detail = (errorDesc || error).slice(0, 300);
      console.error("[melhor-envio-callback] autorização recusada pela Melhor Envio:", detail);
      return redirectError(adminPanel, `me_error:${detail}`);
    }

    const stateData = await readOAuthState(state, env);
    if (!stateData) {
      console.error("[melhor-envio-callback] state inválido, expirado ou de outro ambiente");
      return redirectError(adminPanel, "invalid_state");
    }
    if (!code) {
      console.error("[melhor-envio-callback] parâmetro code ausente");
      return redirectError(adminPanel, "missing_code");
    }

    const admin = getSupabaseAdmin();

    // Consumo único do state (quando a migration de segurança já foi aplicada).
    // Se a tabela/RPC ainda não existir, o state assinado com expiração curta
    // continua protegendo o fluxo — não quebramos lojas já conectadas.
    try {
      const { data, error: rpcError } = await admin.rpc("consume_melhor_envio_oauth_state", {
        p_state_hash: await hashOAuthState(state!),
      });
      if (rpcError && !isMissingOptionalSchema(rpcError)) {
        console.error("[melhor-envio-callback] falha ao consumir state:", rpcError.message);
        return redirectError(adminPanel, "state_check_failed");
      }
      const row = (Array.isArray(data) ? data?.[0] : data) as
        { catalog_id?: string; user_id?: string } | undefined;
      if (row && (row.catalog_id !== stateData.catalogId || row.user_id !== stateData.userId)) {
        console.error("[melhor-envio-callback] state não pertence a esta loja/usuário");
        return redirectError(adminPanel, "invalid_state");
      }
      if (!rpcError && !row) {
        console.error("[melhor-envio-callback] state já consumido (replay bloqueado)");
        return redirectError(adminPanel, "invalid_state");
      }
    } catch (rpcException) {
      if (!isMissingOptionalSchema(rpcException)) {
        console.error("[melhor-envio-callback] exceção ao consumir state:", rpcException);
        return redirectError(adminPanel, "state_check_failed");
      }
    }

    // Mesmo com state assinado, confirma no banco que a loja pertence ao
    // usuário que iniciou a autorização. Nunca escreve token de outra loja.
    const { data: catalog, error: catalogError } = await admin
      .from("catalogs")
      .select("id, user_id")
      .eq("id", stateData.catalogId)
      .maybeSingle();
    if (catalogError || !catalog || catalog.user_id !== stateData.userId) {
      console.error("[melhor-envio-callback] loja não pertence ao usuário do state");
      return redirectError(adminPanel, "invalid_state");
    }

    const clientId = Deno.env.get("ME_CLIENT_ID") || "";
    const clientSecret = Deno.env.get("ME_CLIENT_SECRET") || "";
    if (!clientId || !clientSecret) {
      console.error("[melhor-envio-callback] credenciais da plataforma não configuradas");
      return redirectError(adminPanel, "platform_not_configured");
    }

    const base =
      stateData.environment === "production"
        ? "https://melhorenvio.com.br"
        : "https://sandbox.melhorenvio.com.br";
    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "VitrineCriativa/1.0 (MeellCriativa)",
        Accept: "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getRedirectUri(),
        code,
      }),
    });

    const rawText = await tokenRes.text();
    let tokenData: Record<string, unknown> = {};
    try {
      tokenData = rawText ? JSON.parse(rawText) : {};
    } catch {
      // Sem logar o corpo: ele pode conter tokens em respostas de erro.
      tokenData = {};
    }

    console.log(`[melhor-envio-callback] token endpoint HTTP ${tokenRes.status}`);
    if (!tokenRes.ok || !tokenData.access_token) {
      const errCode = (tokenData.error as string) || `http_${tokenRes.status}`;
      // errCode vem da API (ex.: invalid_grant), nunca do token em si.
      console.error(`[melhor-envio-callback] troca de código falhou: ${errCode}`);
      return redirectError(adminPanel, `token_exchange:${errCode}`);
    }

    const expiresIn = Number(tokenData.expires_in) || 30 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Tokens cifrados em repouso. O frontend nunca recebe esses valores.
    const accessToken = await encryptMeToken(tokenData.access_token as string);
    const refreshToken = await encryptMeToken(tokenData.refresh_token as string);

    const { error: upsertError } = await admin.from("melhor_envio_accounts").upsert(
      {
        catalog_id: stateData.catalogId,
        environment: stateData.environment,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_expires_at: expiresAt,
        connected: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "catalog_id" },
    );

    if (upsertError) {
      console.error("[melhor-envio-callback] falha ao salvar integração:", upsertError.message);
      return redirectError(adminPanel, "db_save_error");
    }

    console.log("[melhor-envio-callback] conta conectada para o catálogo:", stateData.catalogId);
    return Response.redirect(
      `${adminPanel}?me_connected=1&catalog=${encodeURIComponent(stateData.catalogId)}`,
      302,
    );
  } catch (err) {
    console.error("[melhor-envio-callback] erro interno:", err);
    return new Response("Erro interno", { status: 500 });
  }
});
