import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("upload do QR é isolado por loja e aceita só PNG/JPG até 2 MB", () => {
  const component = read("src/components/PixQrUploader.tsx");

  assert.match(component, /BUCKET = "catalog-images"/);
  assert.match(component, /PIX_QR_FOLDER = "pix-qr"/);
  assert.match(component, /`\$\{PIX_QR_FOLDER\}\/\$\{catalogId\}\//);
  assert.match(component, /const MAX_BYTES = 2 \* 1024 \* 1024/);
  assert.match(component, /ACCEPTED_TYPES = \["image\/png", "image\/jpeg"\]/);
  assert.match(component, /accept=\{ACCEPT\}/);
  assert.match(component, /createSignedUrl/);
  assert.match(component, /\.remove\(\[/); // substituir/remover apaga o arquivo antigo
  assert.match(component, /previous && previous !== path/);
  assert.match(component, /catalogId: string/);
});

test("painel usa o uploader e mantém a chave Pix intacta", () => {
  const page = read("src/routes/painel.pagamentos.tsx");

  assert.match(page, /<PixQrUploader/);
  assert.match(page, /catalogId=\{catalog\.id\}/);
  assert.match(page, /value=\{qrPath\}/);
  assert.match(page, /onChange=\{setQrPath\}/);
  assert.match(page, /pix_key_value: keyValue\.trim\(\) \|\| null/);
  assert.match(page, /pix_qr_path: qrPath/);
  assert.doesNotMatch(page, /accept="image\/\*"/);
});

test("SQL restringe o prefixo pix-qr ao dono do catálogo", () => {
  const sql = read("supabase/fixes/blocos_qr_pix/01_storage_policies.sql");

  assert.match(sql, /catalog_images_public_read/);
  assert.match(sql, /<> 'pix-qr'/); // leitura pública continua só para imagens de produto
  assert.match(sql, /catalog_images_pix_qr_owner_read/);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[1\] = 'pix-qr'/);
  assert.match(sql, /\(storage\.foldername\(name\)\)\[2\]/);
  assert.match(sql, /c\.user_id = auth\.uid\(\)/);
  assert.match(sql, /for insert to authenticated/);
  assert.match(sql, /for update to authenticated/);
  assert.match(sql, /for delete to authenticated/);
});

test("checkout mostra QR ampliado com orientação e mantém confirmação manual", () => {
  const checkout = read("src/routes/c.$slug.tsx");
  const edge = read("supabase/functions/pix-manual/index.ts");

  assert.match(checkout, /pixOrder\.pix\.qrUrl/);
  assert.match(checkout, /t\("catalog\.pix\.scanQr"\)/);
  assert.match(checkout, /setQrZoom\(true\)/);
  assert.match(checkout, /object-contain/);
  assert.match(checkout, /loading="eager"/);
  assert.match(checkout, /t\("catalog\.pix\.declarePaid"\)/);
  assert.match(edge, /createSignedUrl\(path, 60 \* 60\)/);
  assert.match(edge, /action === "declare_paid"/);
  assert.match(edge, /confirm_manual_payment/);
  assert.match(edge, /getOwnedCatalog\(user\.id/);
  assert.match(edge, /O comprador nunca aprova o próprio pagamento/);
});

test("textos pt/en/es cobrem upload e checkout do QR", () => {
  const payments = read("src/i18n/namespaces/payments.ts");
  const catalog = read("src/i18n/namespaces/catalog.ts");

  const blocks = payments.match(/qr: \{[\s\S]*?\n\s{4}\},/g) ?? [];
  assert.equal(blocks.length, 3, "o bloco qr deve existir em pt/en/es");
  for (const key of [
    "title",
    "hint",
    "upload",
    "replace",
    "remove",
    "removeConfirm",
    "registered",
    "previewAlt",
    "invalidType",
    "tooLarge",
    "uploaded",
    "removed",
    "uploadFailed",
    "previewFailed",
    "removeFailed",
  ]) {
    for (const [index, block] of blocks.entries()) {
      assert.ok(block.includes(`${key}:`), `${key} falta no idioma ${index}`);
    }
  }
  assert.equal(catalog.split("scanQr:").length - 1, 3);
  assert.equal(catalog.split("qrZoomHint:").length - 1, 3);
  assert.ok(catalog.includes("Escaneie o QR Code abaixo para realizar o pagamento via Pix."));
});
