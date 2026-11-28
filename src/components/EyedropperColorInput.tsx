import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Pipette, X } from "lucide-react";

import { useI18n } from "@/i18n";

type EyeDropperLike = new () => { open: () => Promise<{ sRGBHex: string }> };
type Mode = "idle" | "page" | "camera";
type Hover = { x: number; y: number; color: string };

function nativeEyeDropper(): EyeDropperLike | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { EyeDropper?: EyeDropperLike }).EyeDropper ?? null;
}

/** Celulares não têm a API EyeDropper: neles usamos a câmera como conta-gotas. */
function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches === true;
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

/** Lê a cor de um ponto do vídeo da câmera, respeitando object-fit: cover. */
function sampleVideo(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): string | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const rect = video.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const scale = Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight);
  const shownWidth = video.videoWidth * scale;
  const shownHeight = video.videoHeight * scale;
  const px = Math.floor((x - rect.left - (rect.width - shownWidth) / 2) / scale);
  const py = Math.floor((y - rect.top - (rect.height - shownHeight) / 2) / scale);
  if (px < 0 || py < 0 || px >= video.videoWidth || py >= video.videoHeight) return null;

  if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
  if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0);
    const data = ctx.getImageData(px, py, 1, 1).data;
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
  const px = Math.round(x - rect.left - offsetX) / scale;
  const py = Math.round(y - rect.top - offsetY) / scale;
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
  const [mode, setMode] = useState<Mode>("idle");
  const [hover, setHover] = useState<Hover | null>(null);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const onChangeRef = useRef(onChange);
  const hoverRef = useRef<Hover | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  onChangeRef.current = onChange;
  hoverRef.current = hover;

  function finish(color?: string) {
    if (color) onChangeRef.current(color);
    setMode("idle");
    setHover(null);
    setCameraUnavailable(false);
  }

  // Câmera: mantém o stream vivo e atualiza a lupa com a cor sob o ponto tocado.
  useEffect(() => {
    if (mode !== "camera") return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    const canvas = document.createElement("canvas");
    canvasRef.current = canvas;
    let last = 0;
    const tick = (time: number) => {
      const point = hoverRef.current;
      if (point && time - last > 90) {
        const color = sampleVideo(video, canvas, point.x, point.y);
        if (color && color !== point.color) setHover((prev) => (prev ? { ...prev, color } : prev));
        last = time;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      canvasRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [mode]);

  // Modo "tela": alternativa quando a câmera não está disponível.
  useEffect(() => {
    if (mode !== "page") return;

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
        finish(color ?? undefined);
      });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish();
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
  }, [mode]);

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

    setCameraUnavailable(false);
    if (isTouchDevice()) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        streamRef.current = stream;
        setMode("camera");
        return;
      } catch {
        // Sem permissão ou sem câmera: cai para o conta-gotas na tela do painel.
        setCameraUnavailable(true);
      }
    }
    setMode("page");
  }

  function cameraColorAt(x: number, y: number): string | null {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    return video && canvas ? sampleVideo(video, canvas, x, y) : null;
  }

  function onCameraMove(event: ReactPointerEvent<HTMLDivElement>) {
    const color = cameraColorAt(event.clientX, event.clientY);
    if (color) setHover({ x: event.clientX, y: event.clientY, color });
  }

  function onCameraDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    finish(cameraColorAt(event.clientX, event.clientY) ?? hoverRef.current?.color);
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

      {mode === "camera" && (
        <div
          className="fixed inset-0 z-[101] select-none bg-black"
          style={{ touchAction: "none" }}
          onPointerMove={onCameraMove}
          onPointerDown={onCameraDown}
        >
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="size-14 rounded-full border-2 border-white/90 shadow-lg" />
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
            <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-center text-xs font-semibold text-white shadow-lg">
              <span>{t("customize.colors.eyedropperCameraHint")}</span>
              <button
                type="button"
                onClick={() => finish()}
                aria-label={t("customize.colors.eyedropperCancel")}
                className="grid size-5 shrink-0 place-items-center rounded-full bg-white/20"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-4">
            <button
              type="button"
              onClick={() => {
                setMode("page");
                setHover(null);
              }}
              className="pointer-events-auto rounded-full bg-black/70 px-4 py-2 text-xs font-semibold text-white shadow-lg"
            >
              {t("customize.colors.eyedropperUseScreen")}
            </button>
          </div>
          {hover && (
            <div
              className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-[calc(100%+60px)] items-center gap-1.5 rounded-full border border-white/30 bg-black/75 px-2 py-1 text-[11px] font-semibold text-white shadow-md"
              style={{ left: hover.x, top: hover.y }}
            >
              <span
                className="size-4 rounded-full border border-white/50"
                style={{ background: hover.color }}
              />
              {hover.color}
            </div>
          )}
        </div>
      )}

      {mode === "page" && (
        <div className="pointer-events-none fixed inset-0 z-[100]">
          <div className="absolute inset-x-0 top-0 flex justify-center p-3">
            <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-foreground px-4 py-2 text-center text-xs font-semibold text-background shadow-lg">
              <span>
                {t(
                  cameraUnavailable
                    ? "customize.colors.eyedropperFallbackHint"
                    : "customize.colors.eyedropperHint",
                )}
              </span>
              <button
                ref={cancelRef}
                type="button"
                onClick={() => finish()}
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
