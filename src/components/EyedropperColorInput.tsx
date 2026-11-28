import { useEffect, useRef, useState } from "react";
import { Pipette, X } from "lucide-react";

import { useI18n } from "@/i18n";

type EyeDropperLike = new () => { open: () => Promise<{ sRGBHex: string }> };

function nativeEyeDropper(): EyeDropperLike | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { EyeDropper?: EyeDropperLike }).EyeDropper ?? null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((value) =>
      Math.max(0, Math.min(255, Math.round(value)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Converte qualquer cor CSS (incluindo oklch, usado pelo tema) em #rrggbb. */
function cssToHex(css: string): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    const r = data[0] ?? 0;
    const g = data[1] ?? 0;
    const b = data[2] ?? 0;
    const a = data[3] ?? 0;
    return a > 0 ? rgbToHex(r, g, b) : null;
  } catch {
    return null;
  }
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(src: string): Promise<HTMLImageElement | null> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

/** Mapeia o ponto tocado para a imagem, respeitando object-fit cover/contain. */
async function colorFromImage(image: HTMLImageElement, rect: DOMRect, x: number, y: number) {
  if (!image.naturalWidth || !image.naturalHeight || !rect.width || !rect.height) return null;
  const fit = getComputedStyle(image).objectFit;
  const scale =
    fit === "contain"
      ? Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight)
      : Math.max(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const shownWidth = image.naturalWidth * scale;
  const shownHeight = image.naturalHeight * scale;
  const [posX, posY] = getComputedStyle(image).objectPosition.split(/\s+/);
  const percentX = posX?.endsWith("%") ? parseFloat(posX) / 100 : 0.5;
  const percentY = posY?.endsWith("%") ? parseFloat(posY) / 100 : 0.5;
  const offsetX = (rect.width - shownWidth) * percentX;
  const offsetY = (rect.height - shownHeight) * percentY;
  const px = Math.round((x - rect.left - offsetX) / scale);
  const py = Math.round((y - rect.top - offsetY) / scale);
  if (px < 0 || py < 0 || px >= image.naturalWidth || py >= image.naturalHeight) return null;

  const sources = [image, await loadImage(image.src)];
  for (const source of sources) {
    if (!source || source.naturalWidth !== image.naturalWidth) continue;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) continue;
      ctx.drawImage(source, 0, 0);
      const data = ctx.getImageData(px, py, 1, 1).data;
      const r = data[0] ?? 0;
      const g = data[1] ?? 0;
      const b = data[2] ?? 0;
      const a = data[3] ?? 0;
      if (a > 0) return rgbToHex(r, g, b);
    } catch {
      // Imagem de outra origem sem CORS: tenta a cópia com crossOrigin.
    }
  }
  return null;
}

async function sampleAt(x: number, y: number): Promise<string | null> {
  const element = document.elementFromPoint(x, y);
  if (!element) return null;

  if (element instanceof HTMLImageElement) {
    const fromImage = await colorFromImage(element, element.getBoundingClientRect(), x, y);
    if (fromImage) return fromImage;
  }

  const bgUrl = getComputedStyle(element).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
  if (bgUrl) {
    const image = await loadImage(bgUrl);
    if (image) {
      const fromBg = await colorFromImage(image, element.getBoundingClientRect(), x, y);
      if (fromBg) return fromBg;
    }
  }

  let node: Element | null = element;
  while (node) {
    const fromBg = cssToHex(getComputedStyle(node).backgroundColor);
    if (fromBg) return fromBg;
    node = node.parentElement;
  }
  return cssToHex(getComputedStyle(element).color);
}

type Props = {
  value: string;
  onChange: (color: string) => void;
  label: string;
  /** Usa o formato circular do seletor de cor do botão WhatsApp. */
  round?: boolean;
};

export function EyedropperColorInput({ value, onChange, label, round = false }: Props) {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number; color: string } | null>(null);
  const onChangeRef = useRef(onChange);
  const cancelRef = useRef<HTMLButtonElement>(null);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!picking) return;

    const onMove = (event: PointerEvent) => {
      void sampleAt(event.clientX, event.clientY).then((color) => {
        setHover(color ? { x: event.clientX, y: event.clientY, color } : null);
      });
    };
    const onDown = (event: PointerEvent) => {
      if (cancelRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      void sampleAt(event.clientX, event.clientY).then((color) => {
        if (color) onChangeRef.current(color);
        setPicking(false);
        setHover(null);
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPicking(false);
        setHover(null);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { capture: true });
    window.addEventListener("keydown", onKey);
    document.body.style.cursor = "crosshair";
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, { capture: true });
      window.removeEventListener("keydown", onKey);
      document.body.style.cursor = "";
    };
  }, [picking]);

  async function startPicking() {
    const EyeDropper = nativeEyeDropper();
    if (EyeDropper) {
      try {
        const result = await new EyeDropper().open();
        onChange(result.sRGBHex);
        return;
      } catch {
        // Usuário cancelou o conta-gotas nativo.
        return;
      }
    }
    setPicking(true);
  }

  const swatchClass = round
    ? "size-7 cursor-pointer rounded-full border border-border bg-card p-0"
    : "size-8 cursor-pointer rounded-lg border border-border bg-card p-0";
  const buttonClass = round
    ? "grid size-7 place-items-center rounded-full border border-border bg-card text-foreground"
    : "grid size-8 place-items-center rounded-lg border border-border bg-card text-foreground";

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <input
          type="color"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#ffffff"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
          className={swatchClass}
        />
        <button
          type="button"
          onClick={() => void startPicking()}
          aria-label={t("customize.colors.eyedropper")}
          title={t("customize.colors.eyedropper")}
          className={buttonClass}
        >
          <Pipette className="size-4" />
        </button>
      </span>

      {picking && (
        <div className="pointer-events-none fixed inset-0 z-[100]">
          <div className="absolute inset-x-0 top-0 flex justify-center p-3">
            <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-foreground px-4 py-2 text-center text-xs font-semibold text-background shadow-lg">
              <span>{t("customize.colors.eyedropperHint")}</span>
              <button
                ref={cancelRef}
                type="button"
                onClick={() => {
                  setPicking(false);
                  setHover(null);
                }}
                aria-label={t("customize.colors.eyedropperCancel")}
                className="grid size-5 shrink-0 place-items-center rounded-full bg-background/20"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          {hover && (
            <div
              className="absolute flex -translate-x-1/2 -translate-y-[calc(100%+14px)] items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-[10px] font-semibold text-foreground shadow-md"
              style={{ left: hover.x, top: hover.y }}
            >
              <span
                className="size-3 rounded-full border border-border"
                style={{ background: hover.color }}
              />
              {hover.color}
            </div>
          )}
        </div>
      )}
    </>
  );
}
