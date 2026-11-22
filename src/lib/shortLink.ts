/** Códigos curtos das lojas (/s/CODIGO). */

export const SHORT_CODE_MIN = 3;
export const SHORT_CODE_MAX = 24;

/** Rotas do app que não podem virar código curto. */
const RESERVED_CODES = new Set([
  "c",
  "s",
  "auth",
  "api",
  "functions",
  "painel",
  "assets",
  "admin",
  "www",
  "sobre",
  "contato",
]);

/** Aceita acentos e espaços, devolvendo um código seguro para URL. */
export function normalizeShortCode(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SHORT_CODE_MAX)
    .replace(/-+$/g, "");
}

export function isValidShortCode(code: string): boolean {
  return (
    code.length >= SHORT_CODE_MIN &&
    code.length <= SHORT_CODE_MAX &&
    /^[a-z0-9-]+$/.test(code) &&
    !RESERVED_CODES.has(code)
  );
}

export function shortLinkUrl(code: string, origin?: string): string {
  const base = (origin ?? (typeof window !== "undefined" ? window.location.origin : "")).replace(
    /\/+$/,
    "",
  );
  return `${base}/s/${code}`;
}
