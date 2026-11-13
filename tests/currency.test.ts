import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConversionCopyText,
  CURRENCIES,
  convertAmount,
  describeOrderInsertError,
  formatMoney,
  formatRate,
  formatUpdatedAt,
  fromMinorUnits,
  getCurrency,
  isKnownCurrency,
  isMissingCurrencyColumnError,
  LEGACY_ORDER_CURRENCY,
  ORDER_CURRENCY_UNAVAILABLE_MESSAGE,
  ORDER_INSERT_FAILED_MESSAGE,
  parseAmount,
  RATE_DISCLAIMER,
  resolveOrderCurrency,
  resolveStoreCurrency,
  roundMoney,
  searchCurrencies,
  toMinorUnits,
} from "../src/lib/currency.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Lista de moedas exigidas na Etapa 1
// ─────────────────────────────────────────────────────────────────────────────

test("inclui todas as moedas exigidas na especificação", () => {
  const required = [
    "BRL",
    "CHF",
    "USD",
    "EUR",
    "GBP",
    "CAD",
    "AUD",
    "JPY",
    "CNY",
    "MXN",
    "ARS",
    "CLP",
  ];
  const codes = new Set(CURRENCIES.map((c) => c.code));
  for (const code of required) {
    assert.ok(codes.has(code), `moeda ${code} ausente`);
  }
});

test("não há códigos duplicados na lista", () => {
  const codes = CURRENCIES.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Formatação por moeda (BRL, CHF, USD, EUR, GBP, JPY)
// ─────────────────────────────────────────────────────────────────────────────

test("BRL formata como R$ 202,40", () => {
  assert.equal(formatMoney(202.4, "BRL"), "R$ 202,40");
});

test("CHF formata como CHF 202,40", () => {
  assert.equal(formatMoney(202.4, "CHF"), "CHF 202,40");
});

test("USD formata como US$ 202.40", () => {
  assert.equal(formatMoney(202.4, "USD"), "US$ 202.40");
});

test("EUR formata como € 202,40", () => {
  assert.equal(formatMoney(202.4, "EUR"), "€ 202,40");
});

test("GBP formata como £202.40", () => {
  assert.equal(formatMoney(202.4, "GBP"), "£202.40");
});

test("JPY não usa casas decimais: ¥202", () => {
  assert.equal(formatMoney(202.4, "JPY"), "¥202");
  assert.equal(formatMoney(202.6, "JPY"), "¥203");
  assert.equal(getCurrency("JPY").decimals, 0);
});

test("CLP também não usa casas decimais", () => {
  assert.equal(getCurrency("CLP").decimals, 0);
  assert.equal(formatMoney(1234.56, "CLP"), "CL$ 1.235");
});

test("agrupamento de milhar respeita o locale da moeda", () => {
  assert.equal(formatMoney(1234.56, "BRL"), "R$ 1.234,56");
  assert.equal(formatMoney(1234.56, "USD"), "US$ 1,234.56");
});

test("valores negativos preservam o sinal", () => {
  assert.equal(formatMoney(-202.4, "BRL"), "-R$ 202,40");
  assert.equal(formatMoney(-202.4, "USD"), "-US$ 202.40");
  assert.equal(formatMoney(-0.001, "BRL"), "R$ 0,00");
});

test("valores inválidos caem para zero (nunca NaN na tela)", () => {
  assert.equal(formatMoney(Number.NaN, "BRL"), "R$ 0,00");
  assert.equal(formatMoney(Number.POSITIVE_INFINITY, "USD"), "US$ 0.00");
});

test("formatar NÃO converte: o mesmo número é exibido em qualquer moeda", () => {
  assert.equal(formatMoney(202.4, "BRL"), "R$ 202,40");
  assert.equal(formatMoney(202.4, "CHF"), "CHF 202,40");
  assert.equal(formatMoney(202.4, "EUR"), "€ 202,40");
  // Nenhuma taxa de câmbio é aplicada aqui — só o símbolo/locale muda.
});

test("formatRate usa mais casas decimais para taxas pequenas", () => {
  assert.equal(formatRate(5.5539, "BRL"), "R$ 5,5539");
  assert.equal(formatRate(0.148399, "CHF"), "CHF 0,148399");
  assert.equal(formatRate(Number.NaN, "BRL"), "—");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Retrocompatibilidade (lojas e pedidos antigos)
// ─────────────────────────────────────────────────────────────────────────────

test("loja sem moeda configurada continua em BRL", () => {
  assert.equal(resolveStoreCurrency(undefined), "BRL");
  assert.equal(resolveStoreCurrency(null), "BRL");
  assert.equal(resolveStoreCurrency(""), "BRL");
});

test("moeda desconhecida ou corrompida cai para BRL", () => {
  assert.equal(resolveStoreCurrency("XYZ"), "BRL");
  assert.equal(resolveStoreCurrency("reais"), "BRL");
  assert.equal(resolveStoreCurrency("123"), "BRL");
});

test("moeda da loja é normalizada (case/espacos)", () => {
  assert.equal(resolveStoreCurrency("chf"), "CHF");
  assert.equal(resolveStoreCurrency(" usd "), "USD");
});

test("pedido antigo (sem moeda) fica fixo em BRL, independente da loja", () => {
  // A plataforma só operava em BRL antes da Etapa 1.
  assert.equal(resolveOrderCurrency(null), "BRL");
  assert.equal(resolveOrderCurrency(undefined), "BRL");
  assert.equal(resolveOrderCurrency(""), "BRL");
  assert.equal(LEGACY_ORDER_CURRENCY, "BRL");
});

test("pedido com moeda própria mantém a moeda da época da compra", () => {
  assert.equal(resolveOrderCurrency("USD"), "USD");
  assert.equal(resolveOrderCurrency("brl"), "BRL");
  assert.equal(resolveOrderCurrency(" chf "), "CHF");
});

test("pedido com moeda inválida cai para BRL (nunca para a moeda atual da loja)", () => {
  assert.equal(resolveOrderCurrency("XYZ"), "BRL");
  assert.equal(resolveOrderCurrency("reais"), "BRL");
});

test("trocar a moeda da loja não altera pedidos antigos", () => {
  const legacyOrder = { total: 202.4, currency: null as string | null };
  const newOrderInChf = { total: 202.4, currency: "CHF" as string | null };
  const storeCurrencyBefore = "BRL";
  const storeCurrencyAfter = "CHF";

  // Antes da troca, o pedido histórico é BRL.
  assert.equal(formatMoney(legacyOrder.total, resolveOrderCurrency(legacyOrder.currency)), "R$ 202,40");

  // A loja muda de moeda...
  assert.notEqual(storeCurrencyBefore, storeCurrencyAfter);

  // ...e o pedido antigo continua exatamente igual, porque a resolução usa
  // somente a moeda gravada no pedido (nunca a moeda atual da loja).
  assert.equal(formatMoney(legacyOrder.total, resolveOrderCurrency(legacyOrder.currency)), "R$ 202,40");

  // O pedido novo em CHF continua em CHF.
  assert.equal(formatMoney(newOrderInChf.total, resolveOrderCurrency(newOrderInChf.currency)), "CHF 202,40");
});

test("pedido novo em CHF é registrado e exibido em CHF", () => {
  const order = { currency: "CHF", total: 149.9 };
  assert.equal(resolveOrderCurrency(order.currency), "CHF");
  assert.equal(formatMoney(order.total, resolveOrderCurrency(order.currency)), "CHF 149,90");
});

test("isolamento entre lojas no histórico de pedidos", () => {
  const storeA = { currency: "BRL", orders: [{ currency: null }, { currency: "BRL" }] };
  const storeB = { currency: "CHF", orders: [{ currency: "CHF" }, { currency: null }] };

  const a = storeA.orders.map((o) => resolveOrderCurrency(o.currency));
  const b = storeB.orders.map((o) => resolveOrderCurrency(o.currency));

  assert.deepEqual(a, ["BRL", "BRL"]);
  assert.deepEqual(b, ["CHF", "BRL"]);
  // A moeda da loja não interfere na resolução do pedido.
  assert.notDeepEqual(a, b);
});

test("relatório de faturamento separa moedas e não soma BRL com CHF", () => {
  // Mesma agregação usada em painel.pedidos.tsx.
  const groupRevenue = (orders: { total: number; currency: string | null; status: string }[]) => {
    const byCurrency = new Map<string, number>();
    for (const order of orders) {
      if (order.status === "cancelado") continue;
      const code = resolveOrderCurrency(order.currency);
      byCurrency.set(code, (byCurrency.get(code) ?? 0) + order.total);
    }
    return [...byCurrency.entries()].sort((a, b) => b[1] - a[1]);
  };

  const orders = [
    { total: 202.4, currency: null, status: "finalizado" }, // histórico → BRL
    { total: 202.4, currency: "BRL", status: "finalizado" },
    { total: 202.4, currency: "CHF", status: "novo" },
    { total: 999, currency: "CHF", status: "cancelado" }, // ignorado
  ];

  const report = groupRevenue(orders);
  assert.deepEqual(report, [
    ["BRL", 404.8],
    ["CHF", 202.4],
  ]);

  // Trocar a moeda da loja para USD não muda o relatório anterior.
  assert.deepEqual(groupRevenue(orders), report);
});

test("isKnownCurrency só aceita códigos da lista", () => {
  assert.equal(isKnownCurrency("BRL"), true);
  assert.equal(isKnownCurrency("brl"), true);
  assert.equal(isKnownCurrency("XYZ"), false);
  assert.equal(isKnownCurrency(null), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Pesquisa por nome, código ISO e país
// ─────────────────────────────────────────────────────────────────────────────

test("pesquisa por código ISO", () => {
  assert.equal(searchCurrencies("chf")[0]?.code, "CHF");
  assert.equal(searchCurrencies("usd")[0]?.code, "USD");
  assert.equal(searchCurrencies("gbp")[0]?.code, "GBP");
});

test("pesquisa por nome", () => {
  assert.equal(searchCurrencies("franco suico")[0]?.code, "CHF");
  assert.equal(searchCurrencies("libra")[0]?.code, "GBP");
  assert.equal(searchCurrencies("iene")[0]?.code, "JPY");
  assert.equal(searchCurrencies("yuan")[0]?.code, "CNY");
  assert.equal(searchCurrencies("real")[0]?.code, "BRL");
});

test("pesquisa por país (com e sem acento)", () => {
  assert.ok(searchCurrencies("suica").some((c) => c.code === "CHF"));
  assert.ok(searchCurrencies("suíça").some((c) => c.code === "CHF"));
  assert.equal(searchCurrencies("japao")[0]?.code, "JPY");
  assert.equal(searchCurrencies("argentina")[0]?.code, "ARS");
  assert.equal(searchCurrencies("chile")[0]?.code, "CLP");
  assert.equal(searchCurrencies("mexico")[0]?.code, "MXN");
  assert.equal(searchCurrencies("canada")[0]?.code, "CAD");
});

test("pesquisa vazia devolve a lista completa", () => {
  assert.equal(searchCurrencies("").length, CURRENCIES.length);
});

test("pesquisa sem resultado devolve lista vazia", () => {
  assert.deepEqual(searchCurrencies("zzzzzz"), []);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Leitura de valores digitados e arredondamento decimal
// ─────────────────────────────────────────────────────────────────────────────

test("parseAmount entende formato brasileiro e internacional", () => {
  assert.equal(parseAmount("202,40"), 202.4);
  assert.equal(parseAmount("202.40"), 202.4);
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("R$ 202,40"), 202.4);
  assert.equal(parseAmount(" 1.234 "), 1234);
  assert.equal(parseAmount("1234"), 1234);
});

test("parseAmount rejeita entradas inválidas", () => {
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("   "), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount(null), null);
  assert.equal(parseAmount(undefined), null);
});

test("roundMoney respeita as casas decimais de cada moeda", () => {
  assert.equal(roundMoney(202.446, "BRL"), 202.45);
  assert.equal(roundMoney(202.444, "USD"), 202.44);
  assert.equal(roundMoney(202.6, "JPY"), 203);
  assert.equal(roundMoney(Number.NaN, "BRL"), 0);
});

test("toMinorUnits / fromMinorUnits evitam erro de ponto flutuante", () => {
  assert.equal(toMinorUnits(0.1 + 0.2, "BRL"), 30);
  assert.equal(fromMinorUnits(30, "BRL"), 0.3);
  assert.equal(toMinorUnits(202.4, "JPY"), 202);
  assert.equal(fromMinorUnits(202, "JPY"), 202);
  // soma de centavos em unidades mínimas é exata
  const total = [0.1, 0.2, 0.3].reduce((sum, v) => sum + toMinorUnits(v, "BRL"), 0);
  assert.equal(fromMinorUnits(total, "BRL"), 0.6);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Conversão (BRL→CHF, USD→EUR, inversão)
// ─────────────────────────────────────────────────────────────────────────────

const RATES = { USD: 1, BRL: 2, CHF: 4, EUR: 8, JPY: 150 };

test("converte BRL para CHF", () => {
  const result = convertAmount(202.4, "BRL", "CHF", RATES);
  assert.ok(result);
  assert.equal(result.to, "CHF");
  assert.equal(result.rate, 2); // 4 / 2
  assert.equal(result.value, 404.8);
});

test("converte USD para EUR", () => {
  const result = convertAmount(100, "USD", "EUR", RATES);
  assert.ok(result);
  assert.equal(result.value, 800);
  assert.equal(result.rate, 8);
});

test("inverter moedas devolve o valor original (ida e volta)", () => {
  const ida = convertAmount(202.4, "BRL", "CHF", RATES);
  assert.ok(ida);
  const volta = convertAmount(ida.value, "CHF", "BRL", RATES);
  assert.ok(volta);
  assert.equal(volta.value, 202.4);
  assert.equal(volta.rate, 1 / ida.rate);
});

test("conversão para moeda sem casas decimais arredonda (JPY)", () => {
  const result = convertAmount(100, "BRL", "JPY", RATES);
  assert.ok(result);
  assert.equal(result.value, 7500);
  assert.equal(Number.isInteger(result.value), true);
});

test("conversão entre moedas diferentes de USD usa a taxa cruzada", () => {
  const result = convertAmount(10, "CHF", "EUR", RATES);
  assert.ok(result);
  assert.equal(result.rate, 2); // 8 / 4
  assert.equal(result.value, 20);
});

test("nunca inventa valor quando falta cotação", () => {
  assert.equal(convertAmount(100, "BRL", "XYZ", RATES), null);
  assert.equal(convertAmount(100, "XYZ", "BRL", RATES), null);
  assert.equal(convertAmount(100, "BRL", "CHF", null), null);
  assert.equal(convertAmount(100, "BRL", "CHF", {}), null);
  assert.equal(convertAmount(Number.NaN, "BRL", "CHF", RATES), null);
});

test("rejeita taxas zeradas ou negativas", () => {
  assert.equal(convertAmount(100, "BRL", "CHF", { USD: 1, BRL: 0, CHF: 4 }), null);
  assert.equal(convertAmount(100, "BRL", "CHF", { USD: 1, BRL: -2, CHF: 4 }), null);
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Texto do botão "copiar resultado"
// ─────────────────────────────────────────────────────────────────────────────

test("texto copiado contém valor, taxa, data e aviso de referência", () => {
  const result = convertAmount(202.4, "BRL", "CHF", RATES);
  assert.ok(result);
  const text = buildConversionCopyText(result, "2026-11-11T00:02:32.000Z");
  assert.match(text, /CHF 404,80 \(CHF\)/);
  assert.match(text, /1 BRL = CHF 2,00/);
  // 00:02 UTC de 11/11 = 21:02 de 10/11 em America/Sao_Paulo
  assert.match(text, /10\/11\/2026, 21:02/);
  assert.ok(text.includes(RATE_DISCLAIMER));
});

test("texto copiado funciona sem data de atualização", () => {
  const result = convertAmount(10, "USD", "EUR", RATES);
  assert.ok(result);
  const text = buildConversionCopyText(result);
  assert.ok(!text.includes("Cotação de referência em"));
  assert.ok(text.includes(RATE_DISCLAIMER));
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Data da cotação
// ─────────────────────────────────────────────────────────────────────────────

test("formatUpdatedAt mostra data e hora em pt-BR (America/Sao_Paulo)", () => {
  const formatted = formatUpdatedAt("2026-11-11T00:02:32.000Z");
  // 00:02 UTC de 11/11 = 21:02 de 10/11 em America/Sao_Paulo
  assert.match(formatted, /10\/11\/2026/);
  assert.match(formatted, /21:02/);
});

test("formatUpdatedAt trata valor ausente ou inválido", () => {
  assert.equal(formatUpdatedAt(null), "—");
  assert.equal(formatUpdatedAt(""), "—");
  assert.equal(formatUpdatedAt("data-invalida"), "—");
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Cadastro/edição de produtos e isolamento entre lojas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simula o que a UI faz: o valor gravado no banco é sempre o número digitado
 * (NUMERIC), e a moeda da loja apenas define a formatação.
 */
function displayPrice(storedPrice: number, storeCurrency: string | null | undefined) {
  return formatMoney(storedPrice, resolveStoreCurrency(storeCurrency));
}

test("mesmo produto cadastrado em lojas com moedas diferentes", () => {
  const price = 202.4;
  assert.equal(displayPrice(price, "BRL"), "R$ 202,40");
  assert.equal(displayPrice(price, "CHF"), "CHF 202,40");
  assert.equal(displayPrice(price, "USD"), "US$ 202.40");
  assert.equal(displayPrice(price, "EUR"), "€ 202,40");
  assert.equal(displayPrice(price, "GBP"), "£202.40");
});

test("editar o preço mantém o valor gravado (sem conversão automática)", () => {
  const storeCurrency = "CHF";
  const original = 202.4;
  const edited = 250;

  assert.equal(displayPrice(original, storeCurrency), "CHF 202,40");
  assert.equal(displayPrice(edited, storeCurrency), "CHF 250,00");
  // O valor continua sendo o mesmo número no banco, em qualquer moeda.
  assert.equal(roundMoney(edited, storeCurrency), 250);
});

test("lojas são isoladas: a moeda de uma não afeta a outra", () => {
  const storeA = { currency: "BRL" as string | null };
  const storeB = { currency: "CHF" as string | null };
  const priceA = 100;
  const priceB = 100;

  const displayA = displayPrice(priceA, storeA.currency);
  const displayB = displayPrice(priceB, storeB.currency);

  assert.equal(displayA, "R$ 100,00");
  assert.equal(displayB, "CHF 100,00");
  assert.notEqual(displayA, displayB);

  // Alterar a moeda da loja B não muda o que a loja A exibe.
  storeB.currency = "JPY";
  assert.equal(displayPrice(priceA, storeA.currency), "R$ 100,00");
  assert.equal(displayPrice(priceB, storeB.currency), "¥100");
});

test("preços promocionais e variações usam a mesma moeda da loja", () => {
  const currency = "USD";
  const price = 199.9;
  const salePrice = 149.9;
  const options = [25, 35, 50];

  assert.equal(displayPrice(price, currency), "US$ 199.90");
  assert.equal(displayPrice(salePrice, currency), "US$ 149.90");
  assert.deepEqual(
    options.map((o) => displayPrice(o, currency)),
    ["US$ 25.00", "US$ 35.00", "US$ 50.00"],
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Gravação de pedido: moeda obrigatória (falha de migration)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simula a regra aplicada em `c.$slug.tsx`: uma única tentativa, sempre com a
 * moeda; se o banco recusar, o pedido NÃO é gravado e a operação é abortada.
 */
type InsertResult = { error: null | { code?: string; message?: string } };

function tryInsertOrder(
  payload: { total: number; currency?: string },
  db: { hasCurrencyColumn: boolean },
): { saved: null | { total: number; currency?: string }; attempts: number; message: string | null } {
  let attempts = 0;
  attempts += 1;
  const result: InsertResult = db.hasCurrencyColumn
    ? { error: null }
    : {
        error: {
          code: "42703",
          message: "column orders.currency does not exist",
        },
      };

  if (result.error) {
    return {
      saved: null,
      attempts,
      message: describeOrderInsertError(result.error),
    };
  }
  return { saved: { ...payload }, attempts, message: null };
}

test("falha de migration impede salvar pedido sem moeda", () => {
  const out = tryInsertOrder({ total: 202.4, currency: "CHF" }, { hasCurrencyColumn: false });
  assert.equal(out.saved, null);
  assert.equal(out.attempts, 1, "não deve tentar de novo sem a moeda");
  assert.equal(out.message, ORDER_CURRENCY_UNAVAILABLE_MESSAGE);
});

test("pedido em BRL também não é salvo se a coluna não existir", () => {
  const out = tryInsertOrder({ total: 100, currency: "BRL" }, { hasCurrencyColumn: false });
  assert.equal(out.saved, null);
  assert.equal(out.message, ORDER_CURRENCY_UNAVAILABLE_MESSAGE);
});

test("pedido em CHF é salvo com a moeda correta", () => {
  const out = tryInsertOrder({ total: 149.9, currency: "CHF" }, { hasCurrencyColumn: true });
  assert.deepEqual(out.saved, { total: 149.9, currency: "CHF" });
  assert.equal(out.attempts, 1);
  assert.equal(out.message, null);
});

test("nunca há retry que duplique o pedido", () => {
  const ok = tryInsertOrder({ total: 50, currency: "USD" }, { hasCurrencyColumn: true });
  const fail = tryInsertOrder({ total: 50, currency: "USD" }, { hasCurrencyColumn: false });
  assert.equal(ok.attempts, 1);
  assert.equal(fail.attempts, 1);
});

test("detecta erro de coluna ausente (42703 / PGRST204 / schema cache)", () => {
  assert.equal(
    isMissingCurrencyColumnError({
      code: "42703",
      message: 'column "currency" does not exist',
    }),
    true,
  );
  assert.equal(
    isMissingCurrencyColumnError({
      code: "PGRST204",
      message: "Could not find the 'currency' column of 'orders' in the schema cache",
    }),
    true,
  );
  assert.equal(
    isMissingCurrencyColumnError({
      message: "Could not find the 'currency' column of 'orders' in the schema cache",
    }),
    true,
  );
});

test("não confunde outros erros com falha de moeda", () => {
  assert.equal(isMissingCurrencyColumnError(null), false);
  assert.equal(isMissingCurrencyColumnError(undefined), false);
  assert.equal(
    isMissingCurrencyColumnError({ code: "23503", message: "violates foreign key constraint" }),
    false,
  );
  assert.equal(
    isMissingCurrencyColumnError({ code: "42501", message: "new row violates row-level security policy" }),
    false,
  );
  assert.equal(
    isMissingCurrencyColumnError({ message: "JWT expired" }),
    false,
  );
});

test("erro genérico recebe mensagem genérica (sempre visível ao comprador)", () => {
  assert.equal(
    describeOrderInsertError({ code: "42501", message: "new row violates row-level security policy" }),
    ORDER_INSERT_FAILED_MESSAGE,
  );
  assert.equal(describeOrderInsertError(null), ORDER_INSERT_FAILED_MESSAGE);
  assert.ok(ORDER_INSERT_FAILED_MESSAGE.length > 10);
  assert.ok(ORDER_CURRENCY_UNAVAILABLE_MESSAGE.length > 10);
});

test("nenhuma das mensagens de erro vaza detalhe técnico do banco", () => {
  for (const message of [ORDER_CURRENCY_UNAVAILABLE_MESSAGE, ORDER_INSERT_FAILED_MESSAGE]) {
    assert.doesNotMatch(message, /42703|PGRST|schema cache|column/i);
  }
});
