import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildProductCheckoutUrl,
  parseProductCheckoutParams,
} from "../src/lib/productLinks.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("link de produto aponta para o checkout com o id do produto", () => {
  assert.equal(
    buildProductCheckoutUrl("https://loja.test/", "minha-loja", "prod-123"),
    "https://loja.test/c/minha-loja?produto=prod-123",
  );
});

test("link de valor acrescenta o id da opção escolhida", () => {
  assert.equal(
    buildProductCheckoutUrl("https://loja.test", "minha loja", "prod-123", "op 1"),
    "https://loja.test/c/minha%20loja?produto=prod-123&valor=op+1",
  );
});

test("parâmetros são lidos de volta, inclusive com outros parâmetros na URL", () => {
  assert.deepEqual(
    parseProductCheckoutParams("?payment=return&produto=prod-123&valor=op-1"),
    { productId: "prod-123", priceOptionId: "op-1" },
  );
  assert.deepEqual(parseProductCheckoutParams("?produto=prod-123"), {
    productId: "prod-123",
    priceOptionId: null,
  });
  assert.deepEqual(parseProductCheckoutParams(""), {
    productId: null,
    priceOptionId: null,
  });
});

test("checkout abre o produto/valor do link e não oferece WhatsApp com pagamento online", () => {
  const checkout = read("src/routes/c.$slug.tsx");
  assert.match(checkout, /parseProductCheckoutParams\(window\.location\.search\)/);
  assert.match(checkout, /setSelected\(product\)/);
  assert.match(checkout, /initialPriceOptionId/);
  assert.match(checkout, /onlinePaymentAvailable=\{\(paymentMethods\?\.length \?\? 0\) > 0 \|\| !!pixConfig\?\.available\}/);
  assert.match(checkout, /if \(!payment && onlinePaymentAvailable\)/);
  assert.match(checkout, /effectiveProvider \? \{ provider: effectiveProvider \} : null/);
  assert.match(checkout, /PRODUCT_QUERY_COLUMNS_LEGACY/);
  assert.match(checkout, /42703\|does not exist/);
  // A opção WhatsApp existe apenas no fallback para lojas sem pagamento online.
  assert.doesNotMatch(checkout, /\{pixConfig\?\.available && \([\s\S]{0,400}catalog\.cart\.payWithStore/);

  const panel = read("src/routes/painel.produtos.tsx");
  assert.match(panel, /buildProductCheckoutUrl\(/);
  assert.match(panel, /catalogSlug/);
  assert.match(panel, /products\.editor\.checkoutLinksTitle/);
  assert.match(panel, /products\.editor\.copyValueLink/);
});
