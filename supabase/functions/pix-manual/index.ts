/**
 * Pix manual (sem provedor automático).
 *
 * O comprador nunca aprova o próprio pagamento: `declare_paid` apenas registra
 * a declaração. A aprovação financeira acontece somente em `confirm`, com
 * autenticação do dono da loja, através da RPC service-role
 * `confirm_manual_payment`. A entrega digital só é disparada depois disso.
 */
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  adminClient,
  getOwnedCatalog,
  validateCheckoutSession,
  verifyUser,
} from "../_shared/payments/db.ts";
import { createSecureOrder } from "../_shared/payments/orders.ts";
import { deliverDigitalOrder } from "../_shared/digital_delivery.ts";

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function text(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

const UUID = /^[0-9a-f-]{36}$/i;

type PixCatalog = {
  id: string;
  slug: string;
  store_name: string;
  currency: string | null;
  payment_methods: string[] | null;
  pix_mode: string | null;
  pix_key_type: string | null;
  pix_key_value: string | null;
  pix_holder_name: string | null;
  pix_qr_path: string | null;
  pix_qr_name: string | null;
};

async function loadPixCatalog(input: { slug?: string; catalogId?: string }): Promise<PixCatalog | null> {
  const admin = adminClient();
  let query = admin
    .from("catalogs")
    .select(
      "id,slug,store_name,currency,payment_methods,pix_mode,pix_key_type,pix_key_value,pix_holder_name,pix_qr_path,pix_qr_name",
    );
  if (input.catalogId && UUID.test(input.catalogId)) {
    query = query.eq("id", input.catalogId);
  } else if (input.slug) {
    query = query.eq("slug", text(input.slug, 120));
  } else {
    return null;
  }
  const { data } = await query.maybeSingle();
  return (data as PixCatalog | null) ?? null;
}

async function signedQrUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const admin = adminClient();
  const { data, error } = await admin.storage
    .from("catalog-images")
    .createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function pixEnabled(catalog: PixCatalog | null): boolean {
  if (!catalog) return false;
  const methods = Array.isArray(catalog.payment_methods) ? catalog.payment_methods : [];
  return methods.includes("pix");
}

function pixConfigured(catalog: PixCatalog | null): boolean {
  if (!catalog) return false;
  const mode = catalog.pix_mode ?? "key";
  const hasKey = Boolean(text(catalog.pix_key_type) && text(catalog.pix_key_value));
  const hasQr = Boolean(text(catalog.pix_qr_path));
  if (mode === "key") return hasKey;
  if (mode === "qr") return hasQr;
  return hasKey || hasQr;
}

function publicConfig(catalog: PixCatalog | null) {
  const available = pixEnabled(catalog) && pixConfigured(catalog);
  return {
    available,
    mode: catalog?.pix_mode ?? "key",
    // Nunca devolvemos pix_holder_document (dado sensível do titular).
    keyType: available && (catalog?.pix_mode ?? "key") !== "qr" ? catalog?.pix_key_type ?? null : null,
    keyValue: available && (catalog?.pix_mode ?? "key") !== "qr" ? catalog?.pix_key_value ?? null : null,
    holderName: available ? catalog?.pix_holder_name ?? null : null,
    qrName: available ? catalog?.pix_qr_name ?? null : null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "config";
    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    }
    const admin = adminClient();

    // ── Configuração pública exibida no checkout ────────────────────────────
    if (action === "config") {
      const catalog = await loadPixCatalog({
        slug: url.searchParams.get("slug") ?? text(body.slug),
        catalogId: url.searchParams.get("catalog_id") ?? text(body.catalog_id),
      });
      if (!catalog) return json({ success: false, error: "Loja não encontrada." }, 404);
      const config = publicConfig(catalog);
      const qrUrl = config.available ? await signedQrUrl(catalog.pix_qr_path) : null;
      return json({ success: true, ...config, qrUrl });
    }

    // ── Pedido Pix manual (usa o mesmo motor seguro de preços do payments) ──
    if (action === "create_order") {
      const catalogId = text(body.catalog_id ?? url.searchParams.get("catalog_id"));
      if (!UUID.test(catalogId)) return json({ success: false, error: "catalog_id é obrigatório." }, 400);
      const catalog = await loadPixCatalog({ catalogId });
      if (!pixEnabled(catalog) || !pixConfigured(catalog)) {
        return json(
          { success: false, error: "Esta loja ainda não habilitou o Pix manual." },
          409,
        );
      }

      const result = await createSecureOrder({
        catalogId,
        customerName: text(body.customer_name, 120),
        customerPhone: body.customer_phone == null ? null : text(body.customer_phone, 40),
        customerEmail: body.customer_email == null ? null : text(body.customer_email, 200),
        note: body.note == null ? null : text(body.note, 1000),
        items: Array.isArray(body.items) ? (body.items as never) : [],
        deliveryMethod: body.delivery_method == null ? null : text(body.delivery_method, 40),
        shippingZip: body.shipping_zip == null ? null : text(body.shipping_zip, 20),
        shippingService: body.shipping_service == null ? null : text(body.shipping_service, 60),
        address: (body.address as never) ?? null,
        paymentMethod: "pix_manual",
      });
      if (!result.ok) {
        return json({ success: false, error: result.error, code: result.code }, result.status);
      }

      const config = publicConfig(catalog);
      return json({
        success: true,
        order_id: result.orderId,
        checkout_token: result.checkoutToken,
        currency: result.currency,
        subtotal: result.subtotal,
        shipping_cost: result.shippingCost,
        total: result.total,
        items: result.items,
        store: result.catalog,
        pix: { ...config, qrUrl: await signedQrUrl(catalog?.pix_qr_path ?? null) },
      });
    }

    // ── Comprador declara que pagou (NUNCA aprova) ──────────────────────────
    if (action === "declare_paid") {
      const orderId = text(body.order_id ?? url.searchParams.get("order_id"));
      const token = text(body.checkout_token ?? url.searchParams.get("checkout_token"), 500);
      if (!UUID.test(orderId)) return json({ success: false, error: "Pedido inválido." }, 400);
      const session = await validateCheckoutSession(orderId, token, { allowConsumed: true });
      if (!session.ok) {
        return json({ success: false, error: session.reason ?? "Sessão inválida." }, 403);
      }
      const { data: order } = await admin
        .from("orders")
        .select("id, catalog_id, payment_method, payment_status, pix_declared_at")
        .eq("id", orderId)
        .maybeSingle();
      if (!order || order.payment_method !== "pix_manual") {
        return json({ success: false, error: "Pedido Pix não encontrado." }, 404);
      }
      if (order.payment_status !== "pending") {
        return json({ success: true, already_finalized: true, payment_status: order.payment_status });
      }
      if (!order.pix_declared_at) {
        const { error } = await admin
          .from("orders")
          .update({ pix_declared_at: new Date().toISOString() })
          .eq("id", orderId)
          .eq("payment_status", "pending")
          .is("pix_declared_at", null);
        if (error) return json({ success: false, error: "Não foi possível registrar a declaração." }, 500);
      }
      return json({ success: true, payment_status: "pending", message: "Aguardando confirmação da loja." });
    }

    // ── Consulta de status para o comprador ─────────────────────────────────
    if (action === "status") {
      const orderId = text(body.order_id ?? url.searchParams.get("order_id"));
      const token = text(body.checkout_token ?? url.searchParams.get("checkout_token"), 500);
      if (!UUID.test(orderId)) return json({ success: false, error: "Pedido inválido." }, 400);
      const session = await validateCheckoutSession(orderId, token, { allowConsumed: true });
      if (!session.ok) return json({ success: false, error: session.reason ?? "Sessão inválida." }, 403);
      const { data: order } = await admin
        .from("orders")
        .select("id, total, currency, payment_status, payment_method, pix_declared_at, pix_confirmed_at")
        .eq("id", orderId)
        .maybeSingle();
      if (!order || order.payment_method !== "pix_manual") {
        return json({ success: false, error: "Pedido Pix não encontrado." }, 404);
      }
      return json({ success: true, ...order });
    }

    // ── Confirmação do vendedor (a única escrita financeira deste fluxo) ───
    if (action === "confirm") {
      const user = await verifyUser(req);
      if (!user) return json({ success: false, error: "Não autorizado." }, 401);
      const orderId = text(body.order_id ?? url.searchParams.get("order_id"));
      if (!UUID.test(orderId)) return json({ success: false, error: "Pedido inválido." }, 400);

      const { data: order } = await admin
        .from("orders")
        .select("id, catalog_id, payment_method, payment_status, pix_declared_at, total, currency")
        .eq("id", orderId)
        .maybeSingle();
      if (!order || !(await getOwnedCatalog(user.id, String(order.catalog_id)))) {
        return json({ success: false, error: "Pedido não encontrado." }, 404);
      }
      if (order.payment_method !== "pix_manual") {
        return json({ success: false, error: "Este pedido não é do Pix manual." }, 409);
      }
      if (order.payment_status !== "pending") {
        return json({ success: false, error: "Este pedido já foi finalizado." }, 409);
      }
      if (!order.pix_declared_at) {
        return json(
          { success: false, error: "O comprador ainda não declarou o pagamento." },
          409,
        );
      }

      const { data: confirmed, error: rpcError } = await admin.rpc("confirm_manual_payment", {
        p_order_id: orderId,
        p_actor: user.id,
      });
      if (rpcError || !confirmed) {
        return json(
          { success: false, error: rpcError?.message ?? "Não foi possível confirmar o pagamento." },
          500,
        );
      }

      // Entrega digital: somente após a confirmação oficial acima.
      try {
        await deliverDigitalOrder(orderId, { paymentStatus: "approved" });
      } catch (error) {
        console.error("[pix-manual] falha ao agendar entrega digital", {
          orderId,
          error: error instanceof Error ? error.message : "erro",
        });
      }

      return json({ success: true, payment_status: "approved", order_id: orderId });
    }

    return json({ success: false, error: "Ação inválida." }, 400);
  } catch (error) {
    console.error("[pix-manual]", error instanceof Error ? error.message : "erro");
    return json({ success: false, error: "Erro interno." }, 500);
  }
});
