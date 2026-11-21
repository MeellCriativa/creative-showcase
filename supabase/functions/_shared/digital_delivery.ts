/**
 * Orquestração da entrega digital pós-pagamento.
 *
 * Regras:
 *   - chamada somente depois de applyOfficialSnapshot() confirmar o pagamento
 *     na API oficial do provedor;
 *   - idempotente por (order_id, product_id);
 *   - e-mail só é marcado como enviado depois que o Brevo aceitar o envio;
 *   - o token completo nunca é persistido — apenas seu hash SHA-256;
 *   - falha de entrega NUNCA altera o resultado financeiro do webhook.
 */
import { adminClient, getCatalog } from "./payments/db.ts";
import { randomToken, sha256Hex } from "./payments/crypto.ts";
import {
  brevoFailureReason,
  buildBrevoEmailPayload,
  buildDeliveryEmail,
  buildDownloadUrl,
  clampInteger,
  DIGITAL_BUCKET,
  isBlockedPaymentStatus,
  isPaidPaymentStatus,
  normalizeEmail,
  safeError,
} from "./digital_delivery_pure.ts";

const SIGNED_URL_SECONDS = 300;

type ProductRow = {
  id: string;
  name: string;
  product_type: string | null;
  digital_file_path: string | null;
  digital_file_name: string | null;
  digital_instructions: string | null;
  digital_link_ttl_minutes: number | null;
  digital_max_downloads: number | null;
};

type DeliveryRow = {
  id: string;
  order_id: string;
  catalog_id: string;
  product_id: string;
  customer_email: string;
  status: string;
  attempts: number;
  sent_at: string | null;
};

export type DeliveryOutcome = {
  ok: boolean;
  delivered: number;
  skipped: number;
  failed: number;
  reason?: string;
};

function log(message: string, extra?: unknown): void {
  console.log(`[digital-delivery] ${message}`, extra ?? "");
}

function config(): {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  functionBase: string;
} | null {
  const apiKey = Deno.env.get("BREVO_API_KEY")?.trim() ?? "";
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL")?.trim() ?? "";
  const senderName = Deno.env.get("BREVO_SENDER_NAME")?.trim() ?? "";
  const url = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
  if (!apiKey || !senderEmail || !senderName || !url) return null;
  return { apiKey, senderEmail, senderName, functionBase: `${url}/functions/v1` };
}

async function sendViaBrevo(input: {
  apiKey: string;
  senderEmail: string;
  senderName: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": input.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        buildBrevoEmailPayload({
          senderName: input.senderName,
          senderEmail: input.senderEmail,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
        }),
      ),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      // Nunca imprime o corpo nem o header "api-key": a resposta pode conter
      // dados da conta e o header contém a credencial.
      return { ok: false, error: brevoFailureReason(response.status) };
    }
    let messageId: string | undefined;
    try {
      const payload = (await response.json()) as { messageId?: unknown };
      if (typeof payload.messageId === "string") messageId = payload.messageId;
    } catch {
      /* 2xx sem JSON ainda é aceitação válida pelo Brevo */
    }
    return { ok: true, messageId };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

async function createDownloadToken(input: {
  deliveryId: string;
  orderId: string;
  catalogId: string;
  productId: string;
  ttlMinutes: number;
  maxUses: number;
}): Promise<string> {
  const admin = adminClient();
  const raw = randomToken(32);
  const tokenHash = await sha256Hex(raw);
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000).toISOString();
  const { error } = await admin.from("digital_download_tokens").insert({
    delivery_id: input.deliveryId,
    order_id: input.orderId,
    catalog_id: input.catalogId,
    product_id: input.productId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    max_uses: input.maxUses,
  });
  if (error) throw error;
  return raw;
}

async function revokeTokensForDelivery(deliveryId: string): Promise<number> {
  const admin = adminClient();
  const { data, error } = await admin
    .from("digital_download_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("delivery_id", deliveryId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw error;
  return data?.length ?? 0;
}

/** Revoga todos os links ainda válidos de um pedido (reembolso/chargeback/cancelamento). */
export async function revokeOrderDeliveries(orderId: string): Promise<number> {
  const admin = adminClient();
  const now = new Date().toISOString();
  const { data: tokens, error: tokenError } = await admin
    .from("digital_download_tokens")
    .update({ revoked_at: now })
    .eq("order_id", orderId)
    .is("revoked_at", null)
    .select("id");
  if (tokenError) throw tokenError;
  const { error: deliveryError } = await admin
    .from("digital_deliveries")
    .update({ revoked_at: now, updated_at: now })
    .eq("order_id", orderId)
    .is("revoked_at", null);
  if (deliveryError) throw deliveryError;
  return tokens?.length ?? 0;
}

/**
 * Dispara (ou reenvia) as entregas digitais de um pedido.
 * `force` é usado apenas por ações explícitas do vendedor no painel.
 */
export async function deliverDigitalOrder(
  orderId: string,
  options: {
    paymentStatus?: string;
    onlyProductId?: string;
    force?: boolean;
  } = {},
): Promise<DeliveryOutcome> {
  const outcome: DeliveryOutcome = { ok: true, delivered: 0, skipped: 0, failed: 0 };
  const admin = adminClient();

  if (options.paymentStatus && isBlockedPaymentStatus(options.paymentStatus)) {
    const revoked = await revokeOrderDeliveries(orderId);
    return { ...outcome, skipped: 1, reason: `payment_blocked:revoked=${revoked}` };
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id, catalog_id, customer_name, customer_email, payment_status, items")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order) {
    return { ...outcome, ok: false, reason: "order_not_found" };
  }

  const effectiveStatus =
    options.paymentStatus ?? String((order as Record<string, unknown>).payment_status ?? "");
  if (!isPaidPaymentStatus(effectiveStatus)) {
    return { ...outcome, skipped: 1, reason: "payment_not_approved" };
  }

  const customerEmail = normalizeEmail(String((order as Record<string, unknown>).customer_email ?? ""));
  if (!customerEmail) return { ...outcome, skipped: 1, reason: "customer_email_missing" };

  const rawItems = (order as Record<string, unknown>).items;
  const items = Array.isArray(rawItems)
    ? (rawItems as Array<Record<string, unknown>>)
    : [];
  const productIds = [
    ...new Set(
      items
        .map((item) => String(item?.product_id ?? ""))
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id)),
    ),
  ];
  if (productIds.length === 0) return { ...outcome, skipped: 1, reason: "no_product_ids" };

  const { data: products, error: productsError } = await admin
    .from("products")
    .select(
      "id,name,product_type,digital_file_path,digital_file_name,digital_instructions,digital_link_ttl_minutes,digital_max_downloads",
    )
    .in("id", productIds);
  if (productsError) return { ...outcome, ok: false, reason: "products_lookup_failed" };

  const allProducts = (products ?? []) as ProductRow[];
  const digitalProducts = allProducts.filter((product) => {
    if (options.onlyProductId && product.id !== options.onlyProductId) return false;
    if (product.product_type === "digital") return true;
    return items.some(
      (item) => String(item?.product_id ?? "") === product.id && item?.product_type === "digital",
    );
  });
  if (digitalProducts.length === 0) return { ...outcome, skipped: 1, reason: "no_digital_items" };

  const catalog = await getCatalog(String((order as Record<string, unknown>).catalog_id ?? ""));
  const cfg = config();

  if (!cfg) {
    // Não inventa sucesso: deixa a entrega pendente para reprocessamento.
    log("Brevo não configurado", { orderId, products: digitalProducts.length });
    return { ...outcome, ok: false, reason: "brevo_not_configured", skipped: digitalProducts.length };
  }

  for (const product of digitalProducts) {
    const emailLabel = safeError(product.name);
    try {
      if (!product.digital_file_path) {
        outcome.failed++;
        log("produto digital sem arquivo", { orderId, productId: product.id });
        continue;
      }

      const upsert = await admin
        .from("digital_deliveries")
        .upsert(
          {
            order_id: orderId,
            catalog_id: String((order as Record<string, unknown>).catalog_id ?? ""),
            product_id: product.id,
            customer_email: customerEmail,
            status: "pending",
          },
          { onConflict: "order_id,product_id", ignoreDuplicates: true },
        )
        .select("*");
      let delivery = (upsert.data?.[0] ?? null) as DeliveryRow | null;
      if (!delivery) {
        const existing = await admin
          .from("digital_deliveries")
          .select("*")
          .eq("order_id", orderId)
          .eq("product_id", product.id)
          .maybeSingle();
        delivery = (existing.data ?? null) as DeliveryRow | null;
      }
      if (!delivery) {
        outcome.failed++;
        continue;
      }
      if (delivery.status === "sent" && !options.force) {
        outcome.skipped++;
        continue;
      }

      if (options.force) await revokeTokensForDelivery(delivery.id);

      const rawToken = await createDownloadToken({
        deliveryId: delivery.id,
        orderId,
        catalogId: delivery.catalog_id,
        productId: product.id,
        ttlMinutes: clampInteger(product.digital_link_ttl_minutes, 5, 10080, 1440),
        maxUses: clampInteger(product.digital_max_downloads, 1, 100, 5),
      });
      const downloadUrl = buildDownloadUrl(cfg.functionBase, rawToken);
      const storeLink = catalog?.slug
        ? `${Deno.env.get("VITRINE_URL")?.replace(/\/+$/, "") ?? ""}/c/${catalog.slug}`
        : null;
      const message = buildDeliveryEmail({
        storeName: catalog?.store_name ?? "Vitrine Criativa",
        customerName: String((order as Record<string, unknown>).customer_name ?? "cliente"),
        productName: product.name,
        downloadUrl,
        instructions: product.digital_instructions,
        supportUrl: storeLink && /^https?:\/\//.test(storeLink) ? storeLink : null,
      });

      const sent = await sendViaBrevo({
        apiKey: cfg.apiKey,
        senderEmail: cfg.senderEmail,
        senderName: cfg.senderName,
        to: customerEmail,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });

      const { error: updateError } = await admin
        .from("digital_deliveries")
        .update({
          status: sent.ok ? "sent" : "failed",
          attempts: Number(delivery.attempts ?? 0) + 1,
          sent_at: sent.ok ? new Date().toISOString() : delivery.sent_at,
          provider_message_id: sent.ok ? sent.messageId ?? null : null,
          last_error: sent.ok ? null : safeError(sent.error),
          updated_at: new Date().toISOString(),
        })
        .eq("id", delivery.id);
      if (updateError) {
        outcome.failed++;
        log("falha ao registrar resultado da entrega", { orderId, productId: product.id });
        continue;
      }

      if (sent.ok) {
        outcome.delivered++;
        log("e-mail aceito pelo Brevo", { orderId, productId: product.id, produto: emailLabel });
      } else {
        outcome.failed++;
        log("envio falhou", { orderId, productId: product.id, erro: safeError(sent.error) });
      }
    } catch (error) {
      outcome.failed++;
      log("erro inesperado na entrega", { orderId, productId: product.id, erro: safeError(error) });
    }
  }

  return outcome;
}

export async function retryDelivery(deliveryId: string): Promise<DeliveryOutcome> {
  const admin = adminClient();
  const { data: delivery } = await admin
    .from("digital_deliveries")
    .select("id, order_id, product_id, status")
    .eq("id", deliveryId)
    .maybeSingle();
  if (!delivery) return { ok: false, delivered: 0, skipped: 0, failed: 0, reason: "not_found" };
  return await deliverDigitalOrder(delivery.order_id, { onlyProductId: delivery.product_id });
}

export async function regenerateDelivery(deliveryId: string): Promise<DeliveryOutcome> {
  const admin = adminClient();
  const { data: delivery } = await admin
    .from("digital_deliveries")
    .select("id, order_id, product_id")
    .eq("id", deliveryId)
    .maybeSingle();
  if (!delivery) return { ok: false, delivered: 0, skipped: 0, failed: 0, reason: "not_found" };
  return await deliverDigitalOrder(delivery.order_id, {
    onlyProductId: delivery.product_id,
    force: true,
  });
}

export async function revokeDelivery(deliveryId: string): Promise<{ ok: boolean; revoked: number }> {
  const admin = adminClient();
  const { data: delivery } = await admin
    .from("digital_deliveries")
    .select("id, order_id")
    .eq("id", deliveryId)
    .maybeSingle();
  if (!delivery) return { ok: false, revoked: 0 };
  const revoked = await revokeTokensForDelivery(deliveryId);
  await admin
    .from("digital_deliveries")
    .update({ revoked_at: new Date().toISOString(), status: "revoked", updated_at: new Date().toISOString() })
    .eq("id", deliveryId);
  return { ok: true, revoked };
}

function errorPage(status: number, title: string, message: string): Response {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:Arial,sans-serif;background:#f6f4fa;color:#2f2a3a;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:420px;padding:28px;background:#fff;border-radius:18px;text-align:center"><p style="font-size:28px">🔒</p><h1 style="font-size:20px;margin:8px 0">${title}</h1><p style="font-size:14px;color:#6d657c;line-height:1.6">${message}</p></div></body></html>`,
    {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    },
  );
}

/** Endpoint público: valida o token e devolve uma signed URL de curta duração. */
export async function processDownload(rawToken: string): Promise<Response> {
  if (!/^[a-f0-9]{64}$/i.test(rawToken)) {
    return errorPage(403, "Link inválido", "Este link de download não é válido.");
  }
  const admin = adminClient();
  const tokenHash = await sha256Hex(rawToken);
  const { data: token } = await admin
    .from("digital_download_tokens")
    .select("id, order_id, catalog_id, product_id, delivery_id, expires_at, max_uses, used_count, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!token) return errorPage(403, "Link inválido", "Este link de download não é válido.");
  const now = new Date().toISOString();
  if (token.revoked_at) return errorPage(410, "Link revogado", "Este link foi revogado.");
  if (String(token.expires_at) <= now) return errorPage(410, "Link expirado", "Este link expirou. Solicite um novo link à loja.");
  if (Number(token.used_count) >= Number(token.max_uses)) {
    return errorPage(410, "Limite atingido", "O limite de downloads deste link foi atingido.");
  }

  const { data: order } = await admin
    .from("orders")
    .select("id, payment_status")
    .eq("id", token.order_id)
    .maybeSingle();
  const paymentStatus = String((order as Record<string, unknown> | null)?.payment_status ?? "");
  if (isBlockedPaymentStatus(paymentStatus)) {
    return errorPage(403, "Download indisponível", "Este pedido não está mais disponível para download.");
  }
  if (!isPaidPaymentStatus(paymentStatus)) {
    return errorPage(403, "Aguardando pagamento", "O download será liberado após a confirmação do pagamento.");
  }

  const { data: delivery } = await admin
    .from("digital_deliveries")
    .select("id, status, revoked_at")
    .eq("id", token.delivery_id)
    .maybeSingle();
  if (!delivery || delivery.revoked_at || delivery.status === "revoked") {
    return errorPage(403, "Download indisponível", "Esta entrega foi revogada.");
  }

  const { data: product } = await admin
    .from("products")
    .select("digital_file_path")
    .eq("id", token.product_id)
    .maybeSingle();
  const path = String((product as Record<string, unknown> | null)?.digital_file_path ?? "");
  if (!path) return errorPage(404, "Arquivo indisponível", "O arquivo deste produto não está disponível.");

  // Incremento atômico com comparação de versão evita uso acima do limite.
  const { data: claimed } = await admin
    .from("digital_download_tokens")
    .update({ used_count: Number(token.used_count) + 1 })
    .eq("id", token.id)
    .eq("used_count", Number(token.used_count))
    .is("revoked_at", null)
    .gt("expires_at", now)
    .select("id")
    .maybeSingle();
  if (!claimed) return errorPage(410, "Link indisponível", "Este link não está mais disponível.");

  const { data: signed, error: signedError } = await admin.storage
    .from(DIGITAL_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (signedError || !signed?.signedUrl) {
    log("falha ao assinar arquivo", { orderId: token.order_id, productId: token.product_id });
    return errorPage(500, "Falha temporária", "Não foi possível abrir o arquivo. Tente novamente em instantes.");
  }

  await admin.from("digital_download_events").insert({
    token_id: token.id,
    order_id: token.order_id,
    product_id: token.product_id,
    event_type: "download",
  });

  return new Response(null, {
    status: 302,
    headers: {
      Location: signed.signedUrl,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
