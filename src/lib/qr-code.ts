import QRCode from "qrcode";

import { SITE_URL } from "./site.ts";

/**
 * Largura do PNG gerado para download. Em 1600 px o módulo do QR Code mantém
 * folga mesmo quando a impressão é reduzida a um cartão de visita.
 */
export const QR_PNG_WIDTH = 1600;

export type QrUrlValidation =
  { ok: true; url: string } | { ok: false; reason: "empty" | "invalid" };

/**
 * Aceita somente URLs absolutas http(s). Isso impede que um QR Code aponte para
 * esquemas locais (`javascript:`, `data:`) e garante que o celular consiga abrir
 * o endereço diretamente.
 */
export function normalizeQrUrl(value: string): QrUrlValidation {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, reason: "empty" };

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "invalid" };
    }
    if (!parsed.hostname) return { ok: false, reason: "invalid" };
    return { ok: true, url: parsed.href };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** Monta o link público canônico da loja a partir do slug salvo no catálogo. */
export function buildStoreQrUrl(slug: string): string {
  const clean = String(slug ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const origin = SITE_URL.replace(/\/+$/, "");
  return clean ? `${origin}/c/${encodeURIComponent(clean)}` : origin;
}

/**
 * Gera o QR Code inteiramente no navegador. Não há requisição de rede,
 * rastreamento nem parâmetro adicional: o conteúdo codificado é exatamente a
 * URL informada.
 */
export async function generateQrPngDataUrl(url: string, width = QR_PNG_WIDTH): Promise<string> {
  return QRCode.toDataURL(url, {
    type: "image/png",
    errorCorrectionLevel: "H",
    margin: 4,
    width,
    color: {
      dark: "#1C1230",
      light: "#FFFFFF",
    },
  });
}

export type QrDownloadDocument = {
  createElement(tagName: "a"): {
    href: string;
    download: string;
    rel: string;
    click(): void;
  };
  body: {
    appendChild(node: unknown): void;
    removeChild(node: unknown): void;
  };
};

/** Dispara o download do PNG gerado, sem persistir nada em banco ou servidor. */
export function downloadQrPng(dataUrl: string, fileName: string, target: QrDownloadDocument): void {
  const anchor = target.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  target.body.appendChild(anchor);
  anchor.click();
  target.body.removeChild(anchor);
}
