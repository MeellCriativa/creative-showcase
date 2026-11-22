/**
 * Web Push do "novo pedido" para o vendedor.
 *
 * Best-effort: nunca derruba o checkout nem o envio do e-mail. As inscrições
 * ficam no Supabase (uma por dispositivo/navegador) e são enviadas via VAPID.
 */
import webpush from "npm:web-push@3.6.7";

import { adminClient } from "./payments/db.ts";
import { buildSellerOrderPush } from "./seller_notifications_pure.ts";

type PushSubscriptionRow = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function log(message: string, extra?: unknown): void {
  console.log(`[seller-push] ${message}`, extra ?? "");
}

function config(): { publicKey: string; privateKey: string; subject: string; panelBase: string } | null {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")?.trim() ?? "";
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")?.trim() ?? "";
  if (!publicKey || !privateKey) {
    log("chaves VAPID não configuradas; push ignorado");
    return null;
  }
  const subject =
    Deno.env.get("VAPID_SUBJECT")?.trim() || "mailto:contato@meellcriativa.com";
  const panelBase =
    Deno.env.get("VITRINE_URL")?.trim().replace(/\/+$/, "") ||
    "https://vitrine.meellcriativa.workers.dev";
  return { publicKey, privateKey, subject, panelBase };
}

/** Reserva atômica do push (evita notificar o mesmo pedido duas vezes). */
async function claimSellerOrderPush(orderId: string): Promise<boolean> {
  const db = adminClient();
  const { data, error } = await db.rpc("claim_seller_order_push", { p_order_id: orderId });
  if (error) {
    log("falha ao reservar push (migration pendente?)", error.message);
    return false;
  }
  return !!data;
}

async function markSellerOrderPush(
  orderId: string,
  ok: boolean,
  lastError?: string,
): Promise<void> {
  const db = adminClient();
  const { error } = await db
    .from("seller_order_notifications")
    .update(
      ok
        ? { push_status: "sent", push_sent_at: new Date().toISOString(), push_last_error: null }
        : { push_status: "failed", push_last_error: String(lastError ?? "").slice(0, 300) },
    )
    .eq("order_id", orderId);
  if (error) log("falha ao registrar resultado do push", error.message);
}

export async function sendSellerOrderPush(input: {
  orderId: string;
  catalogId: string;
  customerName: string | null;
  total: number;
  currency: string | null;
  storeName: string | null;
}): Promise<void> {
  try {
    const cfg = config();
    if (!cfg) return;
    if (!(await claimSellerOrderPush(input.orderId))) return;

    const db = adminClient();
    const { data: subscriptions, error } = await db
      .from("seller_push_subscriptions")
      .select("endpoint,p256dh,auth")
      .eq("catalog_id", input.catalogId);
    if (error) {
      log("falha ao buscar inscrições", error.message);
      await markSellerOrderPush(input.orderId, false, error.message);
      return;
    }
    if (!subscriptions?.length) {
      log("nenhum dispositivo inscrito", input.catalogId);
      await markSellerOrderPush(input.orderId, false, "no_subscriptions");
      return;
    }

    webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
    const payload = buildSellerOrderPush({
      orderId: input.orderId,
      customerName: input.customerName,
      total: Number(input.total) || 0,
      currency: input.currency,
      storeName: input.storeName,
      panelUrl: cfg.panelBase,
    });

    const results = await Promise.allSettled(
      (subscriptions as PushSubscriptionRow[]).map(async (row) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: row.endpoint,
              keys: { p256dh: row.p256dh, auth: row.auth },
            },
            JSON.stringify(payload),
          );
          return "sent";
        } catch (err) {
          const status = Number((err as { statusCode?: number }).statusCode ?? 0);
          // 404/410 = inscrição expirada: remove para não insistir forever.
          if (status === 404 || status === 410) {
            await db.from("seller_push_subscriptions").delete().eq("endpoint", row.endpoint);
            return "removed";
          }
          throw err;
        }
      }),
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - sent;
    log("push concluído", { sent, failed, orderId: input.orderId });
    const firstError = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    for (const result of results) {
      if (result.status === "rejected") log("falha em dispositivo", result.reason);
    }
    await markSellerOrderPush(
      input.orderId,
      sent > 0,
      firstError ? String(firstError.reason) : "no_subscriptions",
    );
  } catch (error) {
    log("erro inesperado", error instanceof Error ? error.message : error);
  }
}
