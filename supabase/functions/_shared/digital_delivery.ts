/**
 * Orquestração da entrega digital pós-pagamento.
 *
 * Regras:
 *   - chamada somente depois de applyOfficialSnapshot() confirmar o pagamento
 *     na API oficial do provedor;
 *   - UM único e-mail de compra confirmada por pedido (reserva atômica no banco);
 *   - reenvio usa exatamente o mesmo conteúdo/link, sem criar token novo;
 *   - "novo link" revoga os anteriores e gera um novo token;
 *   - o token bruto nunca fica em coluna isolada: só o hash é usado na consulta
 *     e o conteúdo do e-mail é guardado criptografado para permitir reenvio;
 *   - falha de entrega NUNCA altera o resultado financeiro do webhook.
 */
import { adminClient, getCatalog } from "./payments/db.ts";
import { decryptSecret, encryptSecret, randomToken, sha256Hex } from "./payments/crypto.ts";
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
  type DeliveryEmailItem,
} from "./digital_delivery_pure.ts";

const SIGNED_URL_SECONDS = 300;
/** tempo máximo de uma reserva antes de ser considerada abandonada */
const EMAIL_LOCK_SECONDS = 120;
/** janela que impede dois cliques rápidos de gerarem dois envios */
const RESEND_COOLDOWN_SECONDS = 5;

type ProductRow = {
  id: string;
  name: string;
  product_type: string | null;
  digital_file_path: string | null;
  digital_delivery_mode: string | null;
  digital_external_url: string | null;
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

type SendResult = { ok: boolean; messageId?: string; error?: string };

type EmailLink = {
  deliveryId: string;
  tokenId: string;
  rawToken: string;
  expiresAt: string;
  productName: string;
  instructions: string | null;
  kind: "file" | "link";
};

type EmailBundle = {
  subject: string;
  html: string;
  text: string;
  links: EmailLink[];
};

export type DeliveryOutcome = {
  ok: boolean;
  delivered: number;
  skipped: number;
  failed: number;
  reason?: string;
  message?: string;
  messageId?: string;
};

function log(message: string, extra?: unknown): void {
  console.log(`[digital-delivery] ${message}`, extra ?? "");
}

function failed(reason: string, message?: string): DeliveryOutcome {
  return { ok: false, delivered: 0, skipped: 0, failed: 0, reason, message };
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
}): Promise<SendResult> {
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
      // Nunca imprime o corpo nem o header "api-key".
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
}): Promise<{ raw: string; id: string; expiresAt: string }> {
  const admin = adminClient();
  const rawToken = randomToken(32);
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + input.ttlMinutes * 60_000).toISOString();
  const { data, error } = await admin
    .from("digital_download_tokens")
    .insert({
      delivery_id: input.deliveryId,
      order_id: input.orderId,
      catalog_id: input.catalogId,
      product_id: input.productId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      max_uses: input.maxUses,
    })
    .select("id, expires_at")
    .single();
  if (error) throw error;
  return { raw: rawToken, id: data.id, expiresAt: data.expires_at };
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

/* ── E-mail único por pedido: reserva atômica + conteúdo reutilizável ─────── */

async function ensureEmailRow(orderId: string, catalogId: string): Promise<boolean> {
  const { error } = await adminClient()
    .from("digital_order_emails")
    .upsert({ order_id: orderId, catalog_id: catalogId }, { onConflict: "order_id", ignoreDuplicates: true });
  if (error) log("falha ao preparar registro de e-mail", { erro: safeError(error) });
  return !error;
}

/** `true` apenas para a chamada que conseguiu a reserva atômica do envio. */
async function claimEmailSlot(
  orderId: string,
  allowedStatuses: string[],
  cooldownSeconds: number,
): Promise<boolean> {
  const { data, error } = await adminClient().rpc("claim_digital_order_email", {
    p_order_id: orderId,
    p_allowed_statuses: allowedStatuses,
    p_lock_seconds: EMAIL_LOCK_SECONDS,
    p_cooldown_seconds: cooldownSeconds,
  });
  if (error) {
    log("falha ao reservar envio de e-mail", { erro: safeError(error) });
    return false;
  }
  return data === true;
}

async function readEmailBundle(
  orderId: string,
): Promise<{ cipher: string | null; bundle: EmailBundle | null }> {
  const { data } = await adminClient()
    .from("digital_order_emails")
    .select("email_bundle_cipher")
    .eq("order_id", orderId)
    .maybeSingle();
  const cipher = String((data as Record<string, unknown> | null)?.email_bundle_cipher ?? "") || null;
  if (!cipher) return { cipher: null, bundle: null };
  const plain = await decryptSecret(cipher);
  if (!plain) return { cipher, bundle: null };
  try {
    return { cipher, bundle: JSON.parse(plain) as EmailBundle };
  } catch {
    return { cipher, bundle: null };
  }
}

/** Finaliza a reserva: incrementa tentativas, grava resultado e libera o lock. */
async function finishEmail(
  orderId: string,
  sent: SendResult,
  bundle: EmailBundle | null,
): Promise<void> {
  const cipher = bundle ? await encryptSecret(JSON.stringify(bundle)) : null;
  const { error } = await adminClient().rpc("finish_digital_order_email", {
    p_order_id: orderId,
    p_ok: sent.ok,
    p_message_id: sent.ok ? sent.messageId ?? null : null,
    p_error: sent.ok ? null : safeError(sent.error),
    p_bundle_cipher: cipher,
  });
  if (error) log("falha ao registrar resultado do e-mail", { erro: safeError(error) });
}

async function isLinkValid(link: EmailLink): Promise<boolean> {
  const admin = adminClient();
  const { data: token } = await admin
    .from("digital_download_tokens")
    .select("id, expires_at, max_uses, used_count, revoked_at, delivery_id")
    .eq("id", link.tokenId)
    .maybeSingle();
  if (!token || token.revoked_at || String(token.expires_at) <= new Date().toISOString()) return false;
  if (Number(token.used_count) >= Number(token.max_uses)) return false;
  const { data: delivery } = await admin
    .from("digital_deliveries")
    .select("status, revoked_at")
    .eq("id", token.delivery_id)
    .maybeSingle();
  if (!delivery || delivery.revoked_at || delivery.status === "revoked") return false;
  return true;
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function supportLink(catalog: { slug?: string } | null): string | null {
  if (!catalog?.slug) return null;
  const base = Deno.env.get("VITRINE_URL")?.replace(/\/+$/, "") ?? "";
  const link = `${base}/c/${catalog.slug}`;
  return /^https?:\/\//.test(link) ? link : null;
}

/** Recria o conteúdo usando OS MESMOS tokens, descartando apenas links inválidos. */
async function rebuildBundleForLinks(
  functionBase: string,
  orderId: string,
  links: EmailLink[],
): Promise<EmailBundle | null> {
  const admin = adminClient();
  const { data: order } = await admin
    .from("orders")
    .select("customer_name, catalog_id, total, currency, created_at")
    .eq("id", orderId)
    .maybeSingle();
  const row = order as Record<string, unknown> | null;
  const catalog = await getCatalog(String(row?.catalog_id ?? ""));
  const message = buildDeliveryEmail({
    storeName: catalog?.store_name ?? "Vitrine Criativa",
    customerName: String(row?.customer_name ?? "cliente"),
    orderTotal: row?.total as string | number | null | undefined,
    currency: row?.currency as string | null | undefined,
    purchasedAt: row?.created_at as string | null | undefined,
    items: links.map((link) => ({
      productName: link.productName,
      downloadUrl: buildDownloadUrl(functionBase, link.rawToken),
      instructions: link.instructions,
      expiresAt: link.expiresAt,
      kind: link.kind,
    })),
    supportUrl: supportLink(catalog),
  });
  return { subject: message.subject, html: message.html, text: message.text, links };
}

/**
 * Dispara a confirmação de compra. `force` é usado apenas por ações explícitas
 * do vendedor ("novo link"), nunca pelo fluxo automático.
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
    .select("id, catalog_id, customer_name, customer_email, payment_status, items, total, currency, created_at")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order) {
    return { ...outcome, ok: false, reason: "order_not_found" };
  }

  const record = order as Record<string, unknown>;
  const effectiveStatus = options.paymentStatus ?? String(record.payment_status ?? "");
  if (!isPaidPaymentStatus(effectiveStatus)) {
    return { ...outcome, skipped: 1, reason: "payment_not_approved" };
  }

  const customerEmail = normalizeEmail(String(record.customer_email ?? ""));
  if (!customerEmail) return { ...outcome, skipped: 1, reason: "customer_email_missing" };

  const rawItems = record.items;
  const items = Array.isArray(rawItems) ? (rawItems as Array<Record<string, unknown>>) : [];
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
      "id,name,product_type,digital_file_path,digital_delivery_mode,digital_external_url,digital_instructions,digital_link_ttl_minutes,digital_max_downloads",
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

  const catalog = await getCatalog(String(record.catalog_id ?? ""));
  const cfg = config();
  if (!cfg) {
    log("Brevo não configurado", { orderId, products: digitalProducts.length });
    return { ...outcome, ok: false, reason: "brevo_not_configured" };
  }

  const catalogId = String(record.catalog_id ?? "");
  if (!(await ensureEmailRow(orderId, catalogId))) {
    return { ...outcome, ok: false, reason: "email_slot_failed" };
  }
  // Apenas a reserva inicial tem permissão para enviar: uma compra = um e-mail.
  if (!(await claimEmailSlot(orderId, ["pending"], 0))) {
    return { ...outcome, skipped: 1, reason: "confirmation_already_sent" };
  }

  try {
    const links: EmailLink[] = [];
    const emailItems: DeliveryEmailItem[] = [];
    const createdDeliveries: DeliveryRow[] = [];

    for (const product of digitalProducts) {
      const emailLabel = safeError(product.name);
      try {
        const isExternalLink = product.digital_delivery_mode === "link";
        const externalUrl = isExternalLink ? String(product.digital_external_url ?? "").trim() : "";
        if (isExternalLink && !isHttpsUrl(externalUrl)) {
          outcome.failed++;
          log("produto digital com link externo inválido", { orderId, productId: product.id });
          continue;
        }
        if (!isExternalLink && !product.digital_file_path) {
          outcome.failed++;
          log("produto digital sem arquivo", { orderId, productId: product.id });
          continue;
        }

        const upsert = await admin
          .from("digital_deliveries")
          .upsert(
            {
              order_id: orderId,
              catalog_id: catalogId,
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

        const token = await createDownloadToken({
          deliveryId: delivery.id,
          orderId,
          catalogId,
          productId: product.id,
          ttlMinutes: clampInteger(product.digital_link_ttl_minutes, 5, 10080, 1440),
          maxUses: clampInteger(product.digital_max_downloads, 1, 100, 5),
        });
        const downloadUrl = buildDownloadUrl(cfg.functionBase, token.raw);
        createdDeliveries.push(delivery);
        links.push({
          deliveryId: delivery.id,
          tokenId: token.id,
          rawToken: token.raw,
          expiresAt: token.expiresAt,
          productName: product.name,
          instructions: product.digital_instructions,
          kind: isExternalLink ? "link" : "file",
        });
        emailItems.push({
          productName: product.name,
          downloadUrl,
          instructions: product.digital_instructions,
          expiresAt: token.expiresAt,
          kind: isExternalLink ? "link" : "file",
        });
      } catch (error) {
        outcome.failed++;
        log("erro ao preparar link", { orderId, produto: safeError(error) });
      }
    }

    if (!links.length) {
      outcome.failed = Math.max(outcome.failed, 1);
      await finishEmail(orderId, { ok: false, error: "no_links" }, null);
      return { ...outcome, reason: "no_links" };
    }

    const message = buildDeliveryEmail({
      storeName: catalog?.store_name ?? "Vitrine Criativa",
      customerName: String(record.customer_name ?? "cliente"),
      orderTotal: record.total as string | number | null | undefined,
      currency: record.currency as string | null | undefined,
      purchasedAt: record.created_at as string | null | undefined,
      items: emailItems,
      supportUrl: supportLink(catalog),
    });

    // Um único disparo para o pedido inteiro, com todos os links no corpo.
    const sent = await sendViaBrevo({
      apiKey: cfg.apiKey,
      senderEmail: cfg.senderEmail,
      senderName: cfg.senderName,
      to: customerEmail,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    for (const delivery of createdDeliveries) {
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
        log("falha ao registrar resultado da entrega", { orderId, productId: delivery.product_id });
      }
    }

    await finishEmail(orderId, sent, {
      subject: message.subject,
      html: message.html,
      text: message.text,
      links,
    });

    if (sent.ok) {
      outcome.delivered = 1;
      if (sent.messageId) outcome.messageId = sent.messageId;
      log("e-mail de compra confirmada aceito pelo Brevo", {
        orderId,
        produtos: links.length,
      });
    } else {
      outcome.failed++;
      log("envio falhou", { orderId, erro: safeError(sent.error) });
    }
  } catch (error) {
    await finishEmail(orderId, { ok: false, error: safeError(error) }, null);
    outcome.failed++;
    log("erro inesperado na entrega", { orderId, erro: safeError(error) });
  }

  return outcome;
}

/**
 * Reenvio solicitado: reutiliza o MESMO conteúdo e os MESMOS links enquanto
 * forem válidos. Nunca cria token, pedido, cobrança ou entrega nova.
 */
export async function retryDelivery(deliveryId: string): Promise<DeliveryOutcome> {
  const admin = adminClient();
  const { data: delivery } = await admin
    .from("digital_deliveries")
    .select("id, order_id, customer_email")
    .eq("id", deliveryId)
    .maybeSingle();
  if (!delivery) return failed("not_found", "Entrega não encontrada.");

  const { data: order } = await admin
    .from("orders")
    .select("payment_status")
    .eq("id", delivery.order_id)
    .maybeSingle();
  if (isBlockedPaymentStatus(String((order as Record<string, unknown> | null)?.payment_status ?? ""))) {
    return failed("payment_blocked", "Este pedido não permite reenvio.");
  }

  const cfg = config();
  if (!cfg) return failed("brevo_not_configured", "Envio de e-mail não configurado.");

  const { bundle } = await readEmailBundle(delivery.order_id);
  if (!bundle) {
    return failed("no_confirmation_email", "Não há e-mail de confirmação registrado para este pedido.");
  }
  // A validade exigida é a da entrega clicada — não basta outro produto estar válido.
  const clicked = bundle.links.find((link) => link.deliveryId === deliveryId);
  if (!clicked || !(await isLinkValid(clicked))) {
    return failed(
      "link_expired_need_new",
      "O link expirou ou foi revogado. Gere um novo link para reenviar.",
    );
  }
  const validLinks: EmailLink[] = [];
  for (const link of bundle.links) {
    if (await isLinkValid(link)) validLinks.push(link);
  }
  // Reutiliza os mesmos tokens; se algum outro link expirou, apenas o remove do texto.
  const reusable =
    validLinks.length === bundle.links.length
      ? bundle
      : await rebuildBundleForLinks(cfg.functionBase, delivery.order_id, validLinks);
  if (!reusable) return failed("internal_error", "Não foi possível preparar o reenvio.");

  if (!(await claimEmailSlot(delivery.order_id, ["sent", "failed"], RESEND_COOLDOWN_SECONDS))) {
    return failed(
      "send_in_progress_or_recent",
      "Um envio já está em andamento ou foi feito agora. Aguarde alguns segundos antes de reenviar.",
    );
  }

  const sent = await sendViaBrevo({
    apiKey: cfg.apiKey,
    senderEmail: cfg.senderEmail,
    senderName: cfg.senderName,
    to: normalizeEmail(String(delivery.customer_email ?? "")),
    subject: reusable.subject,
    html: reusable.html,
    text: reusable.text,
  });
  await finishEmail(
    delivery.order_id,
    sent,
    reusable === bundle ? null : reusable,
  );

  log("reenvio concluído", {
    orderId: delivery.order_id,
    linksReutilizados: validLinks.length,
    aceito: sent.ok,
  });
  return {
    ok: sent.ok,
    delivered: sent.ok ? 1 : 0,
    skipped: 0,
    failed: sent.ok ? 0 : 1,
    reason: sent.ok ? undefined : safeError(sent.error),
    message: sent.ok ? undefined : "Não foi possível reenviar. Tente novamente em instantes.",
    messageId: sent.ok ? sent.messageId ?? undefined : undefined,
  };
}

/**
 * "Novo link": revoga os links anteriores da entrega, cria um token novo e
 * envia UM e-mail com os links ainda válidos + o novo. Pedido/cobrança intactos.
 */
export async function regenerateDelivery(deliveryId: string): Promise<DeliveryOutcome> {
  const admin = adminClient();
  const { data: delivery } = await admin
    .from("digital_deliveries")
    .select("id, order_id, catalog_id, product_id, customer_email, attempts")
    .eq("id", deliveryId)
    .maybeSingle();
  if (!delivery) return failed("not_found", "Entrega não encontrada.");

  const { data: regenOrder } = await admin
    .from("orders")
    .select("customer_name, total, currency, created_at")
    .eq("id", delivery.order_id)
    .maybeSingle();

  const cfg = config();
  if (!cfg) return failed("brevo_not_configured", "Envio de e-mail não configurado.");

  if (!(await claimEmailSlot(delivery.order_id, ["sent", "failed"], RESEND_COOLDOWN_SECONDS))) {
    return failed(
      "send_in_progress_or_recent",
      "Um envio já está em andamento ou foi feito agora. Aguarde alguns segundos.",
    );
  }

  try {
    await revokeTokensForDelivery(deliveryId);

    const { data: product } = await admin
      .from("products")
      .select(
        "id,name,digital_file_path,digital_delivery_mode,digital_external_url,digital_instructions,digital_link_ttl_minutes,digital_max_downloads",
      )
      .eq("id", delivery.product_id)
      .maybeSingle();
    const productRow = product as ProductRow | null;
    const regenIsLink = productRow?.digital_delivery_mode === "link";
    const regenExternalUrl = regenIsLink ? String(productRow?.digital_external_url ?? "").trim() : "";
    if (regenIsLink && !isHttpsUrl(regenExternalUrl)) {
      await finishEmail(delivery.order_id, { ok: false, error: "no_link" }, null);
      return failed("no_link", "O link deste produto não está mais disponível.");
    }
    if (!regenIsLink && !productRow?.digital_file_path) {
      await finishEmail(delivery.order_id, { ok: false, error: "no_file" }, null);
      return failed("no_file", "O arquivo deste produto não está mais disponível.");
    }

    const { bundle } = await readEmailBundle(delivery.order_id);
    const kept: EmailLink[] = [];
    for (const link of bundle?.links ?? []) {
      if (link.deliveryId === deliveryId) continue;
      if (await isLinkValid(link)) kept.push(link);
    }

    const token = await createDownloadToken({
      deliveryId: delivery.id,
      orderId: delivery.order_id,
      catalogId: delivery.catalog_id,
      productId: delivery.product_id,
      ttlMinutes: clampInteger(productRow.digital_link_ttl_minutes, 5, 10080, 1440),
      maxUses: clampInteger(productRow.digital_max_downloads, 1, 100, 5),
    });
    const newLink: EmailLink = {
      deliveryId: delivery.id,
      tokenId: token.id,
      rawToken: token.raw,
      expiresAt: token.expiresAt,
      productName: productRow.name,
      instructions: productRow.digital_instructions,
      kind: regenIsLink ? "link" : "file",
    };
    const links = [...kept, newLink];
    const catalog = await getCatalog(delivery.catalog_id);
    const regenRow = regenOrder as Record<string, unknown> | null;
    const message = buildDeliveryEmail({
      storeName: catalog?.store_name ?? "Vitrine Criativa",
      customerName: String(regenRow?.customer_name ?? "cliente"),
      orderTotal: regenRow?.total as string | number | null | undefined,
      currency: regenRow?.currency as string | null | undefined,
      purchasedAt: regenRow?.created_at as string | null | undefined,
      items: links.map((link) => ({
        productName: link.productName,
        downloadUrl: buildDownloadUrl(cfg.functionBase, link.rawToken),
        instructions: link.instructions,
        expiresAt: link.expiresAt,
        kind: link.kind,
      })),
      supportUrl: supportLink(catalog),
    });

    const sent = await sendViaBrevo({
      apiKey: cfg.apiKey,
      senderEmail: cfg.senderEmail,
      senderName: cfg.senderName,
      to: normalizeEmail(String(delivery.customer_email ?? "")),
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    await admin
      .from("digital_deliveries")
      .update({
        status: sent.ok ? "sent" : "failed",
        attempts: Number((delivery as Record<string, unknown>).attempts ?? 0) + 1,
        sent_at: sent.ok ? new Date().toISOString() : null,
        provider_message_id: sent.ok ? sent.messageId ?? null : null,
        last_error: sent.ok ? null : safeError(sent.error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", delivery.id);

    await finishEmail(delivery.order_id, sent, {
      subject: message.subject,
      html: message.html,
      text: message.text,
      links,
    });

    return {
      ok: sent.ok,
      delivered: sent.ok ? 1 : 0,
      skipped: 0,
      failed: sent.ok ? 0 : 1,
      reason: sent.ok ? undefined : safeError(sent.error),
      messageId: sent.ok ? sent.messageId ?? undefined : undefined,
    };
  } catch (error) {
    await finishEmail(delivery.order_id, { ok: false, error: safeError(error) }, null);
    return failed("internal_error", "Não foi possível gerar o novo link.");
  }
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
    .select("digital_file_path, digital_delivery_mode, digital_external_url")
    .eq("id", token.product_id)
    .maybeSingle();
  const productRow = product as Record<string, unknown> | null;
  const isExternalLink = String(productRow?.digital_delivery_mode ?? "") === "link";
  const externalUrl = String(productRow?.digital_external_url ?? "").trim();

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

  if (isExternalLink) {
    if (!isHttpsUrl(externalUrl)) {
      return errorPage(404, "Link indisponível", "O link deste produto não está disponível.");
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
        Location: externalUrl,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const path = String(productRow?.digital_file_path ?? "");
  if (!path) return errorPage(404, "Arquivo indisponível", "O arquivo deste produto não está disponível.");

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
