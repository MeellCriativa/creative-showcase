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
  assert.match(sheet, /if \(hasMelhorEnvio\) \{\s*setDeliveryMethod\("melhor_envio"\)/);
  assert.match(sheet, /if \(hasMelhorEnvio\) \{\s*void handleQuote\(formatted\)/);
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

test("loja com Melhor Envio pode calcular frete e somar ao total mesmo em carrinho digital", () => {
  const sheet = checkout.slice(checkout.indexOf("function CartSheet("));
  assert.match(shippingClient, /include_digital: true/);
  assert.match(
    melhorEnvioFunction,
    /includeDigital \|\| \(it\.product_type as string \| null\) !== "digital"/,
  );
  assert.match(melhorEnvioFunction, /isDigital \? 20 : 0/);
  assert.match(melhorEnvioFunction, /isDigital \? 500 : 0/);
  assert.doesNotMatch(sheet, /catalog\.shippingErrors\.digitalOnly/);
  assert.doesNotMatch(sheet, /const physical = items\.filter/);
  assert.match(orders, /digitalOnlyShipping/);
  assert.match(orders, /includeDigital: digitalOnlyShipping/);
});

test("CEP aparece sempre que Envio é escolhido e o endereço vem preenchido do CEP", () => {
  const sheet = checkout.slice(checkout.indexOf("function CartSheet("));
  // O CEP não pode ficar escondido só porque o carrinho tem produto digital.
  assert.match(sheet, /\{deliveryMethod === "melhor_envio" && \(\s*<div className="space-y-2">/);
  assert.doesNotMatch(sheet, /deliveryMethod === "melhor_envio" && hasPhysical && \(/);
  assert.match(sheet, /autoComplete="postal-code"/);
  assert.match(sheet, /\{hasMelhorEnvio && \(\s*<button/);
  assert.doesNotMatch(sheet, /catalog\.cart\.digitalNotice/);
  // ViaCEP preenche rua/bairro/cidade/UF; número e complemento seguem editáveis.
  assert.match(sheet, /const \[addressFromCep, setAddressFromCep\] = useState\(false\)/);
  assert.match(sheet, /setAddressFromCep\(true\)/);
  assert.match(sheet, /readOnly=\{addressFromCep\}/);
  assert.match(sheet, /onClick=\{\(\) => setAddressFromCep\(false\)\}/);
  assert.match(sheet, /placeholder=\{`\$\{t\("catalog\.cart\.number"\)\} \*`\}/);
  assert.match(sheet, /!address\.number\.trim\(\)/);
  assert.equal((translations.match(/addressAutofilled:/g) ?? []).length, 3);
  assert.equal((translations.match(/editAddress:/g) ?? []).length, 3);
  assert.equal((translations.match(/numberRequired:/g) ?? []).length, 3);
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
    /const expiresAt = new Date\(Date\.now\(\) \+ PAYMENT_WINDOW_MS\)\.toISOString\(\)/,
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

test("chave Pix fica centralizada e o lembrete persiste após fechar o pagamento", () => {
  const sheet = checkout.slice(checkout.indexOf("function CartSheet("));
  assert.match(checkout, /const PIX_REMINDER_KEY = "vc_pix_reminder"/);
  assert.match(checkout, /function PixReminderCard/);
  assert.match(checkout, /readPixReminder\(\)/);
  assert.match(checkout, /savePixReminder\(next\)/);
  assert.match(checkout, /getPixOrderStatus\(reminder\.orderId, reminder\.token\)/);
  assert.match(sheet, /onPixReminder\(\{/);
  assert.match(sheet, /keyValue: result\.pix\.keyValue \?\? null/);
  assert.match(sheet, /text-center shadow-sm/);
  assert.match(
    sheet,
    /pixKeyCopied \? <Check className="size-4" \/> : <Copy className="size-4" \/>/,
  );
  // Fechar a janela não apaga o lembrete: ele continua na vitrine.
  const closePix = sheet.slice(
    sheet.indexOf("function closePix()"),
    sheet.indexOf("async function handleDeclarePix()"),
  );
  assert.doesNotMatch(closePix, /onPixReminder\(null\)/);
  assert.match(closePix, /onClose\(\)/);
  assert.equal((translations.match(/reminderTitle:/g) ?? []).length, 3);
  assert.equal((translations.match(/reminderHint:/g) ?? []).length, 3);
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
