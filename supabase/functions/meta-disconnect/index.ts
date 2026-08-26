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

    const body = await req.json();
    const catalogId = body.catalog_id as string;
    if (!catalogId) {
      return new Response(
        JSON.stringify({ error: "catalog_id required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const admin = getSupabaseAdmin();

    const { data: conn } = await admin
      .from("meta_catalog_connections")
      .select("id")
      .eq("catalog_id", catalogId)
      .eq("user_id", user.id)
      .single();

    if (!conn) {
      return new Response(
        JSON.stringify({ error: "Conexão não encontrada" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    await admin
      .from("meta_catalog_connections")
      .update({
        facebook_access_token: "",
        refresh_token: null,
        token_expires_at: new Date().toISOString(),
        sync_status: "disconnected",
        last_sync_error: null,
      })
      .eq("catalog_id", catalogId);

    await admin
      .from("catalogs")
      .update({ meta_catalog_connected: false })
      .eq("id", catalogId);

    await admin.from("meta_sync_logs").insert({
      catalog_id: catalogId,
      operation: "disconnect",
      status: "completed",
      items_total: 0,
      items_created: 0,
      items_updated: 0,
      items_deleted: 0,
      items_failed: 0,
      error_details: [],
      completed_at: new Date().toISOString(),
    });

    return new Response(
      JSON.stringify({
        success: true,
        message: "Desconectado. Produtos no catálogo Meta foram mantidos.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[meta-disconnect]", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
