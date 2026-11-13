import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import {
  clearRatesCache,
  getCacheTtlMs,
  getRates,
  PROVIDERS,
  sanitizeRates,
  supportedRates,
} from "../src/lib/currency-rates.server.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const RATE_TABLE: Record<string, number> = {
  USD: 1,
  BRL: 5.553906,
  CHF: 0.824189,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.37,
  AUD: 1.52,
  JPY: 158.55,
  CNY: 6.687755,
  MXN: 18.2,
  ARS: 1545.3974,
  CLP: 968.845131,
  SEK: 10.5,
  NOK: 10.9,
  DKK: 6.9,
  PLN: 4.0,
  CZK: 23.0,
  HUF: 360.0,
  TRY: 34.0,
  ZAR: 18.0,
  INR: 84.0,
  ILS: 3.7,
};

const UNIX = 1794355352; // 2026-11-11T00:02:32Z

function erApiPayload(rates: Record<string, number> = RATE_TABLE) {
  return {
    result: "success",
    provider: "https://www.exchangerate-api.com",
    time_last_update_unix: UNIX,
    time_last_update_utc: "Wed, 11 Nov 2026 00:02:32 +0000",
    base_code: "USD",
    rates,
  };
}

function fawazPayload(rates: Record<string, number> = RATE_TABLE) {
  const lowercase: Record<string, number> = {};
  for (const [code, value] of Object.entries(rates)) lowercase[code.toLowerCase()] = value;
  return { date: "2026-11-10", usd: lowercase };
}

function frankfurterPayload(rates: Record<string, number> = RATE_TABLE) {
  return { amount: 1, base: "USD", date: "2026-11-11", rates };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchHandler = (url: string, call: number) => Response | Promise<Response>;

function mockFetch(handler: FetchHandler) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url, calls.length);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** Sempre devolve a resposta principal válida. */
function okFetch() {
  return mockFetch(() => json(erApiPayload()));
}

/** Falha de rede em todas as tentativas. */
function offlineFetch() {
  return mockFetch(() => {
    throw new Error("getaddrinfo ENOTFOUND");
  });
}

beforeEach(() => {
  clearRatesCache();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Validação da resposta recebida
// ─────────────────────────────────────────────────────────────────────────────

test("sanitizeRates aceita tabela válida e força USD = 1", () => {
  const rates = sanitizeRates({ ...RATE_TABLE, USD: 999 });
  assert.ok(rates);
  assert.equal(rates.USD, 1);
  assert.equal(rates.BRL, 5.553906);
});

test("sanitizeRates rejeita respostas vazias, curtas ou inválidas", () => {
  assert.equal(sanitizeRates(null), null);
  assert.equal(sanitizeRates("texto"), null);
  assert.equal(sanitizeRates({}), null);
  assert.equal(sanitizeRates({ BRL: 5, USD: 1, EUR: 0.9 }), null); // menos de 20 moedas
});

test("sanitizeRates descarta valores não numéricos, zerados, negativos ou absurdos", () => {
  const rates = sanitizeRates({
    ...RATE_TABLE,
    XXX: "5",
    YYY: 0,
    ZZZ: -3,
    WWW: 1e12,
    VVV: Number.NaN,
  });
  assert.ok(rates);
  assert.equal("XXX" in rates, false);
  assert.equal("YYY" in rates, false);
  assert.equal("ZZZ" in rates, false);
  assert.equal("WWW" in rates, false);
  assert.equal("VVV" in rates, false);
});

test("sanitizeRates rejeita tabela sem moedas essenciais", () => {
  const noBrl: Record<string, number> = { ...RATE_TABLE };
  delete noBrl.BRL;
  assert.equal(sanitizeRates(noBrl), null);
});

test("parse do provedor principal extrai taxas e data da cotação", () => {
  const parsed = PROVIDERS[0]!.parse(erApiPayload());
  assert.ok(parsed);
  assert.equal(parsed.rates.CHF, 0.824189);
  assert.equal(new Date(parsed.updatedAt!).getTime(), UNIX * 1000);
});

test("parse do provedor principal rejeita payload de erro", () => {
  assert.equal(PROVIDERS[0]!.parse({ result: "error", "error-type": "unknown-code" }), null);
  assert.equal(PROVIDERS[0]!.parse(null), null);
});

test("parse do fallback 1 normaliza chaves minúsculas", () => {
  const parsed = PROVIDERS[1]!.parse(fawazPayload());
  assert.ok(parsed);
  assert.equal(parsed.rates.BRL, 5.553906);
  assert.equal(new Date(parsed.updatedAt!).getTime(), Date.UTC(2026, 10, 10));
});

test("parse do fallback 2 (BCE) lê a data no formato YYYY-MM-DD", () => {
  const parsed = PROVIDERS[2]!.parse(frankfurterPayload());
  assert.ok(parsed);
  assert.equal(parsed.rates.EUR, 0.92);
  assert.equal(new Date(parsed.updatedAt!).getTime(), Date.UTC(2026, 10, 11));
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Busca com cache
// ─────────────────────────────────────────────────────────────────────────────

test("busca a cotação no provedor principal", async () => {
  const { impl, calls } = okFetch();
  const result = await getRates({ fetchImpl: impl });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "exchangerate-api");
  assert.equal(result.stale, false);
  assert.equal(result.cached, false);
  assert.equal(result.error, null);
  assert.equal(result.rates.BRL, 5.553906);
  assert.ok(result.currencies.includes("CHF"));
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.includes("open.er-api.com"));
});

test("a segunda chamada usa o cache (controle de requisições)", async () => {
  const { impl, calls } = okFetch();
  const now = () => 1_000_000;
  await getRates({ fetchImpl: impl, now });
  const second = await getRates({ fetchImpl: impl, now });

  assert.equal(second.ok, true);
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1, "não deve haver nova requisição dentro do TTL");
});

test("atualização forçada é limitada a 1 requisição por minuto", async () => {
  const { impl, calls } = okFetch();
  const now = () => 2_000_000;
  await getRates({ fetchImpl: impl, now });
  const forced = await getRates({ fetchImpl: impl, now, force: true });

  assert.equal(forced.cached, true);
  assert.equal(calls.length, 1);
});

test("TTL padrão é de 30 minutos e pode ser configurado por env", () => {
  assert.equal(getCacheTtlMs(), 30 * 60 * 1000);

  process.env.CURRENCY_RATES_TTL_MINUTES = "5";
  try {
    assert.equal(getCacheTtlMs(), 5 * 60 * 1000);
  } finally {
    delete process.env.CURRENCY_RATES_TTL_MINUTES;
  }

  process.env.CURRENCY_RATES_TTL_MINUTES = "99999";
  try {
    assert.equal(getCacheTtlMs(), 30 * 60 * 1000, "valor fora da faixa usa o padrão");
  } finally {
    delete process.env.CURRENCY_RATES_TTL_MINUTES;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fallback entre provedores
// ─────────────────────────────────────────────────────────────────────────────

test("usa o fallback 1 quando o provedor principal devolve HTTP 500", async () => {
  const { impl, calls } = mockFetch((url) =>
    url.includes("open.er-api.com") ? json({ error: "boom" }, 500) : json(fawazPayload()),
  );

  const result = await getRates({ fetchImpl: impl });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "fawazahmed0");
  assert.equal(result.rates.BRL, 5.553906);
  assert.equal(calls.length, 2);
});

test("usa o fallback 2 quando os dois primeiros falham", async () => {
  const { impl, calls } = mockFetch((url) => {
    if (url.includes("open.er-api.com")) return json({}, 503);
    if (url.includes("jsdelivr")) return json({ date: "2026-11-10", usd: {} });
    return json(frankfurterPayload());
  });

  const result = await getRates({ fetchImpl: impl });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "frankfurter");
  assert.equal(calls.length, 3);
});

test("usa o fallback quando o provedor principal devolve resposta inválida", async () => {
  const { impl } = mockFetch((url) =>
    url.includes("open.er-api.com") ? json({ result: "success", rates: {} }) : json(fawazPayload()),
  );

  const result = await getRates({ fetchImpl: impl });
  assert.equal(result.ok, true);
  assert.equal(result.provider, "fawazahmed0");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Indisponibilidade da API
// ─────────────────────────────────────────────────────────────────────────────

test("sem nenhuma fonte disponível devolve erro e nenhuma cotação", async () => {
  const { impl } = offlineFetch();
  const result = await getRates({ fetchImpl: impl });

  assert.equal(result.ok, false);
  assert.deepEqual(result.rates, {});
  assert.deepEqual(result.currencies, []);
  assert.equal(result.provider, null);
  assert.equal(result.stale, false);
  assert.ok(result.error);
  assert.match(result.error!, /Não foi possível obter as cotações/);
});

test("quando todas as fontes devolvem HTTP de erro, não há cotação", async () => {
  const { impl } = mockFetch(() => json({ error: "unavailable" }, 502));
  const result = await getRates({ fetchImpl: impl });

  assert.equal(result.ok, false);
  assert.match(result.error!, /HTTP 502/);
});

test("após uma falha, serve a última cotação conhecida marcada como antiga", async () => {
  const now = () => 5_000_000;

  // 1ª chamada: sucesso
  const ok = okFetch();
  const first = await getRates({ fetchImpl: ok.impl, now });
  assert.equal(first.ok, true);
  assert.equal(first.stale, false);

  // 2ª chamada (5 min depois, forçada): todas as fontes caem
  const offline = offlineFetch();
  const second = await getRates({
    fetchImpl: offline.impl,
    now: () => 5_000_000 + 5 * 60_000,
    force: true,
  });

  assert.equal(second.ok, true);
  assert.equal(second.stale, true, "a cotação antiga precisa ser sinalizada como antiga");
  assert.equal(second.cached, true);
  assert.equal(second.rates.BRL, 5.553906);
  assert.match(second.error!, /Não foi possível atualizar a cotação agora/);
});

test("nunca devolve cotação fixa quando não há cache nem rede", async () => {
  const { impl } = offlineFetch();
  const result = await getRates({ fetchImpl: impl, force: true });
  assert.equal(result.ok, false);
  assert.equal(Object.keys(result.rates).length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Filtro para as moedas suportadas pelo app
// ─────────────────────────────────────────────────────────────────────────────

test("supportedRates mantém apenas moedas conhecidas pela Vitrine", () => {
  const filtered = supportedRates({ BRL: 5.5, USD: 1, CHF: 0.82, XYZ: 3, ABC: 4 });
  assert.deepEqual(Object.keys(filtered).sort(), ["BRL", "CHF", "USD"]);
});
