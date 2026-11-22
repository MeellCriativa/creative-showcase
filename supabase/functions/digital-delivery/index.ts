/** Edge Function de entregas digitais (somente e-mail nesta versão). */
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient, getOwnedCatalog, verifyUser } from "../_shared/payments/db.ts";
import {
  processDownload,
  regenerateDelivery,
  revokeDelivery,
  retryDelivery,
} from "../_shared/digital_delivery.ts";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "status";

    // Download é público, mas exclusivamente via token criptograficamente seguro.
    if (action === "download") {
      const token = String(url.searchParams.get("token") ?? "");
      return await processDownload(token);
    }

    const user = await verifyUser(req);
    if (!user) return json({ success: false, error: "Não autorizado." }, 401);

    const admin = adminClient();
    if (action === "status") {
      const catalogId = String(url.searchParams.get("catalog_id") ?? "");
      if (!catalogId || !(await getOwnedCatalog(user.id, catalogId))) {
        return json({ success: false, error: "Loja não encontrada." }, 404);
      }
      const { data, error } = await admin
        .from("digital_deliveries")
        .select("id, order_id, product_id, customer_email, status, attempts, sent_at, revoked_at, last_error, created_at, products(name)")
        .eq("catalog_id", catalogId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return json({ success: false, error: "Falha ao consultar entregas." }, 500);
      const deliveries = data ?? [];
      const ids = deliveries.map((d: { id: string }) => d.id);
      const orderIds = [
        ...new Set(
          deliveries
            .map((d: { order_id: string }) => String(d.order_id ?? ""))
            .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
        ),
      ];
      let tokens: Array<Record<string, unknown>> = [];
      let transactions: Array<Record<string, unknown>> = [];
      if (ids.length) {
        const t = await admin
          .from("digital_download_tokens")
          .select("delivery_id, expires_at, max_uses, used_count, revoked_at")
          .in("delivery_id", ids);
        tokens = (t.data ?? []) as Array<Record<string, unknown>>;
      }
      if (orderIds.length) {
        const tx = await admin
          .from("payment_transactions")
          .select("order_id, status, last_event_at, updated_at")
          .in("order_id", orderIds);
        transactions = (tx.data ?? []) as Array<Record<string, unknown>>;
      }
      return json({
        success: true,
        deliveries: deliveries.map((d: Record<string, unknown>) => {
          const tx = transactions.find((t) => t.order_id === d.order_id);
          return {
            ...d,
            // Data da confirmação oficial do pagamento (nunca do navegador).
            approved_at: tx?.last_event_at ?? tx?.updated_at ?? null,
            token: tokens.find((t) => t.delivery_id === d.id) ?? null,
          };
        }),
      });
    }

    if (["retry", "regenerate", "revoke"].includes(action)) {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const deliveryId = String(body.delivery_id ?? url.searchParams.get("delivery_id") ?? "");
      if (!deliveryId) return json({ success: false, error: "delivery_id é obrigatório." }, 400);
      const { data: delivery } = await admin
        .from("digital_deliveries")
        .select("id, catalog_id")
        .eq("id", deliveryId)
        .maybeSingle();
      if (!delivery || !(await getOwnedCatalog(user.id, delivery.catalog_id))) {
        return json({ success: false, error: "Entrega não encontrada." }, 404);
      }
      if (action === "revoke") {
        const result = await revokeDelivery(deliveryId);
        return json({ success: result.ok, revoked: result.revoked });
      }
      const result =
        action === "retry"
          ? await retryDelivery(deliveryId)
          : await regenerateDelivery(deliveryId);
      const friendly: Record<string, string> = {
        link_expired_need_new: "O link expirou ou foi revogado. Gere um novo link para reenviar.",
        no_confirmation_email: "Não há e-mail de confirmação registrado para este pedido.",
        send_in_progress_or_recent:
          "Um envio já está em andamento ou foi feito agora. Aguarde alguns segundos.",
        brevo_not_configured: "Envio de e-mail não configurado.",
        not_found: "Entrega não encontrada.",
        no_file: "O arquivo deste produto não está mais disponível.",
      };
      return json({
        success: result.ok && result.failed === 0,
        ...result,
        ...(result.ok || !result.reason ? {} : { error: friendly[result.reason] ?? result.message ?? result.reason }),
      });
    }

    return json({ success: false, error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("[digital-delivery]", error instanceof Error ? error.message : "erro");
    return json({ success: false, error: "Erro interno." }, 500);
  }
});
