/** Helpers para campos de valor digitados com vírgula decimal (pt-BR). */

/** Converte o texto digitado em número; retorna NaN para entrada incompleta/inválida. */
export function parseDecimalInput(raw: string): number {
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (normalized === "" || !/^\d*\.?\d*$/.test(normalized)) return Number.NaN;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** Normaliza o valor ao sair do campo, preservando a vírgula decimal. */
export function normalizeDecimalInput(raw: string): string {
  const value = parseDecimalInput(raw);
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toFixed(2).replace(".", ",");
}
