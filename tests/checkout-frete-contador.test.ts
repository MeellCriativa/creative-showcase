import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { countdownParts, formatCountdown, PAYMENT_WINDOW_MS } from "../src/lib/checkoutConfig.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const checkout = read("src/routes/c.$slug.tsx");
const shippingClient = read("src/lib/shipping.ts");
const melhorEnvioFunction = read("supabase/functions/melhor-envio/index.ts");
const orders = read("supabase/functions/_shared/payments/orders.ts");
const translations = read("src/i18n/namespaces/catalog.ts");

test("checkout oferece CEP e frete automaticamente com produto físico e Melhor Envio conectado", () => {
  assert.match(shippingClient, /export async function getShippingAvailability/);
  assert.match(shippingClient, /action=availability&catalog_id=/);
  assert.match(checkout, /getShippingAvailability\(catalog!\.id\)/);
  assert.match(checkout, /shippingAvailable && catalogHasPhysical/);
  assert.match(checkout, /\["melhor_envio", \.\.\.configuredDeliveryMethods\]/);

  const sheet = checkout.slice(checkout.indexOf("function CartSheet("));
  assert.match(
    sheet,
    /if \(hasMelhorEnvio && hasPhysical\) \{\s*setDeliveryMethod\("melhor_envio"\)/,
  );
  assert.match(sheet, /if \(hasMelhorEnvio && hasPhysical\) \{\s*void handleQuote\(formatted\)/);
  assert.match(sheet, /async function handleQuote\(zip = cep\)/);
  assert.match(sheet, /quoteSignatureRef\.current = itemSignature/);
  assert.match(sheet, /void handleQuote\(\);/);
  assert.match(sheet, /onShippingChange\(shippingCost\)/);
  assert.match(
    checkout,
    /toMinorUnits\(total, currency\) \+ toMinorUnits\(cartShippingCost, currency\)/,
  );
  assert.match(checkout, /if \(cart\.length === 0\) setCartShippingCost\(0\)/);
  assert.match(checkout, /<span className="font-bold">\{money\(cartGrandTotal\)\}<\/span>/);
});

test("backend aceita Melhor Envio sem a loja ter marcado a modalidade, mas exige conta conectada", () => {
  assert.match(orders, /deliveryMethod === "melhor_envio" &&/);
  assert.match(orders, /\.from\("melhor_envio_accounts"\)/);
  assert.match(orders, /\.eq\("catalog_id", catalog\.id\)/);
  assert.match(orders, /!!data\?\.connected/);
  assert.match(orders, /if \(!meEnabled\) \{/);
  // A recotação oficial continua obrigatória antes de gravar o pedido.
  assert.match(orders, /const requote = await reQuoteShipping\(\{/);
});

test("disponibilidade é pública e não devolve token, segredo ou endereço da loja", () => {
  assert.match(melhorEnvioFunction, /const publicActions = \["quote", "availability"\]/);
  assert.match(melhorEnvioFunction, /case "availability":\s*return availabilityAction\(ctx\)/);
  const availability = melhorEnvioFunction.slice(
    melhorEnvioFunction.indexOf("async function availabilityAction"),
    melhorEnvioFunction.indexOf("/* ── quote"),
  );
  assert.match(availability, /\.select\("connected"\)/);
  assert.match(availability, /success: true, available: !!data\?\.connected/);
  assert.doesNotMatch(availability, /access_token|refresh_token|sender_|environment/);
});

test("Pix inicia contagem de 5 minutos e oferece novo pedido sem cancelar o pedido", () => {
  const sheet = checkout.slice(checkout.indexOf("function CartSheet("));
  assert.match(
    sheet,
    /setPixExpiresAt\(new Date\(Date\.now\(\) \+ PAYMENT_WINDOW_MS\)\.toISOString\(\)\)/,
  );
  assert.match(sheet, /const pixCountdown = countdownParts\(pixExpiresAt, pixNow\)/);
  assert.match(sheet, /catalog\.paymentCountdown\.running/);
  assert.match(sheet, /catalog\.paymentCountdown\.expired/);
  assert.match(sheet, /catalog\.paymentCountdown\.newOrder/);
  assert.match(sheet, /function closePix\(\)/);
  assert.match(sheet, /setPixExpiresAt\(null\)/);
  assert.match(sheet, /onClick=\{closePix\}/);
  assert.doesNotMatch(sheet, /cancelPixOrder|deletePixOrder/);
});

test("Mercado Pago persiste o prazo e mostra o contador no retorno", () => {
  assert.match(
    checkout,
    /expiresAt: new Date\(Date\.now\(\) \+ PAYMENT_WINDOW_MS\)\.toISOString\(\)/,
  );
  assert.match(checkout, /stored\?\.expiresAt \?\?/);
  assert.match(checkout, /setPaymentDeadline\(/);
  assert.match(checkout, /const paymentCountdown = countdownParts\(paymentDeadline, paymentNow\)/);
  assert.match(checkout, /formatCountdown\(paymentCountdown\.total\)/);
  assert.match(checkout, /setPaymentReturn\(null\)/);
  // O contador é aviso: o polling de status e o webhook continuam valendo.
  assert.match(checkout, /if \(attempts >= 10\) \{/);
});

test("textos do contador existem nos três idiomas com o mesmo placeholder", () => {
  assert.equal((translations.match(/paymentCountdown: \{/g) ?? []).length, 3);
  const runningLines = translations.split("\n").filter((line) => line.includes("running:"));
  assert.equal(runningLines.length, 3);
  assert.ok(runningLines.every((line) => line.includes("{{time}}")));
  assert.equal((translations.match(/expired:/g) ?? []).length, 3);
  assert.equal((translations.match(/newOrder: /g) ?? []).length, 3);
});

test("janela de pagamento é de 5 minutos e o relógio nunca mostra negativo", () => {
  assert.equal(PAYMENT_WINDOW_MS, 5 * 60 * 1000);
  assert.equal(formatCountdown(PAYMENT_WINDOW_MS), "05:00");
  assert.equal(formatCountdown(42_000), "00:42");
  assert.equal(formatCountdown(0), "00:00");
  assert.equal(formatCountdown(-1), "00:00");

  const start = new Date("2026-11-27T12:00:00.000Z").toISOString();
  assert.deepEqual(countdownParts(start, Date.parse(start)), {
    expired: true,
    hours: 0,
    minutes: 0,
    seconds: 0,
    total: 0,
  });
  const alive = countdownParts(start, Date.parse(start) - 30_000);
  assert.equal(alive.expired, false);
  assert.equal(formatCountdown(alive.total), "00:30");
});
