import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import {
  getSupabaseAdmin,
  getBase,
  getPlatformEnv,
} from "../_shared/melhor-envio.ts";

// Callback recebido pelo browser após o dono da loja autorizar na Melhor Envio.
serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state"); // catalog_id
    const error = url.searchParams.get("error");

    const vitrineUrl = Deno.env.get("VITRINE_URL") || "https://vitrine.meellcriativa.workers.dev";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://wdcufpvlbisnqtvmbyso.supabase.co";
    const adminPanel = `${vitrineUrl}/painel/envio`;
    const failUrl = `${adminPanel}?me_connected=0&error=${encodeURIComponent(
      error || "authorization_failed",
    )}`;

    if (error) {
      return Response.redirect(failUrl, 302);
    }

    const catalogId = state || "";
    if (!catalogId || !code) {
      return Response.redirect(`${adminPanel}?me_connected=0&error=missing_params`, 302);
    }

    const base = getBase(getPlatformEnv());
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
    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      console.error("[melhor-envio-callback] troca de código falhou", tokenRes.status, JSON.stringify(tokenData));
      return Response.redirect(`${adminPanel}?me_connected=0&error=token_exchange`, 302);
    }

    const expiresIn = tokenData.expires_in || 30 * 24 * 60 * 60;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    const admin = getSupabaseAdmin();
    await admin.from("melhor_envio_accounts").upsert(
      {
        catalog_id: catalogId,
        environment: getPlatformEnv(),
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        token_expires_at: expiresAt,
        connected: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "catalog_id" },
    );

    return Response.redirect(`${adminPanel}?me_connected=1&catalog=${encodeURIComponent(catalogId)}`, 302);
  } catch (err) {
    console.error("[melhor-envio-callback]", err);
    return new Response("Erro interno", { status: 500 });
  }
});
