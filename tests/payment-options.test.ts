import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("PayPal não é oferecido no checkout nem no painel", () => {
  const client = read("src/lib/payments.ts");
  assert.match(client, /VISIBLE_PAYMENT_PROVIDERS: PaymentProviderKey\[\] = \["mercadopago"\]/);

  const connections = read("supabase/functions/_shared/payments/connections.ts");
  assert.match(connections, /for \(const provider of \["mercadopago"\] as const\)/);
  assert.doesNotMatch(connections, /for \(const provider of \["paypal", "mercadopago"\]/);

  const checkout = read("src/routes/c.$slug.tsx");
  assert.match(checkout, /isVisiblePaymentProvider\(method\.provider\)/);
  assert.doesNotMatch(checkout, /paymentProvider === "paypal"/);

  const panel = read("src/routes/painel.pagamentos.tsx");
  assert.match(panel, /isVisiblePaymentProvider\(connection\.provider\)/);
});

test("checkout oferece todas as moedas, mas converte apenas para exibição", () => {
  const checkout = read("src/routes/c.$slug.tsx");
  assert.match(checkout, /CurrencyPicker/);
  assert.match(checkout, /CURRENCIES\.filter/);
  assert.match(checkout, /convertAmount\(value, currency, selectedCurrency, rates\)/);
  assert.match(checkout, /catalog\.cart\.currencyChargedIn/);

  const currency = read("src/lib/currency.ts");
  // A lista completa permanece disponível: pix/MP/Pix não ganham uma lista reduzida.
  assert.match(currency, /export const CURRENCIES/);
  assert.ok((currency.match(/code: "[A-Z]{3}"/g) ?? []).length >= 60);
});
