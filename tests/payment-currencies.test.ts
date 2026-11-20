import assert from "node:assert/strict";
import test from "node:test";

import {
  MERCADOPAGO_SITE_CURRENCIES,
  MERCADOPAGO_SUPPORTED_CURRENCIES,
  PAYPAL_SUPPORTED_CURRENCIES,
  checkCurrencySupport,
  currencyBlockMessage,
} from "../supabase/functions/_shared/payments/currencies.ts";
import { CURRENCIES } from "../src/lib/currency.ts";

/**
 * Compatibilidade de moeda por provedor (Etapa 2).
 *
 * Regra: nunca converter silenciosamente. Se a moeda da loja não é aceita pelo
 * provedor (ou pela conta conectada), o método é bloqueado com motivo claro.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Listas oficiais
// ─────────────────────────────────────────────────────────────────────────────

test("PayPal aceita as moedas mais usadas no Brasil", () => {
  for (const code of ["BRL", "USD", "EUR", "GBP", "MXN", "JPY"]) {
    assert.equal(PAYPAL_SUPPORTED_CURRENCIES.includes(code), true, `${code} deveria ser aceita`);
  }
});

test("PayPal não aceita moedas sem suporte de recebimento", () => {
  for (const code of ["ARS", "CLP", "COP", "PEN", "UYU"]) {
    assert.equal(PAYPAL_SUPPORTED_CURRENCIES.includes(code), false, `${code} não deveria constar`);
  }
});

test("Mercado Pago aceita apenas moedas dos países onde opera", () => {
  assert.deepEqual([...MERCADOPAGO_SUPPORTED_CURRENCIES].sort(), [
    "ARS",
    "BRL",
    "CLP",
    "COP",
    "MXN",
    "PEN",
    "UYU",
  ]);
  assert.equal(MERCADOPAGO_SUPPORTED_CURRENCIES.includes("USD"), false);
  assert.equal(MERCADOPAGO_SUPPORTED_CURRENCIES.includes("EUR"), false);
});

test("todo site do Mercado Pago mapeia uma moeda suportada", () => {
  for (const [site, currency] of Object.entries(MERCADOPAGO_SITE_CURRENCIES)) {
    // MLB, MLA, MLC, MCO, MLM, MPE, MLU
    assert.match(site, /^M[A-Z]{2}$/);
    assert.equal(
      MERCADOPAGO_SUPPORTED_CURRENCIES.includes(currency),
      true,
      `${site} → ${currency} precisa constar na lista`,
    );
  }
});

test("as listas dos provedores são subconjunto das 68 moedas da Etapa 1", () => {
  const known = new Set(CURRENCIES.map((c) => c.code));
  for (const code of PAYPAL_SUPPORTED_CURRENCIES) {
    assert.equal(known.has(code), true, `PayPal lista moeda desconhecida: ${code}`);
  }
  for (const code of MERCADOPAGO_SUPPORTED_CURRENCIES) {
    assert.equal(known.has(code), true, `Mercado Pago lista moeda desconhecida: ${code}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PayPal
// ─────────────────────────────────────────────────────────────────────────────

test("PayPal aceita BRL quando a conta não informa moeda", () => {
  assert.deepEqual(checkCurrencySupport("paypal", { currency: "BRL" }), { supported: true });
});

test("PayPal normaliza a moeda em minúsculas", () => {
  assert.deepEqual(checkCurrencySupport("paypal", { currency: "brl" }), { supported: true });
});

test("PayPal bloqueia moeda não aceita com motivo explícito", () => {
  const result = checkCurrencySupport("paypal", { currency: "ARS" });
  assert.equal(result.supported, false);
  if (result.supported) return;
  assert.equal(result.code, "currency_not_supported");
  assert.match(result.reason, /ARS/);
  assert.match(result.reason, /PayPal/);
});

test("PayPal bloqueia quando a conta recebe em outra moeda (evita conversão)", () => {
  const result = checkCurrencySupport("paypal", {
    currency: "BRL",
    accountPrimaryCurrency: "USD",
  });
  assert.equal(result.supported, false);
  if (result.supported) return;
  assert.equal(result.code, "account_currency_mismatch");
  assert.match(result.reason, /USD/);
  assert.match(result.reason, /BRL/);
});

test("PayPal aceita quando a conta recebe na mesma moeda", () => {
  assert.deepEqual(
    checkCurrencySupport("paypal", { currency: "BRL", accountPrimaryCurrency: "brl" }),
    { supported: true },
  );
});

test("PayPal não bloqueia quando a moeda da conta é desconhecida", () => {
  assert.deepEqual(
    checkCurrencySupport("paypal", { currency: "BRL", accountPrimaryCurrency: null }),
    { supported: true },
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Mercado Pago
// ─────────────────────────────────────────────────────────────────────────────

test("Mercado Pago aceita BRL na conta MLB", () => {
  assert.deepEqual(
    checkCurrencySupport("mercadopago", { currency: "BRL", accountSiteId: "MLB" }),
    { supported: true },
  );
});

test("Mercado Pago bloqueia moeda fora da lista", () => {
  const result = checkCurrencySupport("mercadopago", { currency: "USD" });
  assert.equal(result.supported, false);
  if (result.supported) return;
  assert.equal(result.code, "currency_not_supported");
  assert.match(result.reason, /USD/);
  assert.match(result.reason, /Mercado Pago/);
});

test("Mercado Pago bloqueia quando o site da conta liquida em outra moeda", () => {
  const result = checkCurrencySupport("mercadopago", {
    currency: "ARS",
    accountSiteId: "MLB",
  });
  assert.equal(result.supported, false);
  if (result.supported) return;
  assert.equal(result.code, "account_currency_mismatch");
  assert.match(result.reason, /MLB/);
  assert.match(result.reason, /BRL/);
  assert.match(result.reason, /ARS/);
});

test("Mercado Pago aceita ARS na conta MLA", () => {
  assert.deepEqual(
    checkCurrencySupport("mercadopago", { currency: "ARS", accountSiteId: "MLA" }),
    { supported: true },
  );
});

test("Mercado Pago não bloqueia quando o site é desconhecido", () => {
  assert.deepEqual(
    checkCurrencySupport("mercadopago", { currency: "BRL", accountSiteId: "MLZ" }),
    { supported: true },
  );
});

test("Mercado Pago não bloqueia quando o site não foi informado", () => {
  assert.deepEqual(checkCurrencySupport("mercadopago", { currency: "BRL" }), { supported: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Casos gerais
// ─────────────────────────────────────────────────────────────────────────────

test("loja sem moeda definida é bloqueada nos dois provedores", () => {
  for (const provider of ["paypal", "mercadopago"] as const) {
    const result = checkCurrencySupport(provider, { currency: "" });
    assert.equal(result.supported, false);
    assert.equal(result.supported === false && result.code, "currency_not_supported");
  }
});

test("mensagem curta do checkout cita o provedor e a moeda", () => {
  assert.match(currencyBlockMessage("paypal", "BRL"), /PayPal/);
  assert.match(currencyBlockMessage("paypal", "BRL"), /BRL/);
  assert.match(currencyBlockMessage("mercadopago", "usd"), /Mercado Pago/);
  assert.match(currencyBlockMessage("mercadopago", "usd"), /USD/);
});
