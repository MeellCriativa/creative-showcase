/**
 * Backend de cotações de câmbio (executa somente no servidor).
 *
 * Fonte principal: open.er-api.com (ExchangeRate-API, plano gratuito)
 *  - 160+ moedas (inclui BRL, CHF, USD, EUR, GBP, CAD, AUD, JPY, CNY, MXN, ARS, CLP)
 *  - não exige chave de API
 *  - informa a data/hora da última atualização oficial
 *
 * Fallbacks (usados só se a principal falhar):
 *  1. fawazahmed0/currency-api via jsDelivr (340+ moedas, sem chave)
 *  2. Frankfurter / BCE (29 moedas, sem chave)
 *
 * Nunca gravamos cotação fixa no código: se nenhuma fonte responder, devolvemos
 * erro (ou o último valor conhecido marcado explicitamente como `stale`).
 */

import { isKnownCurrency } from "./currency.ts";

export type RatesProviderId = "exchangerate-api" | "fawazahmed0" | "frankfurter";

export type RatesResult = {
  ok: boolean;
  base: "USD";
  rates: Record<string, number>;
  /** Moedas com cotação disponível nesta resposta. */
  currencies: string[];
  provider: RatesProviderId | null;
  providerLabel: string | null;
  /** Quando o provedor publicou a cotação. */
  updatedAt: string | null;
  /** Quando o backend buscou a cotação. */
  fetchedAt: string | null;
  /** true quando a cotação é um valor antigo servido por indisponibilidade. */
  stale: boolean;
  /** true quando a resposta veio de cache. */
  cached: boolean;
  error: string | null;
};

type ParsedRates = { rates: Record<string, number>; updatedAt: string | null };

type Provider = {
  id: RatesProviderId;
  label: string;
  url: string;
  docs: string;
  parse: (json: unknown) => ParsedRates | null;
};

const DEFAULT_TTL_MINUTES = 30;
const FETCH_TIMEOUT_MS = 8000;
const EDGE_CACHE_URL = "https://vitrine-criativa.internal/currency-rates/usd/v1";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function isoFromUnixSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const ms = value * 1000;
  if (ms < Date.UTC(2000, 0, 1)) return null;
  return new Date(ms).toISOString();
}

function isoFromDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Valida e normaliza a tabela de cotações.
 * Rejeita valores ausentes, não numéricos, negativos ou absurdos.
 */
export function sanitizeRates(
  raw: unknown,
  opts?: { lowercaseKeys?: boolean },
): Record<string, number> | null {
  const record = asRecord(raw);
  if (!record) return null;

  const rates: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value <= 0 || value > 1e9) continue;
    const code = (opts?.lowercaseKeys ? key.toUpperCase() : key).toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) continue;
    rates[code] = value;
  }

  // A base é sempre USD.
  rates["USD"] = 1;

  if (Object.keys(rates).length < 20) return null;
  for (const required of ["BRL", "USD", "EUR"]) {
    if (!(required in rates)) return null;
  }
  return rates;
}

export const PROVIDERS: Provider[] = [
  {
    id: "exchangerate-api",
    label: "ExchangeRate-API (open.er-api.com)",
    url: "https://open.er-api.com/v6/latest/USD",
    docs: "https://www.exchangerate-api.com/docs/free",
    parse: (json) => {
      const root = asRecord(json);
      if (!root) return null;
      if (root["result"] !== "success") return null;
      const rates = sanitizeRates(root["rates"]);
      if (!rates) return null;
      return { rates, updatedAt: isoFromUnixSeconds(root["time_last_update_unix"]) };
    },
  },
  {
    id: "fawazahmed0",
    label: "Currency API (fawazahmed0)",
    url: "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json",
    docs: "https://github.com/fawazahmed0/exchange-api",
    parse: (json) => {
      const root = asRecord(json);
      if (!root) return null;
      const rates = sanitizeRates(root["usd"], { lowercaseKeys: true });
      if (!rates) return null;
      return { rates, updatedAt: isoFromDateOnly(root["date"]) };
    },
  },
  {
    id: "frankfurter",
    label: "Frankfurter (Banco Central Europeu)",
    url: "https://api.frankfurter.dev/v1/latest?base=USD",
    docs: "https://frankfurter.dev",
    parse: (json) => {
      const root = asRecord(json);
      if (!root) return null;
      const rates = sanitizeRates(root["rates"]);
      if (!rates) return null;
      return { rates, updatedAt: isoFromDateOnly(root["date"]) };
    },
  },
];

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const value = env?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getCacheTtlMs(): number {
  const raw = readEnv("CURRENCY_RATES_TTL_MINUTES");
  const minutes = raw ? Number(raw) : NaN;
  const safe =
    Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : DEFAULT_TTL_MINUTES;
  return safe * 60 * 1000;
}

type MemoryEntry = { result: RatesResult; expiresAt: number };
let memoryCache: MemoryEntry | null = null;
let lastGood: RatesResult | null = null;

/** Limpa o cache em memória (usado nos testes). */
export function clearRatesCache(): void {
  memoryCache = null;
  lastGood = null;
}

type EdgeCacheLike = {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
};

function getEdgeCache(): EdgeCacheLike | null {
  try {
    const store = (globalThis as { caches?: { default?: EdgeCacheLike } }).caches;
    return store?.default ?? null;
  } catch {
    return null;
  }
}

async function readEdgeCache(): Promise<MemoryEntry | null> {
  const cache = getEdgeCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(new Request(EDGE_CACHE_URL));
    if (!hit) return null;
    const data = (await hit.json()) as { result?: RatesResult; expiresAt?: number };
    if (!data.result || typeof data.expiresAt !== "number") return null;
    return { result: data.result, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
}

async function writeEdgeCache(entry: MemoryEntry): Promise<void> {
  const cache = getEdgeCache();
  if (!cache) return;
  try {
    const ttlSeconds = Math.max(60, Math.round((entry.expiresAt - Date.now()) / 1000));
    await cache.put(
      new Request(EDGE_CACHE_URL),
      new Response(JSON.stringify(entry), {
        headers: { "content-type": "application/json", "cache-control": `max-age=${ttlSeconds}` },
      }),
    );
  } catch {
    /* cache de borda é opcional */
  }
}

function emptyResult(error: string): RatesResult {
  return {
    ok: false,
    base: "USD",
    rates: {},
    currencies: [],
    provider: null,
    providerLabel: null,
    updatedAt: null,
    fetchedAt: null,
    stale: false,
    cached: false,
    error,
  };
}

export type GetRatesOptions = {
  force?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

/**
 * Busca as cotações com cache, fallback entre provedores e tratamento de erro.
 * A resposta sempre identifica provedor, data da cotação e se está em cache/stale.
 */
export async function getRates(options: GetRatesOptions = {}): Promise<RatesResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const ttlMs = getCacheTtlMs();

  if (!options.force) {
    if (memoryCache && memoryCache.expiresAt > now()) {
      return { ...memoryCache.result, cached: true };
    }
    const edge = await readEdgeCache();
    if (edge && edge.expiresAt > now()) {
      memoryCache = edge;
      return { ...edge.result, cached: true };
    }
  } else if (memoryCache) {
    // Controle de requisições: uma atualização forçada só vai à rede a cada 60s.
    const fetchedAtMs = memoryCache.result.fetchedAt
      ? Date.parse(memoryCache.result.fetchedAt)
      : NaN;
    if (Number.isFinite(fetchedAtMs) && now() - fetchedAtMs < 60_000) {
      return { ...memoryCache.result, cached: true };
    }
  }

  const errors: string[] = [];

  for (const provider of PROVIDERS) {
    try {
      const response = await fetchImpl(provider.url, {
        headers: {
          accept: "application/json",
          "user-agent": "VitrineCriativa/1.0 (+currency-converter)",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });

      if (!response.ok) {
        errors.push(`${provider.id}: HTTP ${response.status}`);
        continue;
      }

      const json: unknown = await response.json();
      const parsed = provider.parse(json);
      if (!parsed) {
        errors.push(`${provider.id}: resposta inválida`);
        continue;
      }

      const result: RatesResult = {
        ok: true,
        base: "USD",
        rates: parsed.rates,
        currencies: Object.keys(parsed.rates).sort(),
        provider: provider.id,
        providerLabel: provider.label,
        updatedAt: parsed.updatedAt,
        fetchedAt: new Date(now()).toISOString(),
        stale: false,
        cached: false,
        error: null,
      };

      memoryCache = { result, expiresAt: now() + ttlMs };
      lastGood = result;
      await writeEdgeCache(memoryCache);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider.id}: ${message}`);
    }
  }

  const detail = errors.join(" | ");

  // Todas as fontes falharam: serve o último valor conhecido, marcado como antigo.
  const fallback = memoryCache?.result ?? lastGood ?? (await readEdgeCache())?.result ?? null;
  if (fallback && Object.keys(fallback.rates).length > 0) {
    return {
      ...fallback,
      stale: true,
      cached: true,
      error: `Não foi possível atualizar a cotação agora. ${detail}`,
    };
  }

  return emptyResult(`Não foi possível obter as cotações agora. ${detail}`);
}

/** Filtra a tabela de cotações para as moedas suportadas pelo app. */
export function supportedRates(rates: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, value] of Object.entries(rates)) {
    if (isKnownCurrency(code)) out[code] = value;
  }
  return out;
}
