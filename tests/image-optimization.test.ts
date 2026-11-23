import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  IMAGE_WIDTHS,
  imageFallback,
  optimizedImageSrcSet,
  optimizedImageUrl,
} from "../src/lib/imageUrls.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const BASE = "https://wdcufpvlbisnqtvmbyso.supabase.co";
const PATH = "5b721660-98bc-485b-a5f1-a4c305059937/a2a4dfbe-73bd-42dc-b4ca-eb2aa390beeb.png";
const SIGNED = `${BASE}/storage/v1/object/sign/catalog-images/${PATH}?token=abc.def.ghi`;
const PUBLIC = `${BASE}/storage/v1/object/public/catalog-images/${PATH}`;

test("converte URL assinada em URL de render WebP sem quebrar o caminho", () => {
  const result = optimizedImageUrl(SIGNED, 400, 82);
  assert.equal(
    result,
    `${BASE}/storage/v1/render/image/public/catalog-images/${PATH}?width=400&format=webp&quality=82`,
  );
  assert.ok(!result?.includes("token="), "a assinatura antiga não deve seguir na URL otimizada");
});

test("aceita URL pública e usa 1200px/qualidade 82 por padrão", () => {
  assert.equal(
    optimizedImageUrl(PUBLIC),
    `${BASE}/storage/v1/render/image/public/catalog-images/${PATH}?width=1200&format=webp&quality=82`,
  );
});

test("preserva nomes de arquivo com caracteres especiais", () => {
  const url = `${BASE}/storage/v1/object/sign/catalog-images/user/foto%20legal%20(1).jpg?token=x`;
  assert.equal(
    optimizedImageUrl(url, 400),
    `${BASE}/storage/v1/render/image/public/catalog-images/user/foto%20legal%20(1).jpg?width=400&format=webp&quality=82`,
  );
});

test("limita largura e qualidade a faixas seguras", () => {
  assert.match(optimizedImageUrl(PUBLIC, 99999, 999)!, /width=2400&format=webp&quality=100$/);
  assert.match(optimizedImageUrl(PUBLIC, -10, -10)!, /width=16&format=webp&quality=1$/);
  assert.match(
    optimizedImageUrl(PUBLIC, Number.NaN, Number.NaN)!,
    /width=1200&format=webp&quality=82$/,
  );
});

test("mantém URL original fora do bucket de imagens de catálogo", () => {
  assert.equal(optimizedImageUrl(null), null);
  assert.equal(optimizedImageUrl(undefined), null);
  assert.equal(optimizedImageUrl(""), null);
  assert.equal(optimizedImageUrl("https://example.com/foto.jpg"), null);
  assert.equal(optimizedImageUrl("data:image/png;base64,iVBOR"), null);
  assert.equal(optimizedImageUrl("blob:https://example.com/uuid"), null);
  assert.equal(optimizedImageUrl("/c/minha-loja"), null);
  assert.equal(
    optimizedImageUrl(`${BASE}/storage/v1/object/sign/digital-products/user/arquivo.pdf?token=x`),
    null,
  );
  assert.equal(
    optimizedImageUrl(`${BASE}/storage/v1/render/image/public/catalog-images/${PATH}?width=400`),
    null,
    "não aplica transformação duas vezes",
  );
  assert.equal(optimizedImageUrl("http://["), null);
});

test("gera srcSet com miniatura, cartão e detalhe", () => {
  const srcSet = optimizedImageSrcSet(SIGNED)!;
  assert.equal(srcSet.split(", ").length, 3);
  assert.ok(srcSet.includes(`width=${IMAGE_WIDTHS.thumb}&format=webp`));
  assert.ok(srcSet.includes(`width=${IMAGE_WIDTHS.card}&format=webp`));
  assert.ok(srcSet.includes(`width=${IMAGE_WIDTHS.detail}&format=webp`));
  assert.ok(srcSet.includes("400w"));
  assert.ok(srcSet.includes("800w"));
  assert.ok(srcSet.includes("1200w"));
  assert.equal(optimizedImageSrcSet("https://example.com/foto.jpg"), null);
});

test("fallback restaura a URL original uma única vez", () => {
  const handler = imageFallback(SIGNED);
  const element = {
    currentTarget: {
      src: optimizedImageUrl(SIGNED)!,
      dataset: {} as Record<string, string | undefined>,
    },
  };
  handler(element);
  assert.equal(element.currentTarget.src, SIGNED);
  element.currentTarget.src = optimizedImageUrl(SIGNED)!;
  handler(element);
  assert.equal(element.currentTarget.src, optimizedImageUrl(SIGNED)!, "evita loop de onError");
});

test("vitrine usa miniaturas, srcSet, dimensões e carregamento prioritário", () => {
  const store = read("src/routes/c.$slug.tsx");
  assert.match(store, /from "@\/lib\/imageUrls"/);
  assert.match(store, /optimizedImageSrcSet\(product\.images\[0\]\)/);
  assert.match(store, /sizes="\(max-width: 640px\) 33vw, 240px"/);
  assert.match(store, /loading=\{index === 0 \? "eager" : "lazy"\}/);
  assert.match(store, /fetchPriority=\{index === 0 \? "high" : "auto"\}/);
  assert.match(store, /onError=\{imageFallback\(product\.images\[0\]\)\}/);
  assert.doesNotMatch(store, /src=\{product\.images\[0\]\}/);
  assert.doesNotMatch(store, /backgroundImage: loadedCatalog\.cover_url/);
  assert.doesNotMatch(store, /backgroundImage: catalog\.cover_url/);
  assert.ok(store.match(/loading="lazy"/g)!.length >= 4);
});

test("todas as areas que exibem fotos usam URLs otimizadas com fallback", () => {
  for (const path of [
    "src/routes/c.$slug.tsx",
    "src/routes/painel.index.tsx",
    "src/routes/painel.produtos.tsx",
    "src/routes/painel.personalizar.tsx",
    "src/components/ImageUploader.tsx",
    "src/components/CheckoutDesignEditor.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /optimizedImageUrl\(/, path);
    assert.match(source, /imageFallback\(/, path);
  }
});

test("Pix QR e arquivos digitais não são alterados pela otimização", () => {
  const store = read("src/routes/c.$slug.tsx");
  assert.match(store, /src=\{pixOrder\.pix\.qrUrl\}/);
  const helper = read("src/lib/imageUrls.ts");
  assert.match(helper, /catalog-images/);
  assert.doesNotMatch(helper, /digital-products\/.*render/);
});
