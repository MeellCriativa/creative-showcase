import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyUser, getSupabaseAdmin } from "../_shared/meta-api.ts";

const META_API_VERSION = Deno.env.get("META_CATALOG_API_VERSION") || "v23.0";
const GRAPH_URL = `https://graph.facebook.com/${META_API_VERSION}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const user = await verifyUser(req);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const code = body.code as string;
    const catalogId = body.catalog_id as string;
    if (!code || !catalogId) {
      return new Response(
        JSON.stringify({ error: "code and catalog_id required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = getSupabaseAdmin();
    const { data: catalog } = await admin
      .from("catalogs")
      .select("id")
      .eq("id", catalogId)
      .eq("user_id", user.id)
      .single();
    if (!catalog) {
      return new Response(JSON.stringify({ error: "Catalog not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appId = Deno.env.get("META_APP_ID")!;
    const appSecret = Deno.env.get("META_APP_SECRET")!;
    const vitrineUrl = Deno.env.get("VITRINE_URL") || "https://vitrine.meellcriativa.workers.dev";
    const redirectUri = `${vitrineUrl}/painel/whatsapp`;

    const tokenRes = await fetch(
      `${GRAPH_URL}/oauth/access_token?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${appSecret}&code=${code}`,
    );
    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      return new Response(
        JSON.stringify({ error: tokenData.error.message }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const shortToken = tokenData.access_token;

    const exchangeRes = await fetch(
      `${GRAPH_URL}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
    );
    const exchangeData = await exchangeRes.json();
    if (exchangeData.error) {
      console.error("[meta-oauth-callback] exchange error:", exchangeData.error);
    }
    const longToken = exchangeData.access_token || shortToken;
    const expiresIn = exchangeData.expires_in || 60 * 60 * 24 * 60;

    const meRes = await fetch(
      `${GRAPH_URL}/me?fields=id,name&access_token=${longToken}`,
    );
    const meData = await meRes.json();
    const facebookUserId = meData.id || "";
    const facebookUserName = meData.name || "";

    const bizRes = await fetch(
      `${GRAPH_URL}/me/businesses?fields=id,name&access_token=${longToken}`,
    );
    const bizData = await bizRes.json();
    const businesses = bizData.data ?? [];

    let bestBusinessId = "";
    let bestBusinessName = "";
    let bestCatalogIdMeta = "";
    let bestCatalogName = "";

    for (const biz of businesses) {
      const catRes = await fetch(
        `${GRAPH_URL}/${biz.id}/owned_product_catalogs?fields=id,name&access_token=${longToken}`,
      );
      const catData = await catRes.json();
      const catalogs = catData.data ?? [];
      if (catalogs.length > 0) {
        bestBusinessId = biz.id;
        bestBusinessName = biz.name || "";
        bestCatalogIdMeta = catalogs[0].id;
        bestCatalogName = catalogs[0].name || "";
        break;
      }
    }

    if (!bestCatalogIdMeta) {
      return new Response(
        JSON.stringify({
          error: "Nenhum catálogo encontrado. Crie um catálogo no Meta Commerce Manager primeiro.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await admin.from("meta_catalog_connections").upsert(
      {
        catalog_id: catalogId,
        user_id: user.id,
        facebook_user_id: facebookUserId,
        facebook_access_token: longToken,
        token_expires_at: expiresAt,
        refresh_token: longToken,
        business_id: bestBusinessId,
        business_name: bestBusinessName,
        catalog_id_meta: bestCatalogIdMeta,
        catalog_name: bestCatalogName,
        sync_status: "connected",
      },
      { onConflict: "catalog_id" },
    );

    await admin
      .from("catalogs")
      .update({ meta_catalog_connected: true })
      .eq("id", catalogId);

    return new Response(
      JSON.stringify({
        success: true,
        business_id: bestBusinessId,
        business_name: bestBusinessName,
        catalog_id_meta: bestCatalogIdMeta,
        catalog_name: bestCatalogName,
        facebook_user_name: facebookUserName,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[meta-oauth-callback]", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
