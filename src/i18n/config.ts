/**
 * Configuração central de idiomas.
 *
 * Módulo puro (sem React, sem DOM) para poder ser testado no Node e reutilizado
 * por qualquer camada da aplicação.
 *
 * Regras:
 *   - Português (pt-BR) é sempre o idioma padrão do primeiro acesso;
 *   - o idioma NUNCA é detectado pelo navegador (não sobrescreve escolha manual);
 *   - idioma e moeda são independentes: nada aqui toca em `src/lib/currency.ts`.
 */

export const LOCALES = ["pt-BR", "en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "pt-BR";

/** Chave usada no localStorage (funciona sem login). */
export const LOCALE_STORAGE_KEY = "vitrine.locale";

/** Cookie espelhando a preferência (permite SSR e leitura no servidor no futuro). */
export const LOCALE_COOKIE = "vitrine_locale";

export type LocaleMeta = {
  /** Bandeira exibida no seletor. */
  flag: string;
  /** Nome do idioma no próprio idioma (como aparece no seletor). */
  nativeName: string;
  /** Nome em inglês (para logs/relatórios e busca). */
  englishName: string;
  /** Locale BCP-47 usado por Intl (números, datas, plural). */
  intl: string;
};

export const LOCALE_META: Record<Locale, LocaleMeta> = {
  "pt-BR": { flag: "🇧🇷", nativeName: "Português", englishName: "Portuguese", intl: "pt-BR" },
  en: { flag: "🇺🇸", nativeName: "English", englishName: "English", intl: "en-US" },
  es: { flag: "🇪🇸", nativeName: "Español", englishName: "Spanish", intl: "es-ES" },
};

/** Valida um valor arbitrário como `Locale`. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Normaliza qualquer tag de idioma para um `Locale` suportado.
 *
 * Usado apenas para interpretar valores JÁ salvos (nunca para detectar o idioma
 * do navegador). `pt`, `pt-BR`, `en-US` e `es-419` são aceitos por conveniência.
 */
export function normalizeLocale(value: string | null | undefined): Locale | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (isLocale(raw)) return raw;
  const base = raw.toLowerCase().split(/[-_]/)[0];
  if (base === "pt") return "pt-BR";
  if (base === "en") return "en";
  if (base === "es") return "es";
  return null;
}
