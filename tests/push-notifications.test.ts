import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

import { buildSellerOrderPush } from "../supabase/functions/_shared/seller_notifications_pure.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("payload da notificação traz cliente, total e link do pedido", () => {
  const push = buildSellerOrderPush({
    orderId: "12345678-1234-4234-8234-123456789012",
    customerName: "Maria",
    total: 59.9,
    currency: "BRL",
    storeName: "Loja da Ana",
    panelUrl: "https://vitrine.test/",
  });

  assert.match(push.title, /Novo pedido/);
  assert.match(push.body, /Maria/);
  assert.match(push.body, /R\$\s?59,90/);
  assert.match(push.body, /Loja da Ana/);
  assert.equal(
    push.url,
    "https://vitrine.test/painel/pedidos?order=12345678-1234-4234-8234-123456789012",
  );
  assert.match(push.tag, /12345678/);
});

test("Edge Function envia push com VAPID e controla duplicidade", () => {
  const push = read("supabase/functions/_shared/seller_push.ts");
  const notify = read("supabase/functions/_shared/seller_notifications.ts");

  assert.match(push, /npm:web-push@3\.6\.7/);
  assert.match(push, /VAPID_PUBLIC_KEY/);
  assert.match(push, /VAPID_PRIVATE_KEY/);
  assert.match(push, /claim_seller_order_push/);
  assert.match(push, /seller_push_subscriptions/);
  assert.match(push, /404|410/); // inscrições expiradas são removidas
  assert.match(notify, /sendSellerOrderPush/);
  assert.ok(
    notify.indexOf("sendSellerOrderPush({") < notify.indexOf("Brevo não configurado"),
    "o push não pode depender do Brevo estar configurado",
  );
});

test("frontend toca som, mostra notificação e registra o service worker", () => {
  const sound = read("src/lib/notificationSound.ts");
  const push = read("src/lib/pushNotifications.ts");
  const hook = read("src/hooks/useOrderNotifications.ts");
  const root = read("src/routes/__root.tsx");

  assert.match(sound, /createOscillator/);
  assert.match(sound, /pointerdown/); // desbloqueio de áudio no celular
  assert.match(push, /VITE_VAPID_PUBLIC_KEY/);
  assert.match(push, /pushManager\.subscribe/);
  assert.match(push, /seller_push_subscriptions/);
  assert.match(push, /showNotification/);
  assert.match(hook, /playNotificationSound\(\)/);
  assert.match(hook, /showOrderSystemNotification/);
  assert.match(root, /registerPushServiceWorker\(\)/);
  assert.match(root, /unlockNotificationAudio\(\)/);
});

test("service worker exibe o push e abre os pedidos ao tocar", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /showNotification\(title, options\)/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.match(sw, /openWindow\(url\)/);
  assert.match(sw, /icon: "\/icon-192\.png"/);
  assert.match(sw, /badge: "\/notification-badge\.png"/);
});

test("ícone da vitrine é usado no site, no atalho e na notificação", () => {
  const manifest = read("public/site.webmanifest");
  const root = read("src/routes/__root.tsx");
  const push = read("src/lib/pushNotifications.ts");

  for (const icon of ["favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"]) {
    assert.ok(manifest.includes(`/${icon}`), `${icon} deve estar no manifesto`);
  }
  assert.match(root, /rel: "apple-touch-icon", href: "\/apple-touch-icon\.png"/);
  assert.match(push, /icon: "\/icon-192\.png"/);
  assert.match(push, /badge: "\/notification-badge\.png"/);
});

test("badge da sacolinha é branco, monocromático e com fundo transparente", () => {
  const png = PNG.sync.read(readFileSync(`${root}public/notification-badge.png`));
  assert.equal(png.width, 96);
  assert.equal(png.height, 96);

  let painted = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    const alpha = png.data[index + 3];
    if (alpha > 0) {
      assert.equal(red, green, "o badge não pode ter cor");
      assert.equal(green, blue, "o badge não pode ter cor");
      assert.ok(red >= 250, "o badge deve ser branco (tolera anti-aliasing)");
      painted += 1;
    }
  }
  assert.ok(painted > 500, "a sacolinha precisa ter pixels desenhados");

  for (const [x, y] of [
    [0, 0],
    [95, 0],
    [0, 95],
    [95, 95],
  ]) {
    const alpha = png.data[(y * png.width + x) * 4 + 3];
    assert.equal(alpha, 0, "os cantos devem ser transparentes");
  }
});

test("SQL cria inscrições por loja e reserva o envio", () => {
  const sql = read("supabase/migrations/20261122230000_seller_push_notifications.sql");
  const block1 = read("supabase/fixes/blocos_push_vendedor/01_inscricoes_dispositivos.sql");
  const block2 = read("supabase/fixes/blocos_push_vendedor/02_controle_envio.sql");

  for (const source of [sql, block1]) {
    assert.match(source, /seller_push_subscriptions/);
  }
  assert.match(sql, /enable row level security/);
  assert.match(sql, /seller_push_subscriptions_owner_all/);
  assert.match(sql, /claim_seller_order_push/);
  assert.match(sql, /push_attempts < 5/);
  assert.match(block2, /claim_seller_order_push/);
});

test("painel de pedidos oferece ativação, teste e textos traduzidos", () => {
  const page = read("src/routes/painel.pedidos.tsx");
  const component = read("src/components/OrderPushOptIn.tsx");
  const i18n = read("src/i18n/namespaces/orders.ts");

  assert.match(page, /<OrderPushOptIn \/>/);
  assert.match(component, /enableSellerPush\(catalog\.id, user\.id\)/);
  assert.match(component, /showOrderSystemNotification/);
  assert.match(component, /pushIosHint/);
  for (const key of [
    "pushTitle",
    "pushHint",
    "pushEnable",
    "pushDisable",
    "pushTest",
    "pushDenied",
    "pushUnsupported",
  ]) {
    assert.equal(i18n.split(`${key}:`).length - 1, 3, `${key} deve existir em pt/en/es`);
  }
});
