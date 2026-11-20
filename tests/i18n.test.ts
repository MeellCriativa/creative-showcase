/**
 * Testes do sistema global de idiomas (pt-BR / en / es).
 *
 * Cobrem o motor puro (fallback, interpolação, plural, persistência), a
 * integridade dos três dicionários e a garantia de que toda chave usada nas
 * telas existe de fato — sem React, direto no Node.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_META,
  normalizeLocale,
  type Locale,
} from "../src/i18n/config.ts";
import { messages, messagesByLocale } from "../src/i18n/messages.ts";
import { readStoredLocale, persistLocale } from "../src/i18n/storage.ts";
import {
  flattenMessages,
  getMessage,
  interpolate,
  pluralCategory,
  translate,
  translatePlural,
} from "../src/i18n/translate.ts";

const ROOT = process.cwd();

/** Extrai os placeholders `{{nome}}` de um texto. */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]!).sort();
}

/** Navega em um dicionário por caminho. */
function get(dictionary: unknown, key: string): string | undefined {
  return getMessage(dictionary, key);
}

test("existem exatamente os três idiomas suportados", () => {
  assert.deepEqual([...LOCALES], ["pt-BR", "en", "es"]);
  assert.equal(DEFAULT_LOCALE, "pt-BR");
  assert.deepEqual(Object.keys(messagesByLocale).sort(), ["en", "es", "pt-BR"]);
});

test("cada idioma tem bandeira, nome nativo e locale Intl", () => {
  for (const locale of LOCALES) {
    const meta = LOCALE_META[locale];
    assert.ok(meta.flag.length > 0, `bandeira ausente em ${locale}`);
    assert.ok(meta.nativeName.length > 0, `nome ausente em ${locale}`);
    assert.match(meta.intl, /^[a-z]{2}(-[A-Z]{2})?$/);
  }
  assert.equal(LOCALE_META["pt-BR"].nativeName, "Português");
  assert.equal(LOCALE_META.en.nativeName, "English");
  assert.equal(LOCALE_META.es.nativeName, "Español");
});

test("os três dicionários têm exatamente as mesmas chaves", () => {
  const base = flattenMessages(messages).sort();
  assert.ok(base.length > 300, `esperado dicionário grande, veio ${base.length}`);
  for (const locale of ["en", "es"] as const) {
    const keys = flattenMessages(messagesByLocale[locale]).sort();
    const missing = base.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !base.includes(key));
    assert.deepEqual(missing, [], `chaves sem tradução em ${locale}`);
    assert.deepEqual(extra, [], `chaves extras em ${locale}`);
  }
});

test("nenhuma tradução está vazia ou igual a chave", () => {
  for (const locale of LOCALES) {
    for (const key of flattenMessages(messagesByLocale[locale])) {
      const value = get(messagesByLocale[locale], key);
      assert.ok(value !== undefined, `tradução ausente: ${locale}/${key}`);
      assert.notEqual(value!.trim(), "", `tradução vazia: ${locale}/${key}`);
      assert.notEqual(value, key, `tradução não preenchida: ${locale}/${key}`);
    }
  }
});

test("placeholders de interpolação são idênticos nos três idiomas", () => {
  for (const key of flattenMessages(messages)) {
    const base = placeholders(get(messages, key) ?? "");
    for (const locale of ["en", "es"] as const) {
      const other = placeholders(get(messagesByLocale[locale], key) ?? "");
      assert.deepEqual(other, base, `placeholders divergentes em ${locale}/${key}`);
    }
  }
});

test("inglês e espanhol realmente traduzem (não copiam o português)", () => {
  // Amostras cujo texto muda nos dois idiomas (palavras como "Idioma" são
  // iguais em pt e es por natureza, então não servem de prova).
  const samples = ["panel.nav.products", "auth.title", "common.backHome", "common.tryAgain"];
  for (const key of samples) {
    const pt = get(messages, key);
    assert.ok(pt);
    const en = get(messagesByLocale.en, key);
    const es = get(messagesByLocale.es, key);
    assert.notEqual(en, pt, `inglês igual ao português em ${key}`);
    assert.notEqual(es, pt, `espanhol igual ao português em ${key}`);
  }

  // Prova de cobertura: a maioria das chaves precisa diferir do português.
  const keys = flattenMessages(messages);
  const untranslated = keys.filter((key) => get(messagesByLocale.en, key) === get(messages, key));
  assert.ok(
    untranslated.length / keys.length < 0.2,
    `inglês parece não traduzido em ${untranslated.length}/${keys.length} chaves`,
  );
});

test("normaliza valores já salvos sem detectar o navegador", () => {
  assert.equal(normalizeLocale("pt-BR"), "pt-BR");
  assert.equal(normalizeLocale("pt"), "pt-BR");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("es-419"), "es");
  assert.equal(normalizeLocale("fr"), null);
  assert.equal(normalizeLocale(""), null);
  assert.equal(normalizeLocale(null), null);
});

test("translate usa o idioma atual", () => {
  assert.equal(
    translate({
      locale: "en",
      dictionary: messagesByLocale.en,
      fallback: messages,
      key: "auth.title",
    }),
    "Sign in",
  );
  assert.equal(
    translate({
      locale: "es",
      dictionary: messagesByLocale.es,
      fallback: messages,
      key: "auth.title",
    }),
    "Iniciar sesión",
  );
  assert.equal(
    translate({
      locale: "pt-BR",
      dictionary: messagesByLocale["pt-BR"],
      fallback: messages,
      key: "auth.title",
    }),
    "Entrar",
  );
});

test("tradução ausente cai no português (fallback)", () => {
  const partial = { auth: { title: "Sign in" } };
  const value = translate({
    locale: "en",
    dictionary: partial,
    fallback: messages,
    key: "auth.subtitle",
  });
  assert.equal(value, get(messages, "auth.subtitle"));
});

test("chave inexistente devolve a própria chave (nunca quebra)", () => {
  const value = translate({
    locale: "en",
    dictionary: messagesByLocale.en,
    fallback: messages,
    key: "auth.chaveQueNaoExiste",
  });
  assert.equal(value, "auth.chaveQueNaoExiste");
});

test("interpolação substitui variáveis e preserva as desconhecidas", () => {
  assert.equal(interpolate("Olá, {{name}}!", { name: "Ana" }), "Olá, Ana!");
  assert.equal(interpolate("{{a}} + {{b}}", { a: 1, b: 2 }), "1 + 2");
  assert.equal(interpolate("{{a}} e {{b}}", { a: 1 }), "1 e {{b}}");
  assert.equal(interpolate("sem variáveis", {}), "sem variáveis");
  assert.equal(interpolate("{{ name }}", { name: "x" }), "x");
});

test("plural escolhe a forma do idioma", () => {
  assert.equal(pluralCategory("en", 1), "one");
  assert.equal(pluralCategory("en", 2), "other");
  assert.equal(pluralCategory("es", 1), "one");
  assert.equal(pluralCategory("es", 3), "other");
  assert.equal(pluralCategory("pt-BR", 2), "other");
});

test("translatePlural injeta o count e cai em other", () => {
  assert.equal(
    translatePlural({
      locale: "en",
      dictionary: messagesByLocale.en,
      fallback: messages,
      key: "common.itemsCount",
      count: 1,
    }),
    "1 item",
  );
  assert.equal(
    translatePlural({
      locale: "en",
      dictionary: messagesByLocale.en,
      fallback: messages,
      key: "common.itemsCount",
      count: 4,
    }),
    "4 items",
  );
  assert.equal(
    translatePlural({
      locale: "es",
      dictionary: messagesByLocale.es,
      fallback: messages,
      key: "common.daysCount",
      count: 3,
    }),
    "3 días",
  );
});

test("plural sem a categoria do idioma usa other", () => {
  const dictionary = { x: { count: { one: "um", other: "vários" } } };
  const value = translatePlural({
    locale: "pt-BR",
    dictionary,
    fallback: dictionary,
    key: "x.count",
    count: 7,
  });
  assert.equal(value, "vários");
});

test("plural com interpolação extra", () => {
  const dictionary = {
    x: { count: { one: "{{count}} item de {{store}}", other: "{{count}} itens de {{store}}" } },
  };
  const value = translatePlural({
    locale: "pt-BR",
    dictionary,
    fallback: dictionary,
    key: "x.count",
    count: 2,
    values: { store: "Ana" },
  });
  assert.equal(value, "2 itens de Ana");
});

test("persistência: salva e lê o idioma sem login", () => {
  const store = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  };
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { window?: unknown }).window = fakeWindow;
  (globalThis as { document?: unknown }).document = { cookie: "" };

  try {
    assert.equal(readStoredLocale(), null, "primeiro acesso começa no padrão");
    persistLocale("en");
    assert.equal(store.get("vitrine.locale"), "en");
    assert.equal(readStoredLocale(), "en");
    persistLocale("es");
    assert.equal(readStoredLocale(), "es");
    persistLocale("pt-BR");
    assert.equal(readStoredLocale(), "pt-BR");
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
    (globalThis as { document?: unknown }).document = previousDocument;
  }
});

test("preferência salva inválida não vira idioma aleatório", () => {
  const store = new Map<string, string>([["vitrine.locale", "fr-FR"]]);
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousDocument = (globalThis as { document?: unknown }).document;
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: () => {},
    },
  };
  (globalThis as { document?: unknown }).document = { cookie: "" };
  try {
    assert.equal(readStoredLocale(), null);
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
    (globalThis as { document?: unknown }).document = previousDocument;
  }
});

test("o sistema de idioma nunca detecta o idioma do navegador", () => {
  const files = [
    "src/i18n/config.ts",
    "src/i18n/storage.ts",
    "src/i18n/context.tsx",
    "src/i18n/translate.ts",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.equal(
      /navigator\.(language|languages)/.test(source),
      false,
      `${file} não pode detectar o idioma do navegador`,
    );
  }
});

test("o idioma inicial vem do cookie, no servidor e no cliente", () => {
  const root = fs.readFileSync(path.join(ROOT, "src/routes/__root.tsx"), "utf8");
  assert.match(root, /createIsomorphicFn\(\)/, "o root precisa separar cliente e servidor");
  assert.match(root, /\.client\(/, "cliente resolve o idioma do cookie do documento");
  assert.match(root, /\.server\(/, "servidor resolve o idioma do cookie da requisição");
  assert.match(root, /readLocaleCookie\(\)/, "cliente lê o cookie");
  assert.match(root, /readServerLocale\(\)/, "servidor lê o cookie da requisição");
  assert.match(root, /initialLocale/, "o idioma resolvido alimenta o provider");
  assert.equal(/navigator\.(language|languages)/.test(root), false);

  const serverModule = fs.readFileSync(path.join(ROOT, "src/i18n/server-locale.server.ts"), "utf8");
  assert.match(serverModule, /getCookie\(LOCALE_COOKIE\)/, "SSR lê o cookie de idioma");
  assert.match(serverModule, /normalizeLocale/, "valor inválido não vira idioma aleatório");

  const storage = fs.readFileSync(path.join(ROOT, "src/i18n/storage.ts"), "utf8");
  assert.match(storage, /document\.cookie/, "o cookie é compartilhado entre SSR e cliente");
  assert.match(storage, /export function readLocaleCookie/, "leitura isolada do cookie");
});

test("toda chave usada nas telas existe nos três idiomas", () => {
  const directories = ["src/routes", "src/components", "src/i18n"];
  const files = directories.flatMap((dir) =>
    fs
      .readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(tsx|ts)$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath ?? path.join(ROOT, dir), entry.name)),
  );

  const used = new Set<string>();
  const usedPlural = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?<![A-Za-z0-9_.])t\(\s*["']([^"']+)["']/g)) {
      used.add(match[1]!);
    }
    for (const match of source.matchAll(/(?<![A-Za-z0-9_.])tp\(\s*["']([^"']+)["']/g)) {
      usedPlural.add(match[1]!);
    }
  }

  assert.ok(used.size > 50, `esperado uso amplo de t(), veio ${used.size}`);

  const missing: string[] = [];
  for (const key of used) {
    if (!getMessage(messages, key)) missing.push(`pt-BR:${key}`);
    for (const locale of ["en", "es"] as Locale[]) {
      if (!getMessage(messagesByLocale[locale], key)) missing.push(`${locale}:${key}`);
    }
  }
  for (const key of usedPlural) {
    for (const locale of LOCALES) {
      if (!getMessage(messagesByLocale[locale], `${key}.other`)) {
        missing.push(`${locale}:${key}.other`);
      }
    }
  }

  assert.deepEqual([...new Set(missing)].sort(), [], "chaves usadas e não traduzidas");
});

test("a mensagem de pedido no WhatsApp usa rótulos traduzíveis", () => {
  const route = fs.readFileSync(path.join(ROOT, "src/routes/c.$slug.tsx"), "utf8");
  assert.match(route, /buildWhatsappMessage\(/, "o catálogo deve montar a mensagem do pedido");
  for (const key of [
    "intro",
    "product",
    "quantity",
    "unitPrice",
    "subtotal",
    "orderTotal",
    "closing",
  ]) {
    assert.match(
      route,
      new RegExp(`catalog\\.whatsapp\\.message\\.${key}`),
      `rótulo ${key} da mensagem do WhatsApp precisa vir do i18n`,
    );
  }
  // Nomes de produtos e valores continuam vindo dos dados (não do dicionário).
  assert.match(route, /name: i\.name/);

  const lib = fs.readFileSync(path.join(ROOT, "src/lib/catalog.ts"), "utf8");
  assert.match(lib, /DEFAULT_WHATSAPP_LABELS/, "padrão em português preservado");
  assert.match(
    lib,
    /labels\?: Partial<WhatsappMessageLabels>/,
    "rótulos opcionais (retrocompatível)",
  );
});

test("o seletor de idioma está no topo do painel", () => {
  const layout = fs.readFileSync(path.join(ROOT, "src/routes/painel.tsx"), "utf8");
  assert.match(layout, /LanguageSelector/, "painel.tsx deve renderizar o seletor");
  const headerIndex = layout.indexOf("<header");
  const selectorIndex = layout.indexOf("<LanguageSelector");
  assert.ok(headerIndex > -1, "painel.tsx deve ter um header de primeira linha");
  assert.ok(selectorIndex > headerIndex, "o seletor deve estar dentro da primeira linha");
});

test("idioma e moeda continuam independentes", () => {
  const currency = fs.readFileSync(path.join(ROOT, "src/lib/currency.ts"), "utf8");
  assert.equal(/from ["']@\/i18n/.test(currency), false, "currency.ts não pode depender de i18n");
  assert.equal(/vitrine\.locale/.test(currency), false, "currency.ts não pode ler o idioma");
  const i18nFiles = ["src/i18n/config.ts", "src/i18n/context.tsx", "src/i18n/translate.ts"];
  for (const file of i18nFiles) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.equal(
      /USD|EUR/.test(source),
      false,
      `${file} não pode escolher moeda a partir do idioma`,
    );
  }
});

test("as telas principais usam o sistema de i18n", () => {
  const screens = [
    "src/routes/__root.tsx",
    "src/routes/index.tsx",
    "src/routes/auth.tsx",
    "src/routes/painel.tsx",
    "src/routes/painel.index.tsx",
    "src/routes/painel.produtos.tsx",
    "src/routes/painel.categorias.tsx",
    "src/routes/painel.pedidos.tsx",
    "src/routes/painel.estatisticas.tsx",
    "src/routes/painel.personalizar.tsx",
    "src/routes/painel.pagamentos.tsx",
    "src/routes/painel.envio.tsx",
    "src/routes/painel.whatsapp.tsx",
    "src/routes/painel.conversor.tsx",
    "src/routes/painel.senha.tsx",
    "src/routes/c.$slug.tsx",
  ];
  for (const file of screens) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(source, /useI18n/, `${file} precisa usar useI18n`);
  }
});
