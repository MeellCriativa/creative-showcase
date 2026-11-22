import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { normalizeDecimalInput, parseDecimalInput } from "../src/lib/decimalInput.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("vírgula decimal é aceita no meio dos números", () => {
  assert.equal(parseDecimalInput("59,90"), 59.9);
  assert.equal(parseDecimalInput("0,05"), 0.05);
  assert.equal(parseDecimalInput("59,9"), 59.9);
});

test("ponto decimal também é aceito", () => {
  assert.equal(parseDecimalInput("59.90"), 59.9);
});

test("entrada incompleta enquanto digita não é descartada", () => {
  assert.equal(parseDecimalInput("59,"), 59);
  assert.equal(parseDecimalInput("59."), 59);
  assert.equal(parseDecimalInput(""), Number.NaN);
});

test("entrada inválida é rejeitada", () => {
  for (const raw of ["abc", "-5", "59,9,0", "1.2.3", "59a"]) {
    assert.ok(Number.isNaN(parseDecimalInput(raw)), raw);
  }
});

test("ao sair do campo o valor é normalizado com vírgula", () => {
  assert.equal(normalizeDecimalInput("59,9"), "59,90");
  assert.equal(normalizeDecimalInput("59.90"), "59,90");
  assert.equal(normalizeDecimalInput("59,"), "59,00");
  assert.equal(normalizeDecimalInput("abc"), "");
});

test("campo de opção de valor mantém o texto digitado durante a edição", () => {
  const source = read("src/routes/painel.produtos.tsx");
  assert.match(source, /priceOptionInputs\[opt\.id\]/);
  assert.doesNotMatch(source, /Number\(e\.target\.value\.replace\(",", "\."\)\)/);
});
