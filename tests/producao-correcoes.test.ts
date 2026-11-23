import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { isValidExternalUrl } from "../src/lib/checkoutConfig.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("link do entregável é validado uma vez e aceita só HTTPS", () => {
  assert.ok(isValidExternalUrl("https://drive.google.com/file"));
  assert.ok(isValidExternalUrl("  HTTPS://exemplo.com/a  "));
  assert.ok(!isValidExternalUrl("http://exemplo.com/a"));
  assert.ok(!isValidExternalUrl("www.exemplo.com/a"));
  assert.ok(!isValidExternalUrl(""));

  const config = read("src/lib/checkoutConfig.ts");
  assert.match(config, /\^https:\\\/\\\//);

  const products = read("src/routes/painel.produtos.tsx");
  assert.match(products, /isValidExternalUrl\(candidate\)/);
  // Nada de deixar a exceção escapar para a página de erro do Start/Worker.
  assert.match(
    products,
    /try \{[\s\S]*setSaving\(true\)[\s\S]*catch \(error\)[\s\S]*finally \{[\s\S]*setSaving\(false\)/,
  );
  assert.match(products, /toast\.success\(t\("products\.saved"\)\)/);
  // A validação nativa do input url não pode bloquear o submit sem toast.
  assert.doesNotMatch(products, /type="url"[\s\S]{0,120}digital_external_url/);
});

test("pedidos de teste podem ser marcados e excluídos com segurança", () => {
  const sql = read("supabase/migrations/20261122190000_test_orders_deletion.sql");
  assert.match(sql, /add column if not exists is_test_order boolean not null default false/);
  assert.match(sql, /and is_test_order/);
  assert.match(sql, /payment_provider is null/);
  assert.match(sql, /not exists[\s\S]*payment_transactions/);
  // Pedido de teste confirmado via Pix manual (approved, sem gateway) pode ser removido.
  assert.doesNotMatch(sql, /payment_status.*=.*'pending'/);

  const panel = read("src/routes/painel.pedidos.tsx");
  assert.match(panel, /is_test_order/);
  assert.match(panel, /\.delete\(\)[\s\S]{0,160}\.eq\("catalog_id", order\.catalog_id\)/);
  assert.match(panel, /queryKey: \["seller-order-notifications", order\.catalog_id\]/);
  // O total é derivado da query: invalidar orders recalcula faturamento e contagens.
  assert.match(panel, /queryKey: \["orders", order\.catalog_id\]/);
});

test("notificações aparecem na tela de pedidos sem sumir automaticamente", () => {
  const panel = read("src/routes/painel.pedidos.tsx");
  assert.match(panel, /orders\.notification\.bannerTitle/);
  assert.match(panel, /orders\.notification\.markRead/);
  assert.doesNotMatch(panel, /if \(catalog && unreadCount > 0\) void markAllAsRead\(\)/);

  const hook = read("src/hooks/useOrderNotifications.ts");
  assert.match(hook, /age <= TOAST_WINDOW_MS/);
  assert.match(hook, /subscribe\(\(status\) =>/);
  // Sem filtro no canal: o Realtime rejeita catalog_id para alguns papéis.
  assert.doesNotMatch(hook, /filter: `catalog_id=eq\.\$\{catalogId\}`/);

  const i18n = read("src/i18n/namespaces/orders.ts");
  for (const key of ["bannerTitle", "bannerBody", "markRead"]) {
    assert.equal(i18n.split(key).length - 1, 3, `chave ${key} falta em algum idioma`);
  }
});

test("canal Realtime de notificações é único por instância da hook", () => {
  const hook = read("src/hooks/useOrderNotifications.ts");
  // Layout do painel e tela de pedidos montam a hook juntos. Se o tópico for
  // igual, o Supabase reaproveita o canal já inscrito e `.on()` estoura.
  assert.match(hook, /useCallback, useEffect, useId/);
  assert.match(hook, /const instanceId = useId\(\)\.replace/);
  assert.match(hook, /\.channel\(`seller-order-notifications:\$\{catalogId\}:\$\{instanceId\}`\)/);
  assert.doesNotMatch(hook, /\.channel\(`seller-order-notifications:\$\{catalogId\}`\)/);
  // Duas instâncias recebem o evento, mas o toast continua deduplicado.
  assert.match(hook, /if \(!orderId \|\| !shouldAnnounce\(orderId\)\) return;/);
});

test("avatar da loja fica inteiro abaixo da capa, sem sobreposição", () => {
  const catalog = read("src/routes/c.$slug.tsx");
  // Antes o avatar subia 40/48px sobre a capa (-mt-10/-mt-12).
  assert.doesNotMatch(catalog, /-mt-10 flex items-end gap-3/);
  assert.doesNotMatch(catalog, /-mt-12 flex items-end gap-3/);
  // Catálogo e página de entrada usam o mesmo espaçamento positivo.
  assert.equal(catalog.split("mt-2 flex items-end gap-3").length - 1, 2);
});
