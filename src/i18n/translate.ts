/**
 * Motor de tradução (puro, sem React e sem DOM).
 *
 * - busca por caminho (`"panel.nav.products"`);
 * - fallback para português quando a chave não existe no idioma atual;
 * - fallback final: a própria chave (nunca quebra a tela);
 * - interpolação `{{nome}}`;
 * - pluralização com `Intl.PluralRules` (`one`, `other`, `many`…).
 *
 * Mantido sem dependências para ser testado diretamente no Node.
 */
import { DEFAULT_LOCALE, LOCALE_META, type Locale } from "./config.ts";
import type { InterpolationValues } from "./types.ts";

/** Busca um texto por caminho. Retorna `undefined` para nó inexistente ou não-texto. */
export function getMessage(dictionary: unknown, path: string): string | undefined {
  if (!dictionary || typeof dictionary !== "object") return undefined;
  let node: unknown = dictionary;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Substitui `{{variavel}}` pelos valores informados.
 *
 * Variáveis ausentes ficam como estão (visível para depuração, sem quebrar a
 * frase) e nunca produzem `undefined` na tela.
 */
export function interpolate(template: string, values?: InterpolationValues): string {
  if (!values) return template;
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, name: string) => {
    const value = values[name];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

export type TranslateOptions = {
  /** Idioma atual. */
  locale: Locale;
  /** Dicionário do idioma atual. */
  dictionary: unknown;
  /** Dicionário de fallback (português). */
  fallback: unknown;
  /** Caminho da tradução. */
  key: string;
  /** Valores de interpolação. */
  values?: InterpolationValues | undefined;
};

/** Traduz uma chave simples (sem plural). */
export function translate({ locale, dictionary, fallback, key, values }: TranslateOptions): string {
  const current = getMessage(dictionary, key);
  if (current !== undefined && current !== "") return interpolate(current, values);
  const fallbackText = getMessage(fallback, key);
  if (fallbackText !== undefined && fallbackText !== "") return interpolate(fallbackText, values);
  // Chave ausente: mostra a chave em vez de quebrar a interface.
  return key;
}

/** Categoria de plural do idioma (`one`, `other`, `many`…). */
export function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  const intl = LOCALE_META[locale]?.intl ?? LOCALE_META[DEFAULT_LOCALE].intl;
  try {
    return new Intl.PluralRules(intl).select(count);
  } catch {
    return count === 1 ? "one" : "other";
  }
}

/**
 * Traduz uma chave plural.
 *
 * A base aponta para um grupo `{ one, other, many… }`; se a categoria do idioma
 * não existir, usa `other`; se o grupo inteiro não existir, devolve a chave.
 * `{{count}}` é sempre injetado automaticamente.
 */
export function translatePlural(
  options: Omit<TranslateOptions, "key"> & { key: string; count: number },
): string {
  const { key, count, values, locale } = options;
  const category = pluralCategory(locale, count);
  const merged: InterpolationValues = { count, ...values };
  for (const candidate of [`${key}.${category}`, `${key}.other`]) {
    const text = translate({ ...options, key: candidate, values: merged });
    if (text !== candidate) return text;
  }
  return translate({ ...options, key, values: merged });
}

/** Lista as chaves de texto (caminhos completos) de um dicionário. */
export function flattenMessages(dictionary: unknown, prefix = ""): string[] {
  if (!dictionary || typeof dictionary !== "object") return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(dictionary as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") keys.push(path);
    else if (value && typeof value === "object") keys.push(...flattenMessages(value, path));
  }
  return keys;
}
