/**
 * Moedas internacionais (ISO 4217) suportadas pela Vitrine Criativa.
 *
 * Este módulo é intencionalmente puro (sem imports, sem acesso a rede/banco):
 * - é usado no cliente, no servidor e nos testes (`node --test`);
 * - os valores monetários NUNCA são convertidos automaticamente aqui: a moeda
 *   apenas define como o valor já armazenado é formatado.
 *
 * Formatação: usamos Intl.NumberFormat para a parte numérica (agrupamento e
 * casas decimais) e posicionamos o símbolo conforme a convenção adotada pelo
 * app (leitura brasileira para a maioria das moedas).
 */

export type CurrencyPosition = "before" | "after";

export type CurrencyDef = {
  /** Código ISO 4217 alfa-3. */
  code: string;
  /** Nome em português. */
  name: string;
  /** Símbolo usado na exibição. */
  symbol: string;
  /** Casas decimais oficiais (ISO 4217). */
  decimals: number;
  /** Locale usada no Intl.NumberFormat (define separador de milhar/decimal). */
  numberLocale: string;
  /** Espaço entre símbolo e número. */
  space: boolean;
  /** Símbolo antes ou depois do número. */
  position: CurrencyPosition;
  /** Países/regiões em português, para pesquisa. */
  countries: string[];
};

export const DEFAULT_CURRENCY = "BRL";

export const CURRENCIES: CurrencyDef[] = [
  // ── Moedas exigidas na especificação ──
  {
    code: "BRL",
    name: "Real brasileiro",
    symbol: "R$",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Brasil"],
  },
  {
    code: "CHF",
    name: "Franco suíço",
    symbol: "CHF",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Suíça", "Liechtenstein"],
  },
  {
    code: "USD",
    name: "Dólar americano",
    symbol: "US$",
    decimals: 2,
    numberLocale: "en-US",
    space: true,
    position: "before",
    countries: ["Estados Unidos", "Equador", "El Salvador", "Panamá"],
  },
  {
    code: "EUR",
    name: "Euro",
    symbol: "€",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: [
      "Zona do euro",
      "Alemanha",
      "Áustria",
      "Bélgica",
      "Espanha",
      "Finlândia",
      "França",
      "Grécia",
      "Irlanda",
      "Itália",
      "Países Baixos",
      "Portugal",
    ],
  },
  {
    code: "GBP",
    name: "Libra esterlina",
    symbol: "£",
    decimals: 2,
    numberLocale: "en-GB",
    space: false,
    position: "before",
    countries: ["Reino Unido"],
  },
  {
    code: "CAD",
    name: "Dólar canadense",
    symbol: "CA$",
    decimals: 2,
    numberLocale: "en-CA",
    space: true,
    position: "before",
    countries: ["Canadá"],
  },
  {
    code: "AUD",
    name: "Dólar australiano",
    symbol: "AU$",
    decimals: 2,
    numberLocale: "en-AU",
    space: true,
    position: "before",
    countries: ["Austrália"],
  },
  {
    code: "JPY",
    name: "Iene japonês",
    symbol: "¥",
    decimals: 0,
    numberLocale: "ja-JP",
    space: false,
    position: "before",
    countries: ["Japão"],
  },
  {
    code: "CNY",
    name: "Yuan chinês",
    symbol: "CN¥",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["China"],
  },
  {
    code: "MXN",
    name: "Peso mexicano",
    symbol: "MX$",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["México"],
  },
  {
    code: "ARS",
    name: "Peso argentino",
    symbol: "AR$",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Argentina"],
  },
  {
    code: "CLP",
    name: "Peso chileno",
    symbol: "CL$",
    decimals: 0,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Chile"],
  },

  // ── América Latina ──
  {
    code: "BOB",
    name: "Boliviano",
    symbol: "BOB",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Bolívia"],
  },
  {
    code: "COP",
    name: "Peso colombiano",
    symbol: "COL$",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Colômbia"],
  },
  {
    code: "CRC",
    name: "Colón costa-riquenho",
    symbol: "CRC",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Costa Rica"],
  },
  {
    code: "DOP",
    name: "Peso dominicano",
    symbol: "DOP",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["República Dominicana"],
  },
  {
    code: "GTQ",
    name: "Quetzal guatemalteco",
    symbol: "GTQ",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Guatemala"],
  },
  {
    code: "HNL",
    name: "Lempira hondurenha",
    symbol: "HNL",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Honduras"],
  },
  {
    code: "PEN",
    name: "Sol peruano",
    symbol: "PEN",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Peru"],
  },
  {
    code: "PYG",
    name: "Guarani paraguaio",
    symbol: "PYG",
    decimals: 0,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Paraguai"],
  },
  {
    code: "UYU",
    name: "Peso uruguaio",
    symbol: "UYU",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Uruguai"],
  },
  {
    code: "VES",
    name: "Bolívar venezuelano",
    symbol: "VES",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Venezuela"],
  },

  // ── Europa ──
  {
    code: "BGN",
    name: "Lev búlgaro",
    symbol: "BGN",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Bulgária"],
  },
  {
    code: "CZK",
    name: "Coroa tcheca",
    symbol: "CZK",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Chéquia", "República Tcheca"],
  },
  {
    code: "DKK",
    name: "Coroa dinamarquesa",
    symbol: "DKK",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Dinamarca"],
  },
  {
    code: "HUF",
    name: "Forint húngaro",
    symbol: "HUF",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Hungria"],
  },
  {
    code: "ISK",
    name: "Coroa islandesa",
    symbol: "ISK",
    decimals: 0,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Islândia"],
  },
  {
    code: "NOK",
    name: "Coroa norueguesa",
    symbol: "NOK",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Noruega"],
  },
  {
    code: "PLN",
    name: "Zlóti polonês",
    symbol: "PLN",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Polônia"],
  },
  {
    code: "RON",
    name: "Leu romeno",
    symbol: "RON",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Romênia"],
  },
  {
    code: "RSD",
    name: "Dinar sérvio",
    symbol: "RSD",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Sérvia"],
  },
  {
    code: "RUB",
    name: "Rublo russo",
    symbol: "RUB",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Rússia"],
  },
  {
    code: "SEK",
    name: "Coroa sueca",
    symbol: "SEK",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Suécia"],
  },
  {
    code: "TRY",
    name: "Lira turca",
    symbol: "TRY",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Turquia"],
  },
  {
    code: "UAH",
    name: "Hryvnia ucraniana",
    symbol: "UAH",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Ucrânia"],
  },

  // ── Oriente Médio e África ──
  {
    code: "AED",
    name: "Dirham dos Emirados Árabes",
    symbol: "AED",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Emirados Árabes Unidos"],
  },
  {
    code: "BHD",
    name: "Dinar bareinita",
    symbol: "BHD",
    decimals: 3,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Bahrein"],
  },
  {
    code: "EGP",
    name: "Libra egípcia",
    symbol: "EGP",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Egito"],
  },
  {
    code: "ILS",
    name: "Novo shekel israelense",
    symbol: "ILS",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Israel"],
  },
  {
    code: "IQD",
    name: "Dinar iraquiano",
    symbol: "IQD",
    decimals: 3,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Iraque"],
  },
  {
    code: "JOD",
    name: "Dinar jordaniano",
    symbol: "JOD",
    decimals: 3,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Jordânia"],
  },
  {
    code: "KES",
    name: "Xelim queniano",
    symbol: "KES",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Quênia"],
  },
  {
    code: "KWD",
    name: "Dinar kuwaitiano",
    symbol: "KWD",
    decimals: 3,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Kuwait"],
  },
  {
    code: "LYD",
    name: "Dinar líbio",
    symbol: "LYD",
    decimals: 3,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Líbia"],
  },
  {
    code: "MAD",
    name: "Dirham marroquino",
    symbol: "MAD",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Marrocos"],
  },
  {
    code: "NGN",
    name: "Naira nigeriana",
    symbol: "NGN",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Nigéria"],
  },
  {
    code: "OMR",
    name: "Rial omanense",
    symbol: "OMR",
    decimals: 3,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Omã"],
  },
  {
    code: "QAR",
    name: "Rial catariano",
    symbol: "QAR",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Catar"],
  },
  {
    code: "SAR",
    name: "Rial saudita",
    symbol: "SAR",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Arábia Saudita"],
  },
  {
    code: "TND",
    name: "Dinar tunisiano",
    symbol: "TND",
    decimals: 3,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Tunísia"],
  },
  {
    code: "XAF",
    name: "Franco CFA (África Central)",
    symbol: "XAF",
    decimals: 0,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Camarões", "Gabão", "África Central"],
  },
  {
    code: "XOF",
    name: "Franco CFA (África Ocidental)",
    symbol: "XOF",
    decimals: 0,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Senegal", "Costa do Marfim", "África Ocidental"],
  },
  {
    code: "ZAR",
    name: "Rand sul-africano",
    symbol: "ZAR",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["África do Sul"],
  },

  // ── Ásia e Oceania ──
  {
    code: "BDT",
    name: "Taka bengali",
    symbol: "BDT",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Bangladesh"],
  },
  {
    code: "HKD",
    name: "Dólar de Hong Kong",
    symbol: "HK$",
    decimals: 2,
    numberLocale: "en-HK",
    space: true,
    position: "before",
    countries: ["Hong Kong"],
  },
  {
    code: "IDR",
    name: "Rupia indonésia",
    symbol: "IDR",
    decimals: 0,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Indonésia"],
  },
  {
    code: "INR",
    name: "Rupia indiana",
    symbol: "INR",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Índia"],
  },
  {
    code: "KRW",
    name: "Won sul-coreano",
    symbol: "₩",
    decimals: 0,
    numberLocale: "ko-KR",
    space: false,
    position: "before",
    countries: ["Coreia do Sul"],
  },
  {
    code: "KZT",
    name: "Tenge cazaque",
    symbol: "KZT",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Cazaquistão"],
  },
  {
    code: "LKR",
    name: "Rupia cingalesa",
    symbol: "LKR",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Sri Lanka"],
  },
  {
    code: "MYR",
    name: "Ringgit malaio",
    symbol: "MYR",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Malásia"],
  },
  {
    code: "NZD",
    name: "Dólar neozelandês",
    symbol: "NZ$",
    decimals: 2,
    numberLocale: "en-NZ",
    space: true,
    position: "before",
    countries: ["Nova Zelândia"],
  },
  {
    code: "PHP",
    name: "Peso filipino",
    symbol: "PHP",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Filipinas"],
  },
  {
    code: "PKR",
    name: "Rupia paquistanesa",
    symbol: "PKR",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Paquistão"],
  },
  {
    code: "SGD",
    name: "Dólar de Singapura",
    symbol: "S$",
    decimals: 2,
    numberLocale: "en-SG",
    space: true,
    position: "before",
    countries: ["Singapura"],
  },
  {
    code: "THB",
    name: "Baht tailandês",
    symbol: "THB",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Tailândia"],
  },
  {
    code: "TWD",
    name: "Novo dólar taiwanês",
    symbol: "NT$",
    decimals: 2,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Taiwan"],
  },
  {
    code: "VND",
    name: "Dong vietnamita",
    symbol: "VND",
    decimals: 0,
    numberLocale: "pt-BR",
    space: true,
    position: "before",
    countries: ["Vietnã"],
  },
];

const BY_CODE = new Map<string, CurrencyDef>(CURRENCIES.map((c) => [c.code, c]));

/** Normaliza texto para pesquisa (sem acentos, minúsculo). */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function isKnownCurrency(code: string | null | undefined): boolean {
  if (!code) return false;
  return BY_CODE.has(code.toUpperCase());
}

/**
 * Resolve a moeda da loja com retrocompatibilidade total:
 * lojas antigas (sem a coluna `currency`) continuam em BRL.
 */
export function resolveStoreCurrency(value: string | null | undefined): string {
  if (typeof value !== "string") return DEFAULT_CURRENCY;
  const code = value.trim().toUpperCase();
  return BY_CODE.has(code) ? code : DEFAULT_CURRENCY;
}

/**
 * Moeda dos pedidos anteriores à Etapa 1. Antes da internacionalização a
 * plataforma operava exclusivamente em BRL, então um pedido sem moeda é
 * sempre um pedido em BRL — nunca herda a moeda atual da loja.
 */
export const LEGACY_ORDER_CURRENCY = "BRL";

/**
 * Moeda de um pedido: SEMPRE a moeda gravada no momento da compra.
 *
 * Importante: pedidos sem `currency` são históricos (anteriores à Etapa 1) e
 * ficam fixos em BRL. Se o lojista trocar a moeda principal depois, os pedidos
 * antigos não mudam de moeda nem de valor — o histórico financeiro continua
 * consistente.
 */
export function resolveOrderCurrency(orderCurrency: string | null | undefined): string {
  if (typeof orderCurrency === "string") {
    const code = orderCurrency.trim().toUpperCase();
    if (BY_CODE.has(code)) return code;
  }
  return LEGACY_ORDER_CURRENCY;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Gravação de pedidos: a moeda é obrigatória
 * ─────────────────────────────────────────────────────────────────────────── */

/** Mensagem exibida ao comprador quando o banco não aceita a moeda do pedido. */
export const ORDER_CURRENCY_UNAVAILABLE_MESSAGE =
  "Não foi possível registrar o pedido com a moeda desta loja. O sistema da loja ainda não foi atualizado — nenhum pedido foi enviado. Tente novamente em alguns minutos ou fale com a loja.";

/** Mensagem genérica para falhas de gravação do pedido. */
export const ORDER_INSERT_FAILED_MESSAGE =
  "Não foi possível registrar seu pedido. Nenhum pedido foi enviado. Tente novamente em instantes.";

export type OrderInsertErrorLike =
  | {
      code?: string | null;
      message?: string | null;
      details?: string | null;
      hint?: string | null;
    }
  | null
  | undefined;

/**
 * Detecta falha por ausência da coluna `currency` (migration não aplicada).
 *
 * Códigos relevantes:
 *  • `42703`     — undefined_column do PostgreSQL;
 *  • `PGRST204`  — coluna não encontrada no schema cache do PostgREST.
 */
export function isMissingCurrencyColumnError(error: OrderInsertErrorLike): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toUpperCase();
  const text = [error.message, error.details, error.hint]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join(" ")
    .toLowerCase();

  if (!text.includes("currency")) return false;
  if (code === "42703" || code === "PGRST204") return true;

  return /column|coluna|schema cache|does not exist|não existe/.test(text);
}

/**
 * Traduz o erro de gravação em uma mensagem clara para o comprador.
 * Nunca retorna vazio: falha de pedido sempre tem retorno visível.
 */
export function describeOrderInsertError(error: OrderInsertErrorLike): string {
  return isMissingCurrencyColumnError(error)
    ? ORDER_CURRENCY_UNAVAILABLE_MESSAGE
    : ORDER_INSERT_FAILED_MESSAGE;
}

export function getCurrency(code: string | null | undefined): CurrencyDef {
  const key = (code ?? DEFAULT_CURRENCY).toUpperCase();
  const found = BY_CODE.get(key);
  if (found) return found;
  const fallback = BY_CODE.get(DEFAULT_CURRENCY);
  // `fallback` existe por construção; o cast evita non-null assertion.
  return fallback as CurrencyDef;
}

export function getCurrencySymbol(code: string | null | undefined): string {
  return getCurrency(code).symbol;
}

/** Pesquisa por código ISO, nome, símbolo ou país. */
export function searchCurrencies(query: string, limit = 200): CurrencyDef[] {
  const q = normalizeText(query ?? "");
  if (!q) return CURRENCIES.slice(0, limit);

  const scored: { def: CurrencyDef; score: number; index: number }[] = [];
  CURRENCIES.forEach((def, index) => {
    const code = def.code.toLowerCase();
    const name = normalizeText(def.name);
    const countries = def.countries.map(normalizeText);

    let score = -1;
    if (code === q) score = 0;
    else if (code.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (countries.some((c) => c.startsWith(q))) score = 3;
    else if (name.includes(q)) score = 4;
    else if (countries.some((c) => c.includes(q))) score = 5;
    else if (code.includes(q)) score = 6;
    else if (normalizeText(def.symbol).includes(q)) score = 7;

    if (score >= 0) scored.push({ def, score, index });
  });

  // Empate é resolvido pela ordem curada da lista (moedas principais primeiro),
  // para que "libra" traga GBP antes de EGP.
  scored.sort((a, b) => (a.score === b.score ? a.index - b.index : a.score - b.score));
  return scored.slice(0, limit).map((s) => s.def);
}

/** Arredonda para as casas decimais da moeda. */
export function roundMoney(value: number, code: string | null | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const decimals = getCurrency(code).decimals;
  if (decimals === 0) return Math.round(value);
  return Number(value.toFixed(decimals));
}

/** Valor em unidades mínimas (centavos), para somas sem erro de ponto flutuante. */
export function toMinorUnits(value: number, code: string | null | undefined): number {
  const decimals = getCurrency(code).decimals;
  return Math.round(roundMoney(value, code) * 10 ** decimals);
}

export function fromMinorUnits(minor: number, code: string | null | undefined): number {
  const decimals = getCurrency(code).decimals;
  return roundMoney(minor / 10 ** decimals, code);
}

/**
 * `true` quando o valor tem casas menores que a unidade mínima da moeda.
 *
 * Ex.: `10.5` em JPY (0 casas), `1.2345` em KWD (3 casas). A tolerância é
 * relativa ao valor já convertido em unidades mínimas — nunca um "meio
 * centavo" fixo, que quebra moedas de 0 ou 3 casas.
 */
export function hasSubUnitPrecision(
  value: number,
  code: string | null | undefined,
): boolean {
  if (!Number.isFinite(value)) return false;
  const decimals = getCurrency(code).decimals;
  const scaled = value * 10 ** decimals;
  const tolerance = Math.max(1e-6, Math.abs(scaled) * 1e-12);
  return Math.abs(scaled - Math.round(scaled)) > tolerance;
}

/** Formata um valor monetário já armazenado, sem converter nada. */
export function formatMoney(value: number, code?: string | null): string {
  const def = getCurrency(code);
  const safe = Number.isFinite(value) ? value : 0;
  const abs = Math.abs(safe);

  const number = new Intl.NumberFormat(def.numberLocale, {
    minimumFractionDigits: def.decimals,
    maximumFractionDigits: def.decimals,
    useGrouping: true,
  }).format(abs);

  const rounded = Number(abs.toFixed(def.decimals));
  const sign = safe < 0 && rounded !== 0 ? "-" : "";
  const sep = def.space ? " " : "";

  return def.position === "after"
    ? `${sign}${number}${sep}${def.symbol}`
    : `${sign}${def.symbol}${sep}${number}`;
}

/** Formata uma cotação (taxa de câmbio) com mais casas decimais. */
export function formatRate(value: number, code?: string | null): string {
  const def = getCurrency(code);
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const maximumFractionDigits = abs >= 1 ? 4 : 6;
  const number = new Intl.NumberFormat(def.numberLocale, {
    minimumFractionDigits: 2,
    maximumFractionDigits,
    useGrouping: true,
  }).format(abs);
  const sign = value < 0 ? "-" : "";
  const sep = def.space ? " " : "";
  return def.position === "after"
    ? `${sign}${number}${sep}${def.symbol}`
    : `${sign}${def.symbol}${sep}${number}`;
}

/**
 * Lê um valor digitado pelo usuário aceitando "1.234,56", "1,234.56",
 * "1234,56", "1234.56" e "R$ 202,40".
 */
export function parseAmount(input: string | null | undefined): number | null {
  if (typeof input !== "string") return null;
  let s = input.replace(/[^\d.,-]/g, "").trim();
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma > -1) {
    const parts = s.split(",");
    if (parts.length > 2) s = s.replace(/,/g, "");
    else s = s.replace(",", ".");
  } else if (lastDot > -1) {
    const parts = s.split(".");
    if (parts.length > 2) {
      // 1.234.567 => separador de milhar
      s = s.replace(/\./g, "");
    } else {
      const after = parts[1] ?? "";
      const before = parts[0] ?? "";
      const isThousands = after.length === 3 && before.length > 0 && before !== "0";
      if (isThousands) s = s.replace(".", "");
    }
  }

  const value = Number(s);
  return Number.isFinite(value) ? value : null;
}

export type ConversionResult = {
  /** Valor convertido, já arredondado para a moeda de destino. */
  value: number;
  /** 1 unidade de `from` equivale a `rate` unidades de `to`. */
  rate: number;
  from: string;
  to: string;
};

/**
 * Converte usando uma tabela de cotações com base comum (USD por padrão).
 * Retorna `null` quando falta cotação — nunca inventa valores.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number> | null | undefined,
): ConversionResult | null {
  if (!rates) return null;
  if (!Number.isFinite(amount)) return null;

  const fromCode = (from ?? "").toUpperCase();
  const toCode = (to ?? "").toUpperCase();
  const fromRate = rates[fromCode];
  const toRate = rates[toCode];

  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate)) return null;
  if (!fromRate || fromRate <= 0 || !toRate || toRate <= 0) return null;

  const rate = toRate / fromRate;
  const raw = amount * rate;
  return { value: roundMoney(raw, toCode), rate, from: fromCode, to: toCode };
}

/** Texto para o botão "copiar resultado". */
export function buildConversionCopyText(
  result: ConversionResult,
  updatedAt?: string | null,
): string {
  const lines = [`${formatMoney(result.value, result.to)} (${result.to})`];
  lines.push(`1 ${result.from} = ${formatRate(result.rate, result.to)}`);
  if (updatedAt) lines.push(`Cotação de referência em ${formatUpdatedAt(updatedAt)}`);
  lines.push(RATE_DISCLAIMER);
  return lines.join("\n");
}

/** Data/hora da cotação no fuso do navegador (determinístico no servidor). */
export function formatUpdatedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

export const RATE_DISCLAIMER =
  "Cotação estimada de referência (mercado internacional). Bancos, cartões e plataformas de pagamento podem aplicar taxas diferentes.";
