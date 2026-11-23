import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");
const readBytes = (path: string) => readFileSync(`${root}${path}`);

const ICONS = [
  ["favicon-32.png", 32],
  ["favicon.png", 256],
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["icon-maskable-192.png", 192],
  ["icon-maskable-512.png", 512],
] as const;

test("manifesto declara ícones any e maskable nas medidas corretas", () => {
  const manifest = JSON.parse(read("public/site.webmanifest"));
  const byPurpose = (purpose: string) =>
    manifest.icons.filter((icon: { purpose?: string }) => icon.purpose === purpose);

  assert.equal(byPurpose("any").length >= 3, true);
  assert.deepEqual(
    byPurpose("maskable")
      .map((icon: { sizes: string }) => icon.sizes)
      .sort(),
    ["192x192", "512x512"],
  );
  assert.notEqual(manifest.background_color, "#ffffff");
  assert.equal(manifest.display, "standalone");
});

test("arte original preservada e gerador reproduz todos os ícones", () => {
  const source = readBytes("assets/brand/vitrine-icon-source.png");
  assert.deepEqual(Array.from(source.subarray(1, 4)), [80, 78, 71]); // assinatura PNG
  const generator = read("scripts/generate-pwa-icons.mjs");
  assert.match(generator, /assets.*brand.*vitrine-icon-source\.png/);
  for (const [name] of ICONS) assert.match(generator, new RegExp(name.replace(".", "\\.")));

  const ico = readBytes("public/favicon.ico");
  assert.deepEqual(Array.from(ico.subarray(0, 4)), [0, 0, 1, 0]); // cabeçalho ICO
  assert.ok(ico.length > 1000);
});

test("nenhum ícone tem borda branca ou transparente", () => {
  for (const [name, size] of ICONS) {
    const png = PNG.sync.read(readBytes(`public/${name}`));
    assert.equal(png.width, size, name);
    assert.equal(png.height, size, name);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const border = x < 4 || y < 4 || x >= size - 4 || y >= size - 4;
        if (!border) continue;
        const i = (y * size + x) * 4;
        assert.equal(png.data[i + 3], 255, `${name} tem borda transparente`);
        const white = png.data[i] > 248 && png.data[i + 1] > 248 && png.data[i + 2] > 248;
        assert.equal(white, false, `${name} tem borda branca`);
      }
    }
  }
});

test("ícone maskable mantém a arte central na área segura", () => {
  for (const size of [192, 512]) {
    const png = PNG.sync.read(readBytes(`public/icon-maskable-${size}.png`));
    const pixel = (x: number, y: number) => {
      const i = (y * size + x) * 4;
      return [png.data[i], png.data[i + 1], png.data[i + 2]];
    };
    const edge = pixel(2, Math.round(size / 2));
    const center = pixel(Math.round(size / 2), Math.round(size / 2));
    assert.notDeepEqual(center, edge, "a arte precisa aparecer no centro");
    assert.ok(edge[0] > 150 && edge[2] > 150, "a borda deve ser rosa/lilás da marca");
    assert.ok(
      center[0] > center[1] && center[0] > center[2],
      "o centro deve manter o rosa da marca",
    );
  }
});

test("service worker atualiza cache de ícones sem apagar dados da loja", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /ICON_CACHE = "vitrine-icons-v2"/);
  assert.match(sw, /addEventListener\("install"/);
  assert.match(sw, /addEventListener\("activate"/);
  assert.match(sw, /caches\.delete\(key\)/);
  assert.match(sw, /startsWith\("vitrine-icons-"\)/);
  assert.match(sw, /addEventListener\("fetch"/);
  assert.match(sw, /fetch\(request\)/);
  assert.match(sw, /caches\.match\(request\)/);
  // Notificações continuam intactas.
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /badge: "\/notification-badge\.png"/);
  assert.match(sw, /openWindow\(url\)/);
});

test("HTML declara metadados de instalação e cor da marca", () => {
  const rootFile = read("src/routes/__root.tsx");
  for (const meta of [
    /name: "theme-color", content: "#c40364"/,
    /name: "mobile-web-app-capable", content: "yes"/,
    /name: "apple-mobile-web-app-capable", content: "yes"/,
    /name: "apple-mobile-web-app-status-bar-style", content: "black-translucent"/,
    /name: "apple-mobile-web-app-title", content: "Vitrine"/,
    /rel: "apple-touch-icon", href: "\/apple-touch-icon\.png"/,
    /rel: "manifest", href: "\/site\.webmanifest"/,
  ]) {
    assert.match(rootFile, meta);
  }
});
