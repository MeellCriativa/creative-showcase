/**
 * Tipagem do dicionário.
 *
 * Cada arquivo em `src/i18n/namespaces` declara o texto em português e é
 * OBRIGADO pelo TypeScript a fornecer as mesmas chaves em inglês e espanhol.
 * Assim uma tradução esquecida quebra o `tsc`, e não o usuário.
 */

/** Mantém as chaves, mas aceita qualquer texto (não exige o mesmo literal). */
export type DeepStrings<T> = {
  [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]>;
};

export type LocaleMessages<Pt> = {
  /** Português é a fonte da verdade: define as chaves. */
  ptBR: Pt;
  en: DeepStrings<Pt>;
  es: DeepStrings<Pt>;
};

/**
 * Declara um namespace de traduções.
 *
 * As chaves de `ptBR` definem o contrato; `en` e `es` precisam ter exatamente
 * as mesmas chaves (inclusive grupos plurais como `{ one, other }`).
 */
export function defineNamespace<Pt extends Record<string, unknown>>(
  input: LocaleMessages<Pt>,
): LocaleMessages<Pt> {
  return input;
}

/** Caminhos "a.b.c" de todos os textos de um dicionário. */
export type MessagePaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${MessagePaths<T[K]>}`;
}[keyof T & string];

/**
 * Caminhos "a.b" dos grupos plurais (nós que possuem `other`).
 *
 * O sufixo de plural (`one`, `other`, `many`…) é resolvido em runtime por
 * `Intl.PluralRules`, então só a base é tipada.
 */
export type PluralPaths<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? never
    : T[K] extends Record<string, string>
      ? "other" extends keyof T[K]
        ? `${Prefix}${K}`
        : never
      : PluralPaths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Valores aceitos na interpolação `{{nome}}`. */
export type InterpolationValues = Record<string, string | number | null | undefined>;
