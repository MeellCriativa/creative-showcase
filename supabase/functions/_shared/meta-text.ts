/**
 * Texto enviado ao catálogo da Meta/WhatsApp.
 *
 * O app WhatsApp não renderiza bem emoji, caracteres de controle e alguns
 * símbolos decorativos vindos da vitrine. Eles viram "códigos estranhos" no
 * catálogo. Aqui limpamos apenas o que é problemático, preservando acentos
 * portugueses (á, é, í, ó, ú, â, ê, ô, ã, õ, ç), que a Meta aceita normalmente.
 */

const STRIP_RANGES: Array<[number, number]> = [
  [0x1f000, 0x1faff], // emoji e pictogramas
  [0x2600, 0x27bf], // dingbats/símbolos miscelâneos
  [0x2b00, 0x2bff], // símbolos e setas decorativas
  [0xfe00, 0xfe0f], // variation selectors
  [0x200b, 0x200f], // caracteres invisíveis (zero width, direção)
  [0x2060, 0x206f], // word joiner e afins
];

const BULLET_TO_DASH = new Set([0x2022, 0x25cf, 0x25aa, 0x2219]);

export function sanitizeForMeta(value: string | null | undefined): string {
  let output = "";
  for (const char of value ?? "") {
    const cp = char.codePointAt(0) ?? 0;
    if (STRIP_RANGES.some(([start, end]) => cp >= start && cp <= end)) continue;
    if (cp === 0x00ad) continue; // soft hyphen
    if (BULLET_TO_DASH.has(cp)) {
      output += "-";
      continue;
    }
    output += char;
  }

  return output
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/^\s+|\s+$/g, "");
}

/** Corta por code point para nunca quebrar um caractere unicode ao meio. */
export function truncateForMeta(value: string, maxLength: number): string {
  const chars = Array.from(value);
  return chars.length <= maxLength ? value : chars.slice(0, maxLength).join("");
}
