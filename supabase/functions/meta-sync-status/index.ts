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

    const { data: logs } = await admin
      .from("meta_sync_logs")
      .select("*")
      .eq("catalog_id", catalogId)
      .order("started_at", { ascending: false })
      .limit(10);

    const { data: mappingStats } = await admin
      .from("meta_product_mapping")
      .select("sync_state")
      .eq("catalog_id", catalogId);

    const stats = {
      synced: 0,
      pending: 0,
      error: 0,
      deleted: 0,
    };
    for (const m of mappingStats ?? []) {
      if (m.sync_state === "synced") stats.synced++;
      else if (m.sync_state === "pending") stats.pending++;
      else if (m.sync_state === "error") stats.error++;
      else if (m.sync_state === "deleted") stats.deleted++;
    }

    return new Response(
      JSON.stringify({ logs: logs ?? [], mapping_stats: stats }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[meta-sync-status]", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
