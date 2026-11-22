import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  brevoFailureReason,
  buildBrevoEmailPayload,
  DIGITAL_BUCKET,
  MAX_FILE_BYTES,
  PAID_PAYMENT_STATUSES,
  BLOCKED_PAYMENT_STATUSES,
  buildDeliveryEmail,
  buildDownloadUrl,
  clampInteger,
  fileExtension,
  isBlockedPaymentStatus,
  isPaidPaymentStatus,
  isValidEmail,
  normalizeEmail,
  safeError,
  validateDigitalFile,
} from "../supabase/functions/_shared/digital_delivery_pure.ts";

/**
 * Entrega digital — testes de regra e de integração estática.
 *
 * SIMULADO: validações puras, construção de e-mail/URL, payload/classificação
 * de erros do Brevo, limites e contrato de código (migração + hook + revogação).
 * Nenhum teste aqui afirma envio real.
 * REAL (pendente): recebimento via Brevo e download pelo link do e-mail exigem
 * BREVO_API_KEY/BREVO_SENDER_EMAIL/BREVO_SENDER_NAME em homologação + acesso
 * à caixa do comprador.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("bucket é privado e limitado a 50 MB", () => {
  assert.equal(DIGITAL_BUCKET, "digital-products");
  assert.equal(MAX_FILE_BYTES, 50 * 1024 * 1024);
  const migration = read("supabase/migrations/20261121120000_digital_delivery.sql");
  assert.match(migration, /public = false/);
  assert.doesNotMatch(migration, /to anon/i);
  assert.doesNotMatch(migration, /to public/i);
});

test("validação de arquivo aceita formatos não-PDF e rejeita HTML/JS", () => {
  assert.equal(fileExtension("Plano DE Ação.ZIP"), "zip");
  assert.equal(
    validateDigitalFile({ fileName: "plano.pdf", mimeType: "application/pdf", size: 1024 }).valid,
    true,
  );
  assert.equal(
    validateDigitalFile({ fileName: "aula.mp4", mimeType: "video/mp4", size: 2048 }).valid,
    true,
  );
  assert.equal(
    validateDigitalFile({ fileName: "x.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10 }).valid,
    true,
  );
  assert.equal(validateDigitalFile({ fileName: "x.html", mimeType: "text/html", size: 10 }).reason, "EXTENSAO_NAO_PERMITIDA");
  assert.equal(validateDigitalFile({ fileName: "x.svg", mimeType: "image/svg+xml", size: 10 }).reason, "EXTENSAO_NAO_PERMITIDA");
  assert.equal(validateDigitalFile({ fileName: "x.pdf", mimeType: "application/pdf", size: 0 }).reason, "TAMANHO_INVALIDO");
  assert.equal(validateDigitalFile({ fileName: "x.pdf", mimeType: "application/pdf", size: MAX_FILE_BYTES + 1 }).reason, "ARQUIVO_GRANDE_DEMAIS");
  assert.ok(ALLOWED_EXTENSIONS.has("zip") && ALLOWED_EXTENSIONS.has("mp3"));
  assert.ok(!ALLOWED_MIME_TYPES.has("text/html"));
});

test("e-mail do comprador é normalizado e validado", () => {
  assert.equal(normalizeEmail("  Maria.Silva@Example.COM "), "maria.silva@example.com");
  assert.equal(isValidEmail("maria.silva@example.com"), true);
  assert.equal(isValidEmail("maria@example"), false);
  assert.equal(isValidEmail("maria@@example.com"), false);
  assert.equal(isValidEmail(".maria@example.com"), false);
  assert.equal(isValidEmail("maria@ex..ample.com"), false);
  assert.equal(isValidEmail("maria comespaco@example.com"), false);
});

test("somente status pagos liberam entrega; reembolso/cancelamento bloqueiam", () => {
  assert.equal(isPaidPaymentStatus("approved"), true);
  assert.equal(isPaidPaymentStatus("captured"), true);
  assert.equal(isPaidPaymentStatus("authorized"), false);
  assert.equal(isPaidPaymentStatus("pending"), false);
  for (const status of ["failed", "cancelled", "refunded", "partially_refunded", "disputed"]) {
    assert.equal(isBlockedPaymentStatus(status), true);
    assert.equal(isPaidPaymentStatus(status), false);
  }
  assert.ok(PAID_PAYMENT_STATUSES.has("approved") && !PAID_PAYMENT_STATUSES.has("authorized"));
  assert.ok(BLOCKED_PAYMENT_STATUSES.has("refunded"));
});

test("download usa token opaco e URL da Edge Function (SIMULADO)", () => {
  const url = buildDownloadUrl("https://example.supabase.co/functions/v1/", "abc123");
  assert.equal(url, "https://example.supabase.co/functions/v1/digital-delivery?action=download&token=abc123");
  const migration = read("supabase/migrations/20261121120000_digital_delivery.sql");
  assert.match(migration, /token_hash text not null unique/);
  assert.doesNotMatch(migration, /token text not null/);
  const fn = read("supabase/functions/_shared/digital_delivery.ts");
  assert.match(fn, /sha256Hex\(rawToken\)/);
  assert.match(fn, /createSignedUrl\(path, SIGNED_URL_SECONDS\)/);
  assert.match(fn, /\.eq\("used_count", Number\(token\.used_count\)\)/);
  assert.match(fn, /isPaidPaymentStatus\(paymentStatus\)/);
});

test("limites configuráveis são clampados (SIMULADO)", () => {
  assert.equal(clampInteger("60", 5, 10080, 1440), 60);
  assert.equal(clampInteger(0, 5, 10080, 1440), 5);
  assert.equal(clampInteger(99999, 5, 10080, 1440), 10080);
  assert.equal(clampInteger("abc", 1, 100, 5), 5);
  assert.equal(clampInteger(2, 1, 100, 5), 2);
});

test("e-mail escapa conteúdo e não contém o token em texto claro", () => {
  const message = buildDeliveryEmail({
    storeName: "Loja <b>",
    customerName: "Maria & João",
    productName: "Apostila \"X\"",
    downloadUrl: "https://example/functions/v1/digital-delivery?action=download&token=SEGREDO123",
    instructions: "Use <script>alert(1)</script>\nE salve.",
  });
  assert.match(message.subject, /Apostila/);
  assert.ok(!message.html.includes("<b>"));
  assert.ok(!message.html.includes("<script>"));
  assert.match(message.html, /&lt;script&gt;/);
  assert.match(message.html, /Loja &lt;b&gt;/);
  assert.ok(message.html.includes("SEGREDO123")); // o link é o propósito do e-mail
  assert.match(message.text, /Orientações: Use <script>/); // texto simples não é HTML
});

test("payload do Brevo usa remetente, HTML e texto sem credenciais (SIMULADO)", () => {
  const payload = buildBrevoEmailPayload({
    senderName: "Loja Teste",
    senderEmail: "remetente@example.com",
    to: "compradora@example.com",
    subject: "Seu arquivo chegou",
    html: "<p>Baixe aqui</p>",
    text: "Baixe aqui",
  });
  assert.deepEqual(payload.sender, { name: "Loja Teste", email: "remetente@example.com" });
  assert.deepEqual(payload.to, [{ email: "compradora@example.com" }]);
  assert.equal(payload.subject, "Seu arquivo chegou");
  assert.equal(payload.htmlContent, "<p>Baixe aqui</p>");
  assert.equal(payload.textContent, "Baixe aqui");
  const serialized = JSON.stringify(payload);
  assert.ok(!/api-key|api[_-]?key|Bearer/i.test(serialized));
});

test("falhas HTTP do Brevo são classificadas sem expor credenciais (SIMULADO)", () => {
  assert.equal(brevoFailureReason(401), "brevo_auth_failed");
  assert.equal(brevoFailureReason(403), "brevo_auth_failed");
  assert.equal(brevoFailureReason(429), "brevo_rate_limited");
  assert.equal(brevoFailureReason(503), "brevo_server_error");
  assert.equal(brevoFailureReason(400), "brevo_http_400");
  for (const status of [400, 401, 403, 429, 503]) {
    assert.ok(!brevoFailureReason(status).includes("key"));
  }
});

test("logs e erros mascaram PII (SIMULADO)", () => {
  const masked = safeError("falha para maria@example.com em https://x.com/a?token=abcdef0123456789abcdef0123456789 +55 11 99999-9999");
  assert.ok(!masked.includes("maria@example.com"));
  assert.ok(!masked.includes("https://x.com"));
  assert.ok(!masked.includes("99999-9999"));
  assert.ok(masked.includes("[email]"));
});

test("hook de entrega fica após confirmação oficial e é best-effort", () => {
  const webhook = read("supabase/functions/_shared/payments/webhooks.ts");
  assert.match(webhook, /import \{ deliverDigitalOrder \} from "\.\.\/digital_delivery\.ts"/);
  const hook = webhook.indexOf("await deliverDigitalOrder");
  const sync = webhook.indexOf("syncOrderPayment(");
  assert.ok(hook > sync, "entrega deve vir depois de syncOrderPayment");
  assert.match(webhook, /try \{[\s\S]*await deliverDigitalOrder[\s\S]*\} catch/);

  const db = read("supabase/functions/_shared/payments/db.ts");
  assert.match(db, /isBlockedPaymentStatus\(input\.status\)/);
  assert.match(db, /digital_download_tokens[\s\S]*revoked_at/);
  assert.match(db, /digital_deliveries[\s\S]*revoked_at/);
});

test("idempotência e reprocessamento por canal (SIMULADO)", () => {
  const fn = read("supabase/functions/_shared/digital_delivery.ts");
  assert.match(fn, /onConflict: "order_id,product_id"/);
  assert.match(fn, /status === "sent" && !options\.force/);
  assert.match(fn, /onlyProductId/);
  assert.match(fn, /status: sent\.ok \? "sent" : "failed"/);
  assert.match(fn, /attempts: Number\(delivery\.attempts \?\? 0\) \+ 1/);
  assert.match(fn, /last_error: sent\.ok \? null : safeError\(sent\.error\)/);
  assert.match(fn, /brevo_not_configured/);
});

test("Brevo é o único provedor de e-mail no fluxo digital (SIMULADO)", () => {
  const fn = read("supabase/functions/_shared/digital_delivery.ts");
  assert.match(fn, /https:\/\/api\.brevo\.com\/v3\/smtp\/email/);
  assert.match(fn, /"api-key": input\.apiKey/);
  assert.match(fn, /BREVO_API_KEY/);
  assert.match(fn, /BREVO_SENDER_EMAIL/);
  assert.match(fn, /BREVO_SENDER_NAME/);
  assert.doesNotMatch(fn, /api\.resend\.com/);
  assert.doesNotMatch(fn, /RESEND_API_KEY/);
  assert.doesNotMatch(fn, /sendViaResend/);

  const webhook = read("supabase/functions/_shared/payments/webhooks.ts");
  assert.doesNotMatch(webhook, /falha do Resend/i);
});

test("checkout exige e-mail somente com produto digital e preserva fallback", () => {
  const checkout = read("src/routes/c.$slug.tsx");
  assert.match(checkout, /hasDigital/);
  assert.match(checkout, /emailMismatch/);
  assert.match(checkout, /customer_email: customerEmail\.trim\(\)\.toLowerCase\(\)/);
  assert.match(checkout, /product_id: i\.productId/);
  assert.match(checkout, /product_type: i\.product_type \?\? null/);

  const orders = read("supabase/functions/_shared/payments/orders.ts");
  assert.match(orders, /isValidEmail\(customerEmail\)/);
  assert.match(orders, /item\.product_type === "digital"/);

  const payments = read("supabase/functions/payments/index.ts");
  assert.match(payments, /customerEmail: \(ctx\.body\.customer_email as string\)/);
});

test("painel expõe data de aprovação oficial, status e tentativas", () => {
  const fn = read("supabase/functions/digital-delivery/index.ts");
  assert.match(fn, /payment_transactions/);
  assert.match(fn, /approved_at: tx\?\.last_event_at/);
  const panel = read("src/routes/painel.pedidos.tsx");
  assert.match(panel, /orders\.digital\.approvedAt/);
  assert.match(panel, /orders\.digital\.attempts/);
  assert.match(panel, /orders\.digital\.expiresAt/);
  assert.match(panel, /orders\.digital\.resend/);
  assert.match(panel, /orders\.digital\.revoke/);
});

test("resumo da compra traz cliente, data, valor e loja", () => {
  const message = buildDeliveryEmail({
    storeName: "Loja da Ana",
    customerName: "Maria & João",
    orderTotal: 123.4,
    currency: "BRL",
    purchasedAt: "2026-11-22T03:00:00Z",
    productName: "Apostila",
    downloadUrl: "https://exemplo/delivery?token=AAA",
  });
  assert.match(message.html, /<strong>Cliente:<\/strong> Maria &amp; João/);
  assert.match(message.html, /<strong>Data da compra:<\/strong>/);
  assert.match(message.html, /<strong>Valor da compra:<\/strong> R\$\s?123,40/);
  assert.match(message.html, /<strong>Loja:<\/strong> Loja da Ana/);
  assert.match(message.text, /Cliente: Maria & João/);
  assert.match(message.text, /Loja: Loja da Ana/);
  assert.match(message.text, /Valor da compra: R\$\s?123,40/);
});

test("um único e-mail de compra confirmada reúne todos os produtos e prazos", () => {
  const message = buildDeliveryEmail({
    storeName: "Loja Teste",
    customerName: "Maria",
    items: [
      {
        productName: "Apostila",
        downloadUrl: "https://exemplo/delivery?token=AAA",
        instructions: "Abra o PDF.",
        expiresAt: "2026-11-23T12:00:00Z",
      },
      {
        productName: "Vídeo",
        downloadUrl: "https://exemplo/delivery?token=BBB",
        expiresAt: "2026-11-24T12:00:00Z",
      },
    ],
  });
  assert.match(message.subject, /Compra confirmada: 2 produtos digitais/);
  assert.equal(message.html.match(/Baixar arquivo/g)?.length, 2);
  assert.ok(message.html.includes("Apostila") && message.html.includes("Vídeo"));
  assert.ok(message.html.includes("token=AAA") && message.html.includes("token=BBB"));
  assert.ok(message.html.includes("Válido até"));
  assert.ok(message.text.includes("Produto: Apostila") && message.text.includes("Produto: Vídeo"));
});

test("idempotência de e-mail usa reserva atômica, janela de cliques e bundle criptografado", () => {
  const migration = read(
    "supabase/migrations/20261122010000_digital_order_email_idempotency.sql",
  );
  assert.match(migration, /create table if not exists public\.digital_order_emails/);
  assert.match(migration, /create or replace function public\.claim_digital_order_email/);
  assert.match(migration, /create or replace function public\.finish_digital_order_email/);
  assert.match(migration, /p_lock_seconds/);
  assert.match(migration, /p_cooldown_seconds/);
  assert.match(migration, /email_bundle_cipher text/);
  assert.match(migration, /revoke all on public\.digital_order_emails from anon/);
  assert.match(migration, /for select to authenticated/);

  const fn = read("supabase/functions/_shared/digital_delivery.ts");
  assert.match(fn, /claimEmailSlot\(orderId, \["pending"\], 0\)/);
  assert.match(fn, /claimEmailSlot\(delivery\.order_id, \["sent", "failed"\], RESEND_COOLDOWN_SECONDS\)/);
  assert.match(fn, /encryptSecret\(JSON\.stringify\(bundle\)\)/);
  assert.match(fn, /link_expired_need_new/);
  assert.match(fn, /revokeTokensForDelivery\(deliveryId\)/);
  assert.match(fn, /bundle\.links\.find\(\(link\) => link\.deliveryId === deliveryId\)/);
  assert.match(fn, /rebuildBundleForLinks/);
});

test("RLS impede leitura anônima de entregas e tokens", () => {
  const migration = read("supabase/migrations/20261121120000_digital_delivery.sql");
  assert.match(migration, /revoke all on public\.digital_deliveries from anon/);
  assert.match(migration, /revoke all on public\.digital_download_tokens from anon/);
  assert.match(migration, /for select to authenticated/);
  assert.ok(!migration.includes("token_hash,") === false || /grant select \(id, delivery_id/.test(migration));
});
