/**
 * Ponto único de importação do sistema de idiomas.
 *
 *   import { useI18n, LanguageSelector } from "@/i18n";
 *
 * Os módulos puros (config, translate, messages) também podem ser importados
 * diretamente em testes Node, sem React.
 */
export { DEFAULT_LOCALE, LOCALES, LOCALE_META, isLocale, normalizeLocale } from "./config.ts";
export type { Locale, LocaleMeta } from "./config.ts";
export { I18nProvider, useI18n, useTranslation } from "./context.tsx";
export type { I18nContextValue } from "./context.tsx";
export { LanguageSelector } from "./LanguageSelector.tsx";
export { messages, messagesByLocale } from "./messages.ts";
export type { MessageKey, Messages, PluralMessageKey } from "./messages.ts";
