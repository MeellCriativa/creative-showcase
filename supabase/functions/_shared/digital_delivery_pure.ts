/**
 * Regras puras da entrega digital — sem dependências de runtime (Deno/Supabase).
 * Este arquivo é importado tanto pela Edge Function quanto pelos testes Node.
 */

export const DIGITAL_BUCKET = "digital-products";
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Status em que a entrega é liberada. "authorized" (PayPal) ainda não é captura. */
export const PAID_PAYMENT_STATUSES = new Set(["approved", "captured"]);

/** Status em que nenhuma entrega nova pode começar e links devem ser revogados. */
export const BLOCKED_PAYMENT_STATUSES = new Set([
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
  "disputed",
]);

/** Evita SVG/HTML/JS: arquivos servidos pelo Storage podem ser abertos no navegador. */
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "audio/mpeg",
  "audio/mp4",
]);

export const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "zip",
  "7z",
  "rar",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "mp4",
  "mp3",
  "m4a",
]);

export function isPaidPaymentStatus(status: unknown): boolean {
  return typeof status === "string" && PAID_PAYMENT_STATUSES.has(status.toLowerCase());
}

export function isBlockedPaymentStatus(status: unknown): boolean {
  return typeof status === "string" && BLOCKED_PAYMENT_STATUSES.has(status.toLowerCase());
}

export function normalizeEmail(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  if (email.length < 6 || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const [local, domain, ...rest] = email.split("@");
  if (!local || !domain || rest.length > 0) return false;
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes(".."))
    return false;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local);
}

export function fileExtension(fileName: string): string {
  const name = String(fileName ?? "");
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function validateDigitalFile(input: {
  fileName: string;
  mimeType: string;
  size: number;
}): { valid: boolean; reason?: string } {
  const ext = fileExtension(input.fileName);
  const mime = String(input.mimeType ?? "").toLowerCase().split(";")[0]!.trim();
  const size = Number(input.size);
  if (!ext || !ALLOWED_EXTENSIONS.has(ext)) return { valid: false, reason: "EXTENSAO_NAO_PERMITIDA" };
  if (!ALLOWED_MIME_TYPES.has(mime)) return { valid: false, reason: "MIME_NAO_PERMITIDO" };
  if (!Number.isFinite(size) || size <= 0) return { valid: false, reason: "TAMANHO_INVALIDO" };
  if (size > MAX_FILE_BYTES) return { valid: false, reason: "ARQUIVO_GRANDE_DEMAIS" };
  return { valid: true };
}

/** Remove PII/tokens de mensagens antes de gravar em log ou no banco. */
export function safeError(value: unknown): string {
  let text = String(value ?? "")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[token]")
    .replace(/\+\d[\d\s()-]{7,}/g, "[telefone]");
  if (text.length > 240) text = text.slice(0, 240) + "…";
  return text || "erro_desconhecido";
}

export function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function buildDownloadUrl(functionBase: string, token: string): string {
  const base = String(functionBase ?? "").replace(/\/+$/, "");
  return `${base}/digital-delivery?action=download&token=${encodeURIComponent(token)}`;
}

/** Corpo oficial da API transacional do Brevo (POST /v3/smtp/email). */
export function buildBrevoEmailPayload(input: {
  senderName: string;
  senderEmail: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}): Record<string, unknown> {
  return {
    sender: { name: input.senderName, email: input.senderEmail },
    to: [{ email: input.to }],
    subject: input.subject,
    htmlContent: input.html,
    textContent: input.text,
  };
}

/** Classifica falhas HTTP do Brevo sem expor corpo, header ou credenciais. */
export function brevoFailureReason(status: number): string {
  if (status === 401 || status === 403) return "brevo_auth_failed";
  if (status === 429) return "brevo_rate_limited";
  if (status >= 500) return "brevo_server_error";
  return `brevo_http_${status}`;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type DeliveryEmailItem = {
  productName: string;
  /** URL sempre tokenizada — nunca a URL externa bruta do produto. */
  downloadUrl: string;
  instructions?: string | null;
  expiresAt?: string | null;
  kind?: "file" | "link";
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

function formatMoney(value: string | number | null | undefined, currency?: string | null): string | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  const code = (currency || "BRL").toUpperCase();
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: code }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`.trim();
  }
}

/**
 * E-mail ÚNICO de compra confirmada. Aceita vários produtos — cada um com seu
 * link — para que uma compra com itens digitais jamais gere vários e-mails.
 * A assinatura antiga (productName/downloadUrl) continua funcionando.
 */
export function buildDeliveryEmail(input: {
  storeName: string;
  customerName: string;
  productName?: string;
  downloadUrl?: string;
  instructions?: string | null;
  expiresAt?: string | null;
  items?: DeliveryEmailItem[];
  supportUrl?: string | null;
  orderTotal?: string | number | null;
  currency?: string | null;
  purchasedAt?: string | null;
}): { subject: string; html: string; text: string } {
  const store = escapeHtml(input.storeName || "Vitrine Criativa");
  const customerName = input.customerName || "cliente";
  const customer = escapeHtml(customerName);
  const items: DeliveryEmailItem[] = input.items?.length
    ? input.items
    : input.downloadUrl
      ? [{
          productName: input.productName || "produto digital",
          downloadUrl: input.downloadUrl,
          instructions: input.instructions,
          expiresAt: input.expiresAt,
        }]
      : [];

  const blocks = items
    .map((item, index) => {
      const product = escapeHtml(item.productName || "produto digital");
      const htmlUrl = escapeHtml(String(item.downloadUrl ?? ""));
      const expiry = formatDate(item.expiresAt);
      const isLink = item.kind === "link";
      const actionLabel = isLink ? "Acessar produto" : "Baixar arquivo";
      const label = items.length > 1 ? `${index + 1}. ${product}` : product;
      const instructions = item.instructions?.trim()
        ? `<div style="margin-top:10px;padding:12px 14px;border-radius:10px;background:#f7f4fd;color:#4b3f63;font-size:13px;line-height:1.6"><strong>Orientações da loja:</strong><br>${escapeHtml(item.instructions).replace(/\n/g, "<br>")}</div>`
        : "";
      return `<div style="margin:0 0 24px;padding-bottom:20px;border-bottom:1px solid #eee9f5">
          <p style="margin:0 0 10px;font-size:15px;line-height:1.6">${isLink ? "Acesse" : "Baixe o arquivo de"} <strong>${label}</strong>:</p>
          <div style="text-align:center;margin:14px 0">
            <a href="${htmlUrl}" style="display:inline-block;background:#8b5cf6;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 24px;border-radius:12px">${actionLabel}</a>
          </div>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#6d657c">Se o botão não funcionar, copie e cole este link no navegador:<br><a href="${htmlUrl}" style="color:#8b5cf6;word-break:break-all">${htmlUrl}</a></p>
          ${expiry ? `<p style="margin:10px 0 0;font-size:12px;color:#6d657c">Válido até <strong>${escapeHtml(expiry)}</strong>.</p>` : ""}
          ${instructions}
        </div>`;
    })
    .join("");

  const support = input.supportUrl
    ? `<p style="margin:16px 0 0;text-align:center;font-size:12px;color:#8b839a">Precisa de ajuda? <a href="${escapeHtml(input.supportUrl)}" style="color:#8b5cf6">Fale com a loja</a>.</p>`
    : `<p style="margin:16px 0 0;text-align:center;font-size:12px;color:#8b839a">Precisa de ajuda? Responda a este e-mail.</p>`;

  const purchasedAt = formatDate(input.purchasedAt);
  const total = formatMoney(input.orderTotal, input.currency);
  const summaryRows = [
    `<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#4b3f63"><strong>Cliente:</strong> ${customer}</p>`,
    purchasedAt
      ? `<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#4b3f63"><strong>Data da compra:</strong> ${escapeHtml(purchasedAt)}</p>`
      : "",
    total
      ? `<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#4b3f63"><strong>Valor da compra:</strong> ${escapeHtml(total)}</p>`
      : "",
    `<p style="margin:0;font-size:13px;line-height:1.6;color:#4b3f63"><strong>Loja:</strong> ${store}</p>`,
  ].filter(Boolean).join("");
  const summary = `<div style="margin:0 0 22px;padding:14px 16px;border-radius:12px;background:#faf9fd;border:1px solid #eee9f5">${summaryRows}</div>`;

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Compra confirmada</title></head>
<body style="margin:0;padding:0;background:#f6f4fa;font-family:Arial,Helvetica,sans-serif;color:#2f2a3a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4fa;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 28px rgba(80,50,140,.08)">
        <tr><td style="background:#8b5cf6;padding:26px 28px;color:#ffffff">
          <p style="margin:0;font-size:20px;font-weight:bold;letter-spacing:-.3px">Vitrine Criativa</p>
          <p style="margin:4px 0 0;font-size:12px;opacity:.9">Compra confirmada</p>
        </td></tr>
        <tr><td style="padding:30px 28px 8px">
          <p style="margin:0 0 16px;font-size:16px">Olá, <strong>${customer}</strong>!</p>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.6">Sua compra foi <strong>aprovada</strong>${items.length ? " e seus arquivos digitais estão prontos para download" : ""}.</p>
          ${summary}
          ${blocks}
          <p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:#6d657c">Os links são pessoais, temporários e possuem limite de downloads. Guarde este e-mail até concluir. Não o compartilhe.</p>
          <p style="margin:14px 0 0;font-size:13px;color:#6d657c">Obrigado por comprar na <strong>${store}</strong>!</p>
          ${support}
        </td></tr>
        <tr><td style="padding:18px 28px;background:#faf9fd;text-align:center;font-size:11px;color:#9a93a8">Mensagem automática da Vitrine Criativa · Não responda com dados de pagamento.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const textLines = [
    `Vitrine Criativa - ${input.storeName || "Vitrine Criativa"}`,
    "",
    `Olá, ${customerName}!`,
    "Sua compra foi aprovada e seus arquivos digitais estão prontos para download.",
    "",
    `Cliente: ${customerName}`,
    `Loja: ${input.storeName || "Vitrine Criativa"}`,
  ];
  if (purchasedAt) textLines.push(`Data da compra: ${purchasedAt}`);
  if (total) textLines.push(`Valor da compra: ${total}`);
  textLines.push("");
  items.forEach((item, index) => {
    const expiry = formatDate(item.expiresAt);
    textLines.push(`${items.length > 1 ? `${index + 1}. ` : ""}Produto: ${item.productName || "produto digital"}`);
    textLines.push(`${item.kind === "link" ? "Acesse seu produto" : "Baixe seu arquivo"}: ${item.downloadUrl}`);
    if (expiry) textLines.push(`Válido até: ${expiry}`);
    if (item.instructions?.trim()) textLines.push(`Orientações: ${item.instructions.trim()}`);
    textLines.push("");
  });
  textLines.push("Os links são pessoais, temporários e possuem limite de downloads. Não compartilhe.");
  const text = textLines.join("\n");

  const subject = items.length > 1
    ? `Compra confirmada: ${items.length} produtos digitais`
    : `Compra confirmada: ${items[0]?.productName || "produto digital"}`;

  return { subject, html, text };
}
