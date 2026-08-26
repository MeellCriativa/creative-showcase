import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  verifyUser,
  getSupabaseAdmin,
  mapProductToMeta,
  batchWithRetry,
} from "../_shared/meta-api.ts";

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

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
      .select("*")
      .eq("catalog_id", catalogId)
      .eq("user_id", user.id)
      .single();

    if (!conn || conn.sync_status === "disconnected") {
      return new Response(
        JSON.stringify({ error: "Não conectado ao Meta" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    await admin
      .from("meta_catalog_connections")
      .update({ sync_status: "syncing", last_sync_error: null })
      .eq("catalog_id", catalogId);

    const logEntry = {
      catalog_id: catalogId,
      operation: "incremental_sync",
      status: "running",
      items_total: 0,
      items_created: 0,
      items_updated: 0,
      items_deleted: 0,
      items_failed: 0,
      error_details: [] as unknown[],
    };

    const { data: logRow } = await admin
      .from("meta_sync_logs")
      .insert(logEntry)
      .select("id")
      .single();
    const logId = logRow?.id;

    try {
      const { data: catalog } = await admin
        .from("catalogs")
        .select("slug, store_name")
        .eq("id", catalogId)
        .single();

      const vitrineUrl = Deno.env.get("VITRINE_URL") || "https://vitrine.meellcriativa.workers.dev";
      const catalogUrl = `${vitrineUrl}/c/${catalog?.slug}`;
      const storeName = catalog?.store_name || "Vitrine Criativa";

      const { data: products } = await admin
        .from("products")
        .select("id, name, description, price, sale_price, images, available")
        .eq("catalog_id", catalogId);

      const { data: existingMappings } = await admin
        .from("meta_product_mapping")
        .select("product_id, meta_retailer_id, sync_state")
        .eq("catalog_id", catalogId);

      const mappingByProductId = new Map(
        (existingMappings ?? []).map((m) => [m.product_id, m]),
      );

      const allProducts = products ?? [];
      logEntry.items_total = allProducts.length;

      const toUpsert: Array<{ method: string; data: Record<string, unknown> }> = [];

      for (const product of allProducts) {
        const retailerId = `vc-${product.id}`;
        const metaItem = mapProductToMeta(
          {
            id: product.id,
            name: product.name,
            description: product.description,
            price: product.price,
            sale_price: product.sale_price,
            images: product.images ?? [],
            available: product.available ?? true,
          },
          catalogUrl,
          storeName,
        );

        const existing = mappingByProductId.get(product.id);
        toUpsert.push({ method: "UPDATE", data: metaItem });

        if (!existing) {
          logEntry.items_created++;
        } else {
          logEntry.items_updated++;
        }

        await admin
          .from("meta_product_mapping")
          .upsert(
            {
              catalog_id: catalogId,
              product_id: product.id,
              meta_retailer_id: retailerId,
              sync_state: "pending",
            },
            { onConflict: "catalog_id,product_id" },
          );
      }

      if (toUpsert.length > 0) {
        const batches = chunk(toUpsert, 5000);
        for (const batch of batches) {
          const result = await batchWithRetry(
            conn.catalog_id_meta,
            conn.facebook_access_token,
            batch,
          );
          if (result.handle) {
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      }

      const productIds = new Set(allProducts.map((p) => p.id));
      for (const [productId, mapping] of mappingByProductId) {
        if (!productIds.has(productId)) {
          await admin
            .from("meta_product_mapping")
            .update({ sync_state: "deleted" })
            .eq("product_id", productId)
            .eq("catalog_id", catalogId);
          logEntry.items_deleted++;
        }
      }

      await admin
        .from("meta_product_mapping")
        .update({ sync_state: "synced", last_synced_at: new Date().toISOString() })
        .eq("catalog_id", catalogId)
        .eq("sync_state", "pending");

      logEntry.status = "completed";
      if (logId) {
        await admin
          .from("meta_sync_logs")
          .update({
            status: logEntry.status,
            items_total: logEntry.items_total,
            items_created: logEntry.items_created,
            items_updated: logEntry.items_updated,
            items_deleted: logEntry.items_deleted,
            items_failed: logEntry.items_failed,
            error_details: logEntry.error_details,
            completed_at: new Date().toISOString(),
          })
          .eq("id", logId);
      }

      await admin
        .from("meta_catalog_connections")
        .update({
          sync_status: "connected",
          last_synced_at: new Date().toISOString(),
          last_sync_error: null,
        })
        .eq("catalog_id", catalogId);

      return new Response(
        JSON.stringify({
          success: true,
          items_total: logEntry.items_total,
          items_created: logEntry.items_created,
          items_updated: logEntry.items_updated,
          items_deleted: logEntry.items_deleted,
          items_failed: logEntry.items_failed,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    } catch (syncErr) {
      console.error("[meta-sync-products] sync error:", syncErr);
      const errorMsg = syncErr instanceof Error ? syncErr.message : "Sync failed";

      logEntry.status = "failed";
      logEntry.error_details = [{ message: errorMsg }];
      if (logId) {
        await admin
          .from("meta_sync_logs")
          .update({
            status: "failed",
            items_total: logEntry.items_total,
            items_created: logEntry.items_created,
            items_updated: logEntry.items_updated,
            items_deleted: logEntry.items_deleted,
            items_failed: logEntry.items_total - logEntry.items_created - logEntry.items_updated,
            error_details: logEntry.error_details,
            completed_at: new Date().toISOString(),
          })
          .eq("id", logId);
      }

      await admin
        .from("meta_catalog_connections")
        .update({ sync_status: "error", last_sync_error: errorMsg })
        .eq("catalog_id", catalogId);

      return new Response(
        JSON.stringify({ error: errorMsg }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
  } catch (err) {
    console.error("[meta-sync-products]", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
