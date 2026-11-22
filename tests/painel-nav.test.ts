import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("Pedidos fica logo abaixo de Cadastrar Produto na navegação do painel", () => {
  const source = read("src/routes/painel.tsx");
  const products = source.indexOf('to: "/painel/produtos"');
  const orders = source.indexOf('to: "/painel/pedidos"');
  const categories = source.indexOf('to: "/painel/categorias"');
  assert.ok(products > -1 && orders > -1 && categories > -1);
  assert.ok(orders > products, "Pedidos deve vir depois de Produtos");
  assert.ok(orders < categories, "Pedidos deve vir antes de Categorias");
});

test("Atalhos do início mantêm a mesma ordem", () => {
  const source = read("src/routes/painel.index.tsx");
  const products = source.indexOf('to="/painel/produtos"');
  const orders = source.indexOf('to="/painel/pedidos"');
  const categories = source.indexOf('to="/painel/categorias"');
  assert.ok(orders > products && orders < categories);
});

test("Recursos permanentes do painel continuam presentes", () => {
  const source = read("src/routes/painel.index.tsx");
  assert.match(source, /panel\.dashboard\.editStoreLink/);
  assert.match(source, /customize\.fields\.currency/);
  assert.match(source, /to="\/painel\/conversor"/);
  const linkCard = source.indexOf("panel.dashboard.editStoreLink");
  const currencyCard = source.indexOf("customize.fields.currency");
  const converter = source.indexOf('to="/painel/conversor"');
  assert.ok(currencyCard > -1 && converter > currencyCard, "Moeda deve ficar acima do conversor");
  assert.ok(linkCard > -1);
});
