import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_CURRENCY,
  formatMoney,
  fromMinorUnits,
  getCurrency,
  isKnownCurrency,
  resolveOrderCurrency,
  resolveStoreCurrency,
  roundMoney,
  toMinorUnits,
} from "../src/lib/currency.ts";
import {
  computeTotals,
  priceCart,
  shippingAllowedForMethod,
  type OfficialProduct,
} from "../supabase/functions/_shared/payments/pricing.ts";

/**
 * Regressão da Etapa 1.
 *
 * A Etapa 2 não pode alterar o comportamento já publicado: catálogo público,
 * moeda por loja, preços oficiais e finalização por WhatsApp continuam iguais.
 * Aqui verificamos os módulos puros que a Etapa 1 usa e os pontos do código que
 * o checkout em produção depende.
 */

const ROOT = new URL("../", import.meta.url);

function readFile(path: string): string {
  return readFileSync(new URL(path, ROOT), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Moeda da loja (Etapa 1)
// ─────────────────────────────────────────────────────────────────────────────

test("loja sem moeda continua em BRL", () => {
  assert.equal(DEFAULT_CURRENCY, "BRL");
  assert.equal(resolveStoreCurrency(null), "BRL");
  assert.equal(resolveStoreCurrency(undefined), "BRL");
  assert.equal(resolveStoreCurrency(""), "BRL");
  assert.equal(resolveStoreCurrency("BRL"), "BRL");
  assert.equal(resolveStoreCurrency("usd"), "USD");
});

test("pedido antigo sem moeda é lido como BRL", () => {
  assert.equal(resolveOrderCurrency(null), "BRL");
  assert.equal(resolveOrderCurrency("EUR"), "EUR");
});

test("formatação e conversão de unidades mínimas preservadas", () => {
  assert.equal(toMinorUnits(19.99, "BRL"), 1999);
  assert.equal(fromMinorUnits(1999, "BRL"), 19.99);
  assert.equal(roundMoney(19.999, "BRL"), 20);
  assert.equal(formatMoney(1234.5, "BRL").includes("1.234,50"), true);
  assert.equal(getCurrency("JPY").decimals, 0);
  assert.equal(isKnownCurrency("BRL"), true);
  assert.equal(isKnownCurrency("XYZ"), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Precificação oficial (Etapa 1 → Etapa 2)
// ─────────────────────────────────────────────────────────────────────────────

function product(overrides: Partial<OfficialProduct> = {}): OfficialProduct {
  return {
    id: "prod-1",
    catalog_id: "cat-1",
    name: "Camiseta",
    price: 50,
    sale_price: null,
    price_options: null,
    variations: null,
    available: true,
    product_type: "fisico",
    ...overrides,
  };
}

test("carrinho usa o preço promocional quando existe", () => {
  const result = priceCart(
    [product({ sale_price: 39.9 })],
    [{ product_id: "prod-1", quantity: 2 }],
    "BRL",
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.items[0]!.unitPrice, 39.9);
    assert.equal(result.items[0]!.line_total, 79.8);
    assert.equal(result.subtotal, 79.8);
    assert.equal(result.subtotal_minor, 7980);
  }
});

test("carrinho soma em unidades mínimas sem artefato", () => {
  const result = priceCart(
    [product({ id: "prod-1", price: 19.99 }), product({ id: "prod-2", name: "Boné", price: 0.01 })],
    [
      { product_id: "prod-1", quantity: 3 },
      { product_id: "prod-2", quantity: 1 },
    ],
    "BRL",
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.subtotal, 59.98);
});

test("carrinho recusa produto de outra loja", () => {
  const result = priceCart([product()], [{ product_id: "prod-inexistente", quantity: 1 }], "BRL");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "product_not_found");
});

test("carrinho recusa moeda desconhecida, carrinho vazio e quantidade inválida", () => {
  const badCurrency = priceCart([product()], [{ product_id: "prod-1", quantity: 1 }], "XYZ");
  assert.equal(badCurrency.ok, false);
  if (!badCurrency.ok) assert.equal(badCurrency.code, "invalid_currency");

  const empty = priceCart([product()], [], "BRL");
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "empty_cart");

  const badQuantity = priceCart([product()], [{ product_id: "prod-1", quantity: 0 }], "BRL");
  assert.equal(badQuantity.ok, false);
  if (!badQuantity.ok) assert.equal(badQuantity.code, "invalid_quantity");
});

test("total oficial = subtotal + frete - desconto", () => {
  const totals = computeTotals({
    currency: "BRL",
    subtotalMinor: 7980,
    shippingMinor: 2500,
  });
  assert.equal(totals.subtotal, 79.8);
  assert.equal(totals.shipping, 25);
  assert.equal(totals.total, 104.8);
  assert.equal(totals.total_minor, 10480);
});

test("frete só é aceito na modalidade Melhor Envio", () => {
  assert.equal(shippingAllowedForMethod("melhor_envio"), true);
  assert.equal(shippingAllowedForMethod("local_delivery"), false);
  assert.equal(shippingAllowedForMethod(null), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Funcionalidades da Etapa 1 preservadas no código
// ─────────────────────────────────────────────────────────────────────────────

test("checkout por WhatsApp continua existindo no catálogo público", () => {
  const source = readFile("src/routes/c.$slug.tsx");
  // Mensagem montada localmente + abertura do link wa.me.
  assert.match(source, /buildWhatsappMessage/);
  assert.match(source, /whatsappLink/);
  assert.match(source, /openWhatsapp/);
  // Fallback quando o backend não registra o pedido.
  assert.match(source, /Vamos continuar pelo WhatsApp/);
});

test("métodos de pagamento e entrega da Etapa 1 continuam declarados", () => {
  const catalog = readFile("src/lib/catalog.ts");
  for (const key of [
    "pix",
    "credit_card",
    "debit_card",
    "pix_auto",
    "cash",
    "melhor_envio",
    "local_delivery",
    "local_pickup",
  ]) {
    assert.match(catalog, new RegExp(`key: "${key}"`), `método ${key} ausente`);
  }
});

test("migration da Etapa 1 (payment_providers) não foi reescrita", () => {
  const migration = readFile("supabase/migrations/20261115090000_add_payment_providers.sql");
  // Tabelas financeiras da Etapa 2 permanecem como publicadas.
  for (const table of [
    "payment_connections",
    "order_checkout_sessions",
    "payment_transactions",
    "payment_events",
    "payment_refunds",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
});

test("correções novas não removem nada da Etapa 1", () => {
  const fix = readFile("supabase/migrations/20261116090000_payment_integrity_fixes.sql");
  const executable = fix
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .toLowerCase();

  // Nenhuma tabela de catálogo/pedido é destruída pelas correções.
  assert.doesNotMatch(executable, /drop table/);
  assert.doesNotMatch(executable, /drop column/);
  assert.doesNotMatch(executable, /truncate/);
  assert.doesNotMatch(executable, /delete from public\.(catalogs|products|orders|order_items)/);

  // Só as tabelas financeiras são alteradas.
  const altered = [...executable.matchAll(/alter table public\.([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(altered)].sort(), [
    "payment_events",
    "payment_oauth_states",
    "payment_rate_limits",
    "payment_refunds",
    "payment_transactions",
  ]);
});
