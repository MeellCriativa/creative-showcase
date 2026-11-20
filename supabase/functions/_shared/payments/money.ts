/**
 * Formatação monetária por moeda — usada nas chamadas aos provedores.
 *
 * Correção da auditoria (M1): `toFixed(2)` fixo quebrava moedas sem centavos
 * (JPY, HUF, TWD) e truncava moedas de 3 casas (KWD, BHD, OMR). Cada provedor
 * recebe o valor exatamente com as casas decimais da moeda.
 *
 * Módulo puro (sem Deno/Node) para rodar no Edge e nos testes locais.
 */
import { getCurrency, roundMoney } from "../../../../src/lib/currency.ts";

/** Casas decimais oficiais da moeda (0, 2 ou 3). */
export function currencyDecimals(currency: string | null | undefined): number {
  return getCurrency(currency).decimals;
}

/**
 * Valor arredondado para as casas decimais da moeda (number).
 * Mercado Pago aceita number no JSON.
 */
export function providerAmount(value: number, currency: string | null | undefined): number {
  return roundMoney(Number(value), currency);
}

/**
 * Valor como string com exatamente as casas decimais da moeda.
 * PayPal exige string e recusa `1000.00` para JPY (espera `1000`).
 */
export function providerAmountString(value: number, currency: string | null | undefined): string {
  const decimals = currencyDecimals(currency);
  const rounded = roundMoney(Number(value), currency);
  return decimals === 0 ? String(Math.round(rounded)) : rounded.toFixed(decimals);
}

/** Soma em unidades mínimas — evita artefatos de ponto flutuante. */
export function addAmounts(values: number[], currency: string | null | undefined): number {
  const decimals = currencyDecimals(currency);
  const factor = 10 ** decimals;
  const minor = values.reduce((sum, value) => sum + Math.round(Number(value) * factor), 0);
  return minor / factor;
}
