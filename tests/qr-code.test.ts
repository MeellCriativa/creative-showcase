/**
 * Testes determinísticos do gerador gratuito de QR Code da loja.
 *
 * A prova de conteúdo é feita decodificando o PNG gerado: o QR Code precisa
 * conter exatamente a URL informada, sem parâmetros de rastreamento.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { messages } from "../src/i18n/messages.ts";
import { getMessage } from "../src/i18n/translate.ts";
import { SITE_URL } from "../src/lib/site.ts";
import {
  QR_PNG_WIDTH,
  buildStoreQrUrl,
  downloadQrPng,
  generateQrPngDataUrl,
  normalizeQrUrl,
} from "../src/lib/qr-code.ts";

const ROOT = process.cwd();
const PNG_PREFIX = "data:image/png;base64,";

async function decodedContent(
  dataUrl: string,
): Promise<{ data: string | null; width: number; height: number }> {
  const [{ PNG }, { default: jsQR }] = await Promise.all([import("pngjs"), import("jsqr")]);
  assert.ok(dataUrl.startsWith(PNG_PREFIX), "o download precisa ser um PNG em data URL");
  const png = PNG.sync.read(Buffer.from(dataUrl.slice(PNG_PREFIX.length), "base64"));
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  return { data: result?.data ?? null, width: png.width, height: png.height };
}

test("valida somente URLs absolutas http(s) e devolve a forma canônica", () => {
  assert.deepEqual(normalizeQrUrl("  https://Vitrine.example/c/minha-loja  "), {
    ok: true,
    url: "https://vitrine.example/c/minha-loja",
  });
  assert.deepEqual(normalizeQrUrl("http://localhost:3000/c/loja"), {
    ok: true,
    url: "http://localhost:3000/c/loja",
  });
  for (const value of [
    "",
    "   ",
    "vitrine.example/c/loja",
    "ftp://x.com",
    "javascript:alert(1)",
    "https://",
  ]) {
    assert.equal(normalizeQrUrl(value).ok, false, `não deveria aceitar: ${value}`);
  }
});

test("o link da loja é montado a partir do slug salvo e do domínio público", () => {
  assert.equal(buildStoreQrUrl("minha-loja"), `${SITE_URL}/c/minha-loja`);
  assert.equal(buildStoreQrUrl("  /minha-loja/ "), `${SITE_URL}/c/minha-loja`);
  assert.equal(buildStoreQrUrl("loja com espaço"), `${SITE_URL}/c/loja%20com%20espa%C3%A7o`);
});

test("isolamento entre lojas: cada slug gera um QR distinto e sem estado compartilhado", async () => {
  const urlA = buildStoreQrUrl("loja-a");
  const urlB = buildStoreQrUrl("loja-b");
  assert.notEqual(urlA, urlB);

  const [pngA, pngB] = await Promise.all([
    generateQrPngDataUrl(urlA, 800),
    generateQrPngDataUrl(urlB, 800),
  ]);

  assert.equal((await decodedContent(pngA)).data, urlA);
  assert.equal((await decodedContent(pngB)).data, urlB);
  assert.equal(buildStoreQrUrl("loja-a"), urlA);
});

test("o PNG gerado codifica exatamente o link informado", async () => {
  const url = `${SITE_URL}/c/atelie-da-ana`;
  const dataUrl = await generateQrPngDataUrl(url);
  const decoded = await decodedContent(dataUrl);

  assert.equal(decoded.width, QR_PNG_WIDTH);
  assert.equal(decoded.height, QR_PNG_WIDTH);
  assert.equal(decoded.data, url);
});

test("o QR Code continua legível em tamanho reduzido, como em cartão impresso", async () => {
  const url = `${SITE_URL}/c/loja-com-nome-mais-longo`;
  const dataUrl = await generateQrPngDataUrl(url, 800);
  const decoded = await decodedContent(dataUrl);

  assert.equal(decoded.width, 800);
  assert.equal(decoded.data, url);
});

test("o download usa um link temporário e não persiste nada", () => {
  const clicks: string[] = [];
  const events: string[] = [];
  const anchor = {
    href: "",
    download: "",
    rel: "",
    click() {
      clicks.push(this.href);
    },
  };
  const fakeDocument = {
    createElement(tagName: "a") {
      assert.equal(tagName, "a");
      return anchor;
    },
    body: {
      appendChild(node: unknown) {
        assert.equal(node, anchor);
        events.push("append");
      },
      removeChild(node: unknown) {
        assert.equal(node, anchor);
        events.push("remove");
      },
    },
  };

  downloadQrPng("data:image/png;base64,abc", "qr-code-minha-loja.png", fakeDocument);

  assert.deepEqual(clicks, ["data:image/png;base64,abc"]);
  assert.equal(anchor.download, "qr-code-minha-loja.png");
  assert.deepEqual(events, ["append", "remove"]);
});

test("a ferramenta usa o link salvo da loja e não faz chamadas externas", () => {
  const helper = fs.readFileSync(path.join(ROOT, "src/lib/qr-code.ts"), "utf8");
  const route = fs.readFileSync(path.join(ROOT, "src/routes/painel.qr-code.tsx"), "utf8");
  const home = fs.readFileSync(path.join(ROOT, "src/routes/painel.index.tsx"), "utf8");

  assert.match(route, /useMyCatalog\(user\?\.id\)/);
  assert.match(route, /buildStoreQrUrl\(catalog\.slug\)/);
  assert.match(route, /generateQrPngDataUrl/);
  assert.match(home, /to="\/painel\/qr-code"/);
  assert.doesNotMatch(helper, /\bfetch\s*\(|from ["']@\/integrations|supabase|utm_|analytics/);
  assert.doesNotMatch(route, /\.(insert|update|upsert)\s*\(/);
});

test("os textos exigidos estão traduzidos em português", () => {
  const expected: Record<string, string> = {
    "qrCode.title": "QR Code da Minha Loja",
    "qrCode.description":
      "Transforme o link da sua loja em um QR Code gratuito. Imprima, coloque no seu estabelecimento e permita que seus clientes acessem sua loja pelo celular.",
    "qrCode.fieldLabel": "Cole aqui o link da sua loja",
    "qrCode.generateButton": "Gerar QR Code",
    "qrCode.targetLabel": "Endereço que será acessado",
    "qrCode.downloadButton": "Baixar QR Code em PNG",
    "qrCode.anotherButton": "Gerar outro QR Code",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(getMessage(messages, key), value, key);
  }
});
