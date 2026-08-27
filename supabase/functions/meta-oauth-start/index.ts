import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { verifyUser, getSupabaseAdmin } from "../_shared/meta-api.ts";

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

    const url = new URL(req.url);
    const catalogId = url.searchParams.get("catalog_id");
    const phoneNumber = url.searchParams.get("phone_number");

    if (!catalogId) {
      return new Response(JSON.stringify({ error: "catalog_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const appId = Deno.env.get("META_APP_ID");
    if (!appId) {
      return new Response(
        JSON.stringify({ error: "A integração com a Meta ainda não está configurada." }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const vitrineUrl = Deno.env.get("VITRINE_URL") || "https://vitrine.meellcriativa.workers.dev";
    const redirectUri = `${vitrineUrl}/painel/whatsapp`;
    const state = catalogId;

    const scopes = "catalog_management,business_management";
    const apiVersion = Deno.env.get("META_CATALOG_API_VERSION") || "v23.0";
    const oauthUrl =
      `https://www.facebook.com/${apiVersion}/dialog/oauth` +
      `?client_id=${appId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}` +
      `&scope=${scopes}` +
      `&response_type=code`;

    if (phoneNumber) {
      await admin
        .from("meta_catalog_connections")
        .upsert(
          {
            catalog_id: catalogId,
            user_id: user.id,
            phone_number: phoneNumber,
            facebook_user_id: "pending",
            facebook_access_token: "",
            sync_status: "pending",
          },
          { onConflict: "catalog_id" },
        );
    }

    return new Response(JSON.stringify({ url: oauthUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[meta-oauth-start]", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
