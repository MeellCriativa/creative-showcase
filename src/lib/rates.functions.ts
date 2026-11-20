import { createServerFn } from "@tanstack/react-start";

import type { RatesResult } from "./currency-rates.server";

export type CurrencyRatesPayload = {
  ok: boolean;
  base: "USD";
  /** Apenas moedas suportadas pela Vitrine Criativa. */
  rates: Record<string, number>;
  provider: string | null;
  providerLabel: string | null;
  updatedAt: string | null;
  fetchedAt: string | null;
  stale: boolean;
  cached: boolean;
  error: string | null;
};

/**
 * Busca as cotações no backend (nunca no navegador).
 * A resposta identifica provedor, data da cotação e se o valor é antigo.
 */
export const fetchCurrencyRates = createServerFn({ method: "GET" })
  .validator((input: unknown) => {
    const force =
      typeof input === "object" && input !== null && (input as { force?: unknown }).force === true;
    return { force };
  })
  .handler(async ({ data }): Promise<CurrencyRatesPayload> => {
    const { getRates, supportedRates } = await import("./currency-rates.server");
    const result: RatesResult = await getRates({ force: data.force });
    return {
      ok: result.ok,
      base: result.base,
      rates: supportedRates(result.rates),
      provider: result.provider,
      providerLabel: result.providerLabel,
      updatedAt: result.updatedAt,
      fetchedAt: result.fetchedAt,
      stale: result.stale,
      cached: result.cached,
      error: result.error,
    };
  });
