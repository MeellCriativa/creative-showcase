/**
 * Leitura do idioma salvo durante o SSR.
 *
 * Este arquivo só existe no servidor (sufixo `.server.ts`): o Vite o remove do
 * bundle do cliente, então o import de `@tanstack/react-start/server` fica
 * isolado aqui. No cliente o mesmo valor vem de `readLocaleCookie()`.
 */
import { getCookie } from "@tanstack/react-start/server";

import { LOCALE_COOKIE, normalizeLocale, type Locale } from "./config.ts";

/** Idioma salvo no cookie da requisição (ou `null` se não houver/for inválido). */
export function readServerLocale(): Locale | null {
  try {
    return normalizeLocale(getCookie(LOCALE_COOKIE));
  } catch {
    // Sem contexto de requisição (ex.: pré-render): usa o padrão.
    return null;
  }
}
