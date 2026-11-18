/**
 * Persistência da preferência de idioma.
 *
 * Duas camadas, ambas sem login:
 *   - `localStorage` (preferência principal);
 *   - cookie `vitrine_locale` (permite ler o idioma no servidor/SSR).
 *
 * NUNCA lê a preferência do sistema/navegador: o primeiro acesso é sempre
 * português e a escolha manual do usuário nunca é sobrescrita por detecção
 * automática.
 */
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  type Locale,
} from "./config.ts";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Lê apenas o cookie de idioma.
 *
 * É o valor disponível tanto no servidor (SSR) quanto no cliente, então os dois
 * renderizam o mesmo idioma — sem "flash" de português e sem erro de hidratação.
 */
export function readLocaleCookie(): Locale | null {
  try {
    if (typeof document === "undefined" || !document.cookie) return null;
    const match = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
    if (!match) return null;
    return normalizeLocale(decodeURIComponent(match.slice(LOCALE_COOKIE.length + 1)));
  } catch {
    return null;
  }
}

/** Lê a preferência salva (localStorage primeiro, cookie depois). */
export function readStoredLocale(): Locale | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
      if (stored) return stored;
    }
  } catch {
    // localStorage bloqueado (modo privado/iframe): tenta o cookie.
  }
  return readLocaleCookie();
}

/** Salva a preferência (localStorage + cookie). */
export function persistLocale(locale: Locale): void {
  const safe: Locale = normalizeLocale(locale) ?? DEFAULT_LOCALE;
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, safe);
    }
  } catch {
    // Sem localStorage seguimos com o cookie.
  }
  try {
    if (typeof document !== "undefined") {
      document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(safe)}; path=/; max-age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
    }
  } catch {
    // Sem cookie o idioma continua válido durante a sessão atual.
  }
}

/** Aplica o idioma ao documento (`<html lang>`), mantendo acessibilidade/SEO. */
export function applyDocumentLocale(locale: Locale, intl: string): void {
  try {
    if (typeof document === "undefined") return;
    document.documentElement.lang = intl;
    document.documentElement.dir = "ltr";
  } catch {
    // SSR/ambiente sem DOM.
  }
}
