/** Helpers puros das notificações de novo pedido (sem Deno, sem rede). */

export type SellerOrderEmailInput = {
  storeName: string;
  customerName: string;
  orderId: string;
  total: number;
  currency: string;
  paymentMethod: string | null;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  panelUrl: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Formatação simples e determinística (a moeda da loja é o rótulo oficial). */
export function formatSellerMoney(value: number, currency: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} ${currency || "BRL"}`;
  }
}

export function shortOrderId(orderId: string): string {
  return String(orderId ?? "").slice(0, 8).toUpperCase();
}

export function buildSellerOrderEmail(input: SellerOrderEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const store = String(input.storeName || "Sua vitrine").slice(0, 120);
  const customer = String(input.customerName || "Cliente").slice(0, 120);
  const shortId = shortOrderId(input.orderId);
  const total = formatSellerMoney(input.total, input.currency);
  const payment = input.paymentMethod ? String(input.paymentMethod) : "a confirmar";
  const items = (input.items ?? []).slice(0, 40);
  const rows = items
    .map(
      (item) =>
        `<tr><td style="padding:6px 0">${escapeHtml(item.name)}</td>` +
        `<td style="text-align:center;padding:6px 0">${Number(item.quantity) || 1}</td>` +
        `<td style="text-align:right;padding:6px 0">${escapeHtml(
          formatSellerMoney(Number(item.unitPrice) || 0, input.currency),
        )}</td></tr>`,
    )
    .join("");

  const subject = `Novo pedido #${shortId} — ${store}`;
  const html =
    `<div style="font-family:Arial,sans-serif;color:#222;max-width:600px">` +
    `<h2 style="color:#7c3aed">Novo pedido recebido! 🎉</h2>` +
    `<p>Loja: <strong>${escapeHtml(store)}</strong></p>` +
    `<p>Cliente: <strong>${escapeHtml(customer)}</strong></p>` +
    `<p>Pedido: <strong>#${escapeHtml(shortId)}</strong></p>` +
    `<p>Pagamento: <strong>${escapeHtml(payment)}</strong></p>` +
    (rows
      ? `<table style="width:100%;border-collapse:collapse;margin:16px 0">` +
        `<tr><th align="left">Produto</th><th>Qtd</th><th align="right">Valor</th></tr>${rows}</table>`
      : "") +
    `<p style="font-size:18px"><strong>Total: ${escapeHtml(total)}</strong></p>` +
    `<p><a href="${escapeHtml(input.panelUrl)}" style="background:#7c3aed;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;display:inline-block">Ver pedido no painel</a></p>` +
    `<p style="font-size:12px;color:#666">Você recebeu este e-mail porque é o responsável por esta vitrine.</p>` +
    `</div>`;
  const text =
    `Novo pedido recebido!\n\n` +
    `Loja: ${store}\nCliente: ${customer}\nPedido: #${shortId}\n` +
    `Pagamento: ${payment}\nTotal: ${total}\n\n` +
    `Itens:\n` +
    (items.length
      ? items
          .map(
            (item) =>
              `- ${item.name} | ${Number(item.quantity) || 1}x | ${formatSellerMoney(
                Number(item.unitPrice) || 0,
                input.currency,
              )}`,
          )
          .join("\n")
      : "- (sem itens informados)") +
    `\n\nVer pedido: ${input.panelUrl}`;

  return { subject, html, text };
}

/** Evita disparos antigos/repetidos caso alguém descubra um id de pedido. */
export function isRecentOrder(createdAt: string | null | undefined, now = Date.now()): boolean {
  if (!createdAt) return false;
  const time = new Date(createdAt).getTime();
  if (!Number.isFinite(time) || time > now + 60_000) return false;
  return now - time <= 24 * 60 * 60 * 1000;
}

export type SellerOrderPushInput = {
  orderId: string;
  customerName: string | null;
  total: number;
  currency: string | null;
  storeName: string | null;
  panelUrl: string;
};

/** Payload enviado ao service worker do painel via Web Push. */
export function buildSellerOrderPush(input: SellerOrderPushInput): {
  title: string;
  body: string;
  url: string;
  tag: string;
  orderId: string;
} {
  const customer = String(input.customerName || "Cliente").slice(0, 120);
  const total = formatSellerMoney(Number(input.total) || 0, String(input.currency || "BRL"));
  const store = String(input.storeName || "Sua vitrine").slice(0, 80);
  const url = `${input.panelUrl.replace(/\/+$/, "")}/painel/pedidos?order=${encodeURIComponent(
    input.orderId,
  )}`;
  return {
    title: "Novo pedido recebido! 🎉",
    body: `${customer} — ${total} · ${store}. Toque para abrir no painel.`,
    url,
    tag: `new-order-${input.orderId}`,
    orderId: input.orderId,
  };
}
