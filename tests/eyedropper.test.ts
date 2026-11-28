import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("conta-gotas usa o seletor nativo no desktop e cai no toque na tela", () => {
  const source = read("src/components/EyedropperColorInput.tsx");
  assert.match(source, /EyeDropper\?: EyeDropperLike/);
  assert.match(source, /new EyeDropper\(\)\.open\(\)/);
  assert.match(source, /setPicking\(true\)/);
  assert.match(source, /pointerdown/);
  assert.match(source, /elementFromPoint/);
  assert.match(source, /customize\.colors\.eyedropperHint/);
});

test("cores da vitrine e do botão WhatsApp usam o conta-gotas", () => {
  const source = read("src/routes/painel.personalizar.tsx");
  assert.match(source, /import \{ EyedropperColorInput \}/);
  const uses = source.match(/<EyedropperColorInput/g) ?? [];
  assert.ok(uses.length >= 4, `esperados 4 controles, encontrados ${uses.length}`);
  assert.match(source, /onChange=\{setPrimary\}/);
  assert.match(source, /onChange=\{setAccent\}/);
  assert.match(source, /onChange=\{setBackgroundColor\}/);
  assert.match(source, /onChange=\{setWhatsappButtonColor\}/);
  assert.doesNotMatch(source, /value=\{primary\}[\s\S]{0,120}type="color"/);
});

test("textos do conta-gotas existem em português, inglês e espanhol", () => {
  const source = read("src/i18n/namespaces/customize.ts");
  for (const key of ["eyedropper", "eyedropperHint", "eyedropperCancel"]) {
    const count = (source.match(new RegExp(`${key}: "`, "g")) ?? []).length;
    assert.equal(count, 3, `${key} deve existir nos três idiomas`);
  }
  assert.match(source, /Conta-gotas/);
  assert.match(source, /Eyedropper/);
  assert.match(source, /Cuentagotas/);
});
