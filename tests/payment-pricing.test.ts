import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ITEMS_PER_ORDER,
  MAX_QUANTITY_PER_ITEM,
  computeTotals,
  officialBasePrice,
  parseVariationSelection,
  priceCart,
  resolveUnitPrice,
  shippingAllowedForMethod,
  type OfficialProduct,
} from "../supabase/functions/_shared/payments/pricing.ts";

/**
 * Precificação oficial (Etapa 2).
 *
 * O backend nunca confia em preço/subtotal/total do navegador: ele recebe
 * apenas ids, quantidades e a variação textual, e recalcula tudo a partir dos
 * produtos do banco. Estes testes travam esse contrato.
 */

function product(overrides: Partial<OfficialProduct> = {}): OfficialProduct {
  return {
    id: "p1",
    catalog_id: "c1",
    name: "Caneca",
    price: 35.5,
    sale_price: null,
    price_options: null,
    variations: null,
    available: true,
    product_type: "fisico",
    weight_grams: 300,
    length_cm: 10,
    width_cm: 10,
    height_cm: 12,
    images: ["https://cdn.example/caneca.png"],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Preço base (promoção tem prioridade, igual ao catálogo público)
// ─────────────────────────────────────────────────────────────────────────────

test("preço base usa sale_price quando é maior que zero", () => {
  assert.equal(officialBasePrice({ price: 100, sale_price: 79.9 }), 79.9);
});

test("preço base ignora sale_price zerado/nulo", () => {
  assert.equal(officialBasePrice({ price: 100, sale_price: null }), 100);
  assert.equal(officialBasePrice({ price: 100, sale_price: 0 }), 100);
});

test("preço base aceita string numérica do banco (numeric)", () => {
  assert.equal(officialBasePrice({ price: "35.50", sale_price: null }), 35.5);
  assert.equal(officialBasePrice({ price: "35,50", sale_price: null }), 35.5);
});

test("preço base inválido vira 0 (nunca NaN)", () => {
  assert.equal(officialBasePrice({ price: "abc", sale_price: null }), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Leitura da variação textual
// ─────────────────────────────────────────────────────────────────────────────

test("variação vazia não define valor nem grupos", () => {
  assert.deepEqual(parseVariationSelection(""), {
    priceLabel: null,
    groups: {},
    unknownTokens: [],
  });
  assert.deepEqual(parseVariationSelection(null), {
    priceLabel: null,
    groups: {},
    unknownTokens: [],
  });
});

test("variação canônica separa Valor e grupos", () => {
  assert.deepEqual(parseVariationSelection("Valor: 50 | Cor: Azul"), {
    priceLabel: "50",
    groups: { Cor: "Azul" },
    unknownTokens: [],
  });
});

test("tokens sem dois-pontos são marcados como desconhecidos", () => {
  const parsed = parseVariationSelection("Cor: Azul | lixo | : vazio");
  assert.deepEqual(parsed.groups, { Cor: "Azul" });
  assert.deepEqual(parsed.unknownTokens, ["lixo", ": vazio"]);
});

test("a chave Valor não entra nos grupos", () => {
  const parsed = parseVariationSelection("Valor: 12,90");
  assert.equal(parsed.priceLabel, "12,90");
  assert.deepEqual(parsed.groups, {});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Preço unitário oficial (opções de valor + grupos obrigatórios)
// ─────────────────────────────────────────────────────────────────────────────

test("produto com opções de valor exige a escolha do valor", () => {
  const p = product({
    price_options: [
      { label: "P", price: 30 },
      { label: "M", price: 40 },
      { label: "G", price: 50 },
    ],
  });
  const missing = resolveUnitPrice(p, null);
  assert.equal(missing.ok, false);
  assert.equal(missing.ok === false && missing.code, "invalid_variation");
});

test("produto com opções de valor usa o preço da opção escolhida", () => {
  const p = product({
    price: 999,
    price_options: [
      { label: "P", price: 30 },
      { label: "G", price: 50 },
    ],
  });
  const resolved = resolveUnitPrice(p, "Valor: G");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.ok === true && resolved.unitPrice, 50);
  assert.equal(resolved.ok === true && resolved.canonicalVariation, "Valor: G");
});

test("opção de valor inexistente é rejeitada", () => {
  const p = product({ price_options: [{ label: "P", price: 30 }] });
  const resolved = resolveUnitPrice(p, "Valor: GG");
  assert.equal(resolved.ok, false);
  assert.equal(resolved.ok === false && resolved.code, "invalid_variation");
});

test("produto sem opções de valor rejeita variação de valor", () => {
  const resolved = resolveUnitPrice(product(), "Valor: 50");
  assert.equal(resolved.ok, false);
  assert.equal(resolved.ok === false && resolved.code, "invalid_variation");
});

test("produto sem opções e sem variação usa o preço do banco", () => {
  const resolved = resolveUnitPrice(product({ price: 10, sale_price: 8 }), null);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.ok === true && resolved.unitPrice, 8);
  assert.equal(resolved.ok === true && resolved.canonicalVariation, null);
});

test("grupos obrigatórios precisam estar presentes", () => {
  const p = product({ variations: [{ name: "Cor", options: ["Azul", "Rosa"] }] });
  const missing = resolveUnitPrice(p, null);
  assert.equal(missing.ok, false);
  assert.match(missing.ok === false ? missing.error : "", /Cor/);
});

test("opção de grupo fora da lista é rejeitada", () => {
  const p = product({ variations: [{ name: "Cor", options: ["Azul", "Rosa"] }] });
  const resolved = resolveUnitPrice(p, "Cor: Verde");
  assert.equal(resolved.ok, false);
  assert.equal(resolved.ok === false && resolved.code, "invalid_variation");
});

test("grupo desconhecido é rejeitado (evita injeção de texto)", () => {
  const p = product({ variations: [{ name: "Cor", options: ["Azul"] }] });
  const resolved = resolveUnitPrice(p, "Cor: Azul | Tamanho: G");
  assert.equal(resolved.ok, false);
  assert.equal(resolved.ok === false && resolved.code, "invalid_variation");
});

test("variação canônica é reconstruída na ordem dos grupos do produto", () => {
  const p = product({
    variations: [
      { name: "Cor", options: ["Azul", "Rosa"] },
      { name: "Tamanho", options: ["P", "G"] },
    ],
  });
  const resolved = resolveUnitPrice(p, "Tamanho: G | Cor: Rosa");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.ok === true && resolved.canonicalVariation, "Cor: Rosa | Tamanho: G");
});

test("variação canônica combina Valor e grupos na ordem correta", () => {
  const p = product({
    price_options: [{ label: "Grande", price: 60 }],
    variations: [{ name: "Cor", options: ["Azul"] }],
  });
  const resolved = resolveUnitPrice(p, "Cor: Azul | Valor: Grande");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.ok === true && resolved.canonicalVariation, "Valor: Grande | Cor: Azul");
});

test("token sem dois-pontos invalida a variação", () => {
  const resolved = resolveUnitPrice(product(), "presente");
  assert.equal(resolved.ok, false);
  assert.equal(resolved.ok === false && resolved.code, "invalid_variation");
});

test("preço negativo é rejeitado como preço indisponível", () => {
  const p = product({ price_options: [{ label: "X", price: -5 }] });
  const resolved = resolveUnitPrice(p, "Valor: X");
  assert.equal(resolved.ok, false);
  assert.equal(resolved.ok === false && resolved.code, "price_unavailable");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Carrinho completo
// ─────────────────────────────────────────────────────────────────────────────

test("moeda desconhecida bloqueia o pedido", () => {
  const result = priceCart([product()], [{ product_id: "p1", quantity: 1 }], "XYZ");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "invalid_currency");
});

test("carrinho vazio é recusado", () => {
  const result = priceCart([product()], [], "BRL");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "empty_cart");
});

test("carrinho acima do limite de itens é recusado", () => {
  const items = Array.from({ length: MAX_ITEMS_PER_ORDER + 1 }, () => ({
    product_id: "p1",
    quantity: 1,
  }));
  const result = priceCart([product()], items, "BRL");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "item_limit");
});

test("produto de outra loja / removido é recusado", () => {
  const result = priceCart(
    [product({ id: "p1" })],
    [{ product_id: "p2", quantity: 1 }],
    "BRL",
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "product_not_found");
});

test("item sem product_id é recusado", () => {
  const result = priceCart([product()], [{ quantity: 1 }], "BRL");
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "product_not_found");
});

test("produto indisponível bloqueia o pedido", () => {
  const result = priceCart(
    [product({ available: false })],
    [{ product_id: "p1", quantity: 1 }],
    "BRL",
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.code, "product_unavailable");
});

for (const quantity of [0, -1, 1.5, MAX_QUANTITY_PER_ITEM + 1]) {
  test(`quantidade inválida (${quantity}) é recusada`, () => {
    const result = priceCart([product()], [{ product_id: "p1", quantity }], "BRL");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.code, "invalid_quantity");
  });
}

test("quantidade como string numérica é aceita", () => {
  const result = priceCart([product()], [{ product_id: "p1", quantity: "2" }], "BRL");
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.items[0]!.quantity, 2);
});

test("subtotal é somado em unidades mínimas (sem erro de ponto flutuante)", () => {
  const result = priceCart(
    [product({ price: 0.1 })],
    [{ product_id: "p1", quantity: 3 }],
    "BRL",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtotal_minor, 30);
  assert.equal(result.subtotal, 0.3);
  assert.equal(result.items[0]!.line_total, 0.3);
});

test("preço unitário mantém o nome histórico `unitPrice` (painel)", () => {
  const result = priceCart([product({ price: 35.5 })], [{ product_id: "p1", quantity: 2 }], "BRL");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.items[0]!.unitPrice, 35.5);
  assert.equal(result.items[0]!.line_total, 71);
  assert.equal(result.subtotal, 71);
});

test("linhas repetidas do mesmo produto são somadas", () => {
  const result = priceCart(
    [product({ price: 10 })],
    [
      { product_id: "p1", quantity: 1, variation: null },
      { product_id: "p1", quantity: 2, variation: null },
    ],
    "BRL",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtotal, 30);
  assert.equal(result.items.length, 2);
});

test("moeda sem centavos (JPY) não cria fração", () => {
  const result = priceCart(
    [product({ price: 1000 })],
    [{ product_id: "p1", quantity: 2 }],
    "JPY",
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subtotal_minor, 2000);
  assert.equal(result.subtotal, 2000);
  assert.equal(result.currency, "JPY");
});

test("metadados de frete vêm do produto do banco", () => {
  const result = priceCart([product()], [{ product_id: "p1", quantity: 1 }], "BRL");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const item = result.items[0]!;
  assert.equal(item.product_type, "fisico");
  assert.equal(item.weight_grams, 300);
  assert.equal(item.length_cm, 10);
  assert.equal(item.width_cm, 10);
  assert.equal(item.height_cm, 12);
  assert.equal(item.image, "https://cdn.example/caneca.png");
});

test("produto digital é identificado para dispensar frete", () => {
  const result = priceCart(
    [product({ product_type: "digital" })],
    [{ product_id: "p1", quantity: 1 }],
    "BRL",
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.items[0]!.product_type, "digital");
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Totais e frete
// ─────────────────────────────────────────────────────────────────────────────

test("total = subtotal + frete - desconto em unidades mínimas", () => {
  const totals = computeTotals({
    currency: "BRL",
    subtotalMinor: 10000,
    shippingMinor: 2550,
    discountMinor: 500,
  });
  assert.equal(totals.total_minor, 12050);
  assert.equal(totals.subtotal, 100);
  assert.equal(totals.shipping, 25.5);
  assert.equal(totals.discount, 5);
  assert.equal(totals.total, 120.5);
});

test("total nunca fica negativo", () => {
  const totals = computeTotals({
    currency: "BRL",
    subtotalMinor: 1000,
    discountMinor: 5000,
  });
  assert.equal(totals.total_minor, 0);
  assert.equal(totals.total, 0);
});

test("valores negativos de frete/desconto são neutralizados", () => {
  const totals = computeTotals({
    currency: "BRL",
    subtotalMinor: 1000,
    shippingMinor: -500,
    discountMinor: -500,
  });
  assert.equal(totals.shipping_minor, 0);
  assert.equal(totals.discount_minor, 0);
  assert.equal(totals.total_minor, 1000);
});

test("frações de unidade mínima são arredondadas", () => {
  const totals = computeTotals({ currency: "BRL", subtotalMinor: 1000.4, shippingMinor: 10.6 });
  assert.equal(totals.subtotal_minor, 1000);
  assert.equal(totals.shipping_minor, 11);
  assert.equal(totals.total_minor, 1011);
});

test("somente melhor_envio pode ter custo de frete", () => {
  assert.equal(shippingAllowedForMethod("melhor_envio"), true);
  assert.equal(shippingAllowedForMethod("pickup"), false);
  assert.equal(shippingAllowedForMethod("local_delivery"), false);
  assert.equal(shippingAllowedForMethod(null), false);
});
