import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildSellerOrderEmail,
  formatSellerMoney,
  isRecentOrder,
  shortOrderId,
} from "../supabase/functions/_shared/seller_notifications_pure.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const base = {
  storeName: "Loja da Ana",
  customerName: "Maria",
  orderId: "12345678-1234-4234-8234-123456789012",
  total: 59.9,
  currency: "BRL",
  paymentMethod: "mercadopago",
  items: [{ name: "Pdf", quantity: 2, unitPrice: 29.95 }],
  panelUrl: "https://vitrine.meellcriativa.workers.dev/painel/pedidos",
};

test("e-mail do vendedor traz cliente, total, itens e link do painel", () => {
  const email = buildSellerOrderEmail(base);
  assert.match(email.subject, /12345678/);
  assert.match(email.subject, /Loja da Ana/);
  assert.match(email.html, /Maria/);
  assert.match(email.html, /Pdf/);
  assert.match(email.html, /R\$\s?59,90/);
  assert.match(email.html, /\/painel\/pedidos/);
  assert.match(email.text, /Total: R\$\s?59,90/);
});

test("e-mail escapa HTML para não injetar conteúdo do comprador", () => {
  const email = buildSellerOrderEmail({
    ...base,
    customerName: "<script>alert(1)</script>",
    items: [{ name: "<img src=x>", quantity: 1, unitPrice: 10 }],
  });
  assert.ok(!email.html.includes("<script>"));
  assert.ok(!email.html.includes("<img"));
  assert.match(email.html, /&lt;script&gt;/);
});

test("moeda desconhecida não quebra a formatação", () => {
  assert.match(formatSellerMoney(10, "BRL"), /R\$\s?10,00/);
  assert.match(formatSellerMoney(10, "XXX-INVALIDA"), /10,00/);
});

test("id curto e janela de tempo evitam reenvios antigos", () => {
  assert.equal(shortOrderId(base.orderId), "12345678");
  const now = Date.UTC(2026, 10, 22, 12);
  assert.equal(isRecentOrder(new Date(now - 60_000).toISOString(), now), true);
  assert.equal(isRecentOrder(new Date(now - 25 * 60 * 60 * 1000).toISOString(), now), false);
  assert.equal(isRecentOrder(null, now), false);
});

test("toda criação de pedido dispara a notificação e o painel ouve a tabela", () => {
  // payments + pix-manual usam createSecureOrder; o fallback anônimo usa a
  // Edge Function seller-order-notify. O trigger cobre os três caminhos.
  const orders = read("supabase/functions/_shared/payments/orders.ts");
  const notify = read("supabase/functions/_shared/seller_notifications.ts");
  const fallback = read("src/routes/c.$slug.tsx");
  const sql = read("supabase/migrations/20261122150000_seller_order_notifications.sql");
  const panel = read("src/hooks/useOrderNotifications.ts");

  assert.match(orders, /notifySellerNewOrder/);
  assert.match(notify, /api\.brevo\.com\/v3\/smtp\/email/);
  assert.match(fallback, /notifySellerAboutOrder/);
  assert.match(sql, /after insert on public\.orders/);
  assert.match(sql, /add table public\.seller_order_notifications/);
  assert.match(panel, /postgres_changes/);
});

test("contador de não lidos aparece no atalho e na tela de Pedidos", () => {
  const dashboard = read("src/routes/painel.index.tsx");
  const ordersPage = read("src/routes/painel.pedidos.tsx");
  const hook = read("src/hooks/useOrderNotifications.ts");

  // O atalho "Pedidos" do painel exibe o mesmo contador do ícone inferior.
  assert.match(dashboard, /useUnreadOrderCount\(\)/);
  assert.match(dashboard, /to="\/painel\/pedidos"[\s\S]{0,200}badge=\{unreadOrders\}/);
  assert.match(dashboard, /bg-destructive/);
  assert.match(dashboard, /badge > 0 && \(/);

  // E a própria tela de Pedidos também mostra o número em vermelho no título.
  assert.match(ordersPage, /\{unreadCount > 0 && \([\s\S]{0,400}bg-destructive/);
  assert.match(ordersPage, /t\("orders\.notification\.newBadge"\)/);

  // O atalho só lê o cache: não cria outro canal Realtime (causa do erro anterior).
  assert.match(hook, /export function useUnreadOrderCount/);
  assert.match(hook, /enabled: false,/);
  const countHook = hook.slice(hook.indexOf("export function useUnreadOrderCount"));
  assert.doesNotMatch(countHook, /\.channel\(/);
});
