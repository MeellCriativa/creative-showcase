/**
 * Envio do e-mail de "novo pedido" ao responsável pela loja.
 * Usa o mesmo Brevo já configurado para a entrega digital.
 */
import { adminClient } from "./payments/db.ts";
import { sendSellerOrderPush } from "./seller_push.ts";
import { buildBrevoEmailPayload } from "./digital_delivery_pure.ts";
import {
  buildSellerOrderEmail,
  isRecentOrder,
  type SellerOrderEmailInput,
} from "./seller_notifications_pure.ts";

function log(message: string, extra?: unknown): void {
  console.log(`[seller-notifications] ${message}`, extra ?? "");
}

function config(): {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  panelBase: string;
} | null {
  const apiKey = Deno.env.get("BREVO_API_KEY")?.trim() ?? "";
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL")?.trim() ?? "";
  const senderName = Deno.env.get("BREVO_SENDER_NAME")?.trim() ?? "";
  if (!apiKey || !senderEmail || !senderName) return null;
  const panelBase =
    Deno.env.get("VITRINE_URL")?.trim().replace(/\/+$/, "") ||
    "https://vitrine.meellcriativa.workers.dev";
  return { apiKey, senderEmail, senderName, panelBase };
}

type OrderRow = {
  id: string;
  catalog_id: string;
  customer_name: string | null;
  total: number;
  currency: string | null;
  payment_method: string | null;
  created_at: string;
  items: unknown;
};

function parseItems(raw: unknown): SellerOrderEmailInput["items"] {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 40).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const name = String(item.name ?? item.productName ?? item.title ?? "").trim();
    if (!name) return [];
    return [
      {
        name: name.slice(0, 120),
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice ?? item.price ?? 0) || 0,
      },
    ];
  });
}

/**
 * Deve ser chamado logo após a criação do pedido (best-effort: nunca derruba o checkout).
 * Funciona tanto nas Edge Functions quanto no insert anônimo de fallback, pois a
 * inscrição na fila é feita por trigger no banco.
 */
export async function notifySellerNewOrder(orderId: string): Promise<void> {
  try {
    const db = adminClient();
    const cfg = config();

    const { data: order, error: orderError } = await db
      .from("orders")
      .select("id,catalog_id,customer_name,total,currency,payment_method,created_at,items")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError || !order) {
      log("pedido não encontrado", orderError?.message ?? orderId);
      await db
        .from("seller_order_notifications")
        .update({ email_status: "failed", email_last_error: "order_not_found" })
        .eq("order_id", orderId);
      return;
    }
    const row = order as OrderRow;
    if (!isRecentOrder(row.created_at)) {
      log("pedido antigo; ignorado", orderId);
      await db
        .from("seller_order_notifications")
        .update({ email_status: "failed", email_last_error: "stale_order" })
        .eq("order_id", orderId);
      return;
    }

    const { data: catalog, error: catalogError } = await db
      .from("catalogs")
      .select("id,user_id,store_name,slug")
      .eq("id", row.catalog_id)
      .maybeSingle();
    if (catalogError || !catalog?.user_id) {
      log("dono da loja não encontrado", catalogError?.message ?? row.catalog_id);
      await db
        .from("seller_order_notifications")
        .update({ email_status: "failed", email_last_error: "owner_not_found" })
        .eq("order_id", orderId);
      return;
    }
    const storeName = String(catalog.store_name ?? "Sua vitrine");

    // Push primeiro: é o aviso mais imediato e tem reserva própria, então o
    // e-mail (Brevo) pode falhar ou não estar configurado sem afetá-lo.
    await sendSellerOrderPush({
      orderId: row.id,
      catalogId: row.catalog_id,
      customerName: row.customer_name,
      total: Number(row.total) || 0,
      currency: row.currency,
      storeName,
    });

    if (!cfg) {
      log("Brevo não configurado; e-mail do vendedor ignorado");
      return;
    }

    const { data: claimed, error: claimError } = await db.rpc("claim_seller_order_email", {
      p_order_id: orderId,
    });
    if (claimError) {
      log("falha ao reservar envio", claimError.message);
      return;
    }
    if (!claimed) return; // já enviado, em envio ou houve erro recente

    const { data: auth, error: authError } = await db.auth.admin.getUserById(
      catalog.user_id,
    );
    const sellerEmail = auth?.user?.email?.trim() ?? "";
    if (authError || !sellerEmail) {
      log("e-mail do vendedor indisponível", authError?.message ?? catalog.user_id);
      await db
        .from("seller_order_notifications")
        .update({ email_status: "failed", email_last_error: "seller_email_missing" })
        .eq("order_id", orderId);
      return;
    }

    const email = buildSellerOrderEmail({
      storeName,
      customerName: String(row.customer_name ?? "Cliente"),
      orderId: row.id,
      total: Number(row.total) || 0,
      currency: String(row.currency ?? "BRL"),
      paymentMethod: row.payment_method,
      items: parseItems(row.items),
      panelUrl: `${cfg.panelBase}/painel/pedidos`,
    });
    const payload = buildBrevoEmailPayload({
      senderName: cfg.senderName,
      senderEmail: cfg.senderEmail,
      to: sellerEmail,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": cfg.apiKey,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const reason = `brevo_http_${res.status}`;
      log("falha no envio", reason, detail.slice(0, 200));
      await db
        .from("seller_order_notifications")
        .update({ email_status: "failed", email_last_error: reason })
        .eq("order_id", orderId);
      return;
    }
    await db
      .from("seller_order_notifications")
      .update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_last_error: null })
      .eq("order_id", orderId);
    log("e-mail enviado", orderId);
  } catch (error) {
    log("erro inesperado", error instanceof Error ? error.message : error);
  }
}
