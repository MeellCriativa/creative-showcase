/**
 * Otimização global de imagens sem reprocessar ou duplicar arquivos.
 *
 * As imagens do catálogo são salvas como URLs assinadas do Supabase Storage.
 * O Storage já expõe um endpoint de renderização sob demanda (ImgProxy), que
 * converte para WebP, redimensiona e remove metadados mantendo a proporção.
 * Derivamos a URL otimizada no momento da leitura, então vale para produtos
 * antigos e novos, em todas as lojas, sem tocar no banco nem no Storage.
 *
 * Se a URL não for uma imagem do bucket `catalog-images`, devolvemos a original
 * (pix QR, arquivos digitais, data URLs e links externos ficam intactos).
 */

const STORAGE_OBJECT_PATH = /^\/storage\/v1\/object\/(?:sign|public)\/catalog-images\/(.+)$/;
const RENDER_PATH = /^\/storage\/v1\/render\/image\//;

/** Larguras usadas nas vitrines (em pixels). */
export const IMAGE_WIDTHS = {
  thumb: 400,
  card: 800,
  detail: 1200,
} as const;

/** Qualidade padrão: boa relação tamanho/qualidade para fotos de produto. */
export const IMAGE_QUALITY = 82;
const MIN_WIDTH = 16;
const MAX_WIDTH = 2400;

function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Retorna o caminho do objeto dentro de `catalog-images`, ou null quando a URL
 * não é uma imagem desse bucket (não otimizamos outros tipos de arquivo).
 */
function catalogImagePath(url: string): { origin: string; path: string } | null {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    if (RENDER_PATH.test(parsed.pathname)) return null; // já otimizada
    const match = STORAGE_OBJECT_PATH.exec(parsed.pathname);
    if (!match?.[1]) return null;

    const segments = match[1].split("/").map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
    return { origin: parsed.origin, path: segments.map(encodeURIComponent).join("/") };
  } catch {
    return null;
  }
}

/** Constrói a URL de renderização WebP para uma largura específica. */
export function optimizedImageUrl(
  url: string | null | undefined,
  width: number = IMAGE_WIDTHS.detail,
  quality: number = IMAGE_QUALITY,
): string | null {
  if (!url) return null;
  const found = catalogImagePath(url);
  if (!found) return null;
  const w = clamp(width, MIN_WIDTH, MAX_WIDTH, IMAGE_WIDTHS.detail);
  const q = clamp(quality, 1, 100, IMAGE_QUALITY);
  // `resize=contain` é obrigatório: sem ele o Storage usa `cover` e, com só
  // `width`, devolve uma faixa (ex.: 400x1254 de um original 1254x1254),
  // fazendo a miniatura parecer ampliada. Com `contain` a proporção é mantida
  // e o CSS `object-cover` continua recortando como antes da otimização.
  return `${found.origin}/storage/v1/render/image/public/catalog-images/${found.path}?width=${w}&resize=contain&format=webp&quality=${q}`;
}

/** `srcSet` com várias larguras para o navegador escolher conforme o dispositivo. */
export function optimizedImageSrcSet(
  url: string | null | undefined,
  widths: readonly number[] = [IMAGE_WIDTHS.thumb, IMAGE_WIDTHS.card, IMAGE_WIDTHS.detail],
  quality: number = IMAGE_QUALITY,
): string | null {
  if (!url) return null;
  const entries = widths
    .map((width) => {
      const optimized = optimizedImageUrl(url, width, quality);
      return optimized ? `${optimized} ${width}w` : null;
    })
    .filter((entry): entry is string => Boolean(entry));
  return entries.length ? entries.join(", ") : null;
}

/**
 * Handler de `onError`: se a versão otimizada falhar (por exemplo, num projeto
 * onde o render público não está disponível), voltamos à URL original salva.
 */
export function imageFallback(original: string | null | undefined) {
  return (event: {
    currentTarget: { src: string; dataset: Record<string, string | undefined> };
  }) => {
    if (!original) return;
    const element = event.currentTarget;
    if (element.dataset["imageFallbackApplied"]) return;
    element.dataset["imageFallbackApplied"] = "true";
    element.src = original;
  };
}
