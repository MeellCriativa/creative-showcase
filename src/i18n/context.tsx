/**
 * Provider global de idioma + hook `useI18n`.
 *
 * - troca instantânea (estado React, sem reload);
 * - persistência em localStorage + cookie (sem login);
 * - português como padrão e fallback;
 * - nunca detecta o idioma do navegador;
 * - atualiza `<html lang>` para acessibilidade/SEO;
 * - expõe `t`, `tp` (plural) e formatadores `Intl` — sem tocar em moeda.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { DEFAULT_LOCALE, LOCALE_META, type Locale } from "./config.ts";
import { messages, messagesByLocale, type MessageKey, type PluralMessageKey } from "./messages.ts";
import { applyDocumentLocale, persistLocale, readStoredLocale } from "./storage.ts";
import { translate, translatePlural } from "./translate.ts";
import type { InterpolationValues } from "./types.ts";

export type I18nContextValue = {
  locale: Locale;
  /** Locale BCP-47 para `Intl` (ex.: `pt-BR`, `en-US`, `es-ES`). */
  intlLocale: string;
  setLocale: (locale: Locale) => void;
  /** Traduz uma chave (`"panel.nav.products"`). */
  t: (key: MessageKey, values?: InterpolationValues) => string;
  /** Traduz uma chave plural (`tp("common.itemsCount", 3)`). */
  tp: (key: PluralMessageKey, count: number, values?: InterpolationValues) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
  formatDateTime: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
};

function buildValue(locale: Locale, setLocale: (locale: Locale) => void): I18nContextValue {
  const dictionary = messagesByLocale[locale] ?? messages;
  const intlLocale = LOCALE_META[locale]?.intl ?? LOCALE_META[DEFAULT_LOCALE].intl;

  const t = (key: MessageKey, values?: InterpolationValues) =>
    translate({ locale, dictionary, fallback: messages, key, values });

  const tp = (key: PluralMessageKey, count: number, values?: InterpolationValues) =>
    translatePlural({ locale, dictionary, fallback: messages, key, count, values });

  const toDate = (value: Date | string | number): Date | null => {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  return {
    locale,
    intlLocale,
    setLocale,
    t,
    tp,
    formatNumber: (value, options) => {
      try {
        return new Intl.NumberFormat(intlLocale, options).format(value);
      } catch {
        return String(value);
      }
    },
    formatDate: (value, options) => {
      const date = toDate(value);
      if (!date) return "";
      try {
        return new Intl.DateTimeFormat(intlLocale, options ?? { dateStyle: "medium" }).format(date);
      } catch {
        return date.toISOString().slice(0, 10);
      }
    },
    formatDateTime: (value, options) => {
      const date = toDate(value);
      if (!date) return "";
      try {
        return new Intl.DateTimeFormat(intlLocale, options ?? { dateStyle: "short", timeStyle: "short" }).format(date);
      } catch {
        return date.toISOString();
      }
    },
  };
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale = DEFAULT_LOCALE,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  // Sempre começa no padrão (ou no idioma recebido) para o HTML do servidor e
  // o primeiro render do cliente serem idênticos (sem erro de hidratação).
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // Depois da montagem, aplica a preferência salva — sem reload e sem piscar
  // texto em outro idioma no SSR.
  useEffect(() => {
    const stored = readStoredLocale();
    if (stored) setLocaleState((current) => (stored === current ? current : stored));
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
  }, []);

  useEffect(() => {
    applyDocumentLocale(locale, LOCALE_META[locale]?.intl ?? LOCALE_META[DEFAULT_LOCALE].intl);
  }, [locale]);

  const value = useMemo(() => buildValue(locale, setLocale), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Contexto padrão (fora do provider, ex.: boundary de erro do root).
 * Mantém a interface em português em vez de quebrar a tela.
 */
const fallbackValue = buildValue(DEFAULT_LOCALE, () => {});

/** Hook de tradução. Funciona mesmo fora do provider (usa pt-BR). */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext) ?? fallbackValue;
}

/** Alias semântico para quem prefere `const { t } = useTranslation()`. */
export const useTranslation = useI18n;
