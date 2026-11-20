/**
 * Regressões da etapa final de homologação (Mercado Pago).
 *
 * Determinísticos: leitura de código, funções puras e env local. Sem rede,
 * banco, cobrança, webhook real ou Secrets.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildPreferenceBody } from "../supabase/functions/_shared/payments/mercadopago.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string): string => readFileSync(`${ROOT}${relative}`, "utf8");

test("CHECKOUT: chave de idempotência usa orderId já declarado (sem TDZ)", () => {
  const source = read("supabase/functions/payments/index.ts");
  const start = source.indexOf("async function createPaymentAction");
  const declaration = source.indexOf("const order = orderData as", start);
  assert.ok(start >= 0, "createPaymentAction não encontrado");
  assert.ok(declaration > start, "declaração de order não encontrada");

  // Antes da declaração de `order`, nenhuma referência a `order.` é válida.
  // O bug encontrado na auditoria usava `order.id` na chave da tentativa e
  // quebrava toda a criação de pagamento (ReferenceError de TDZ).
  const beforeDeclaration = source.slice(start, declaration);
  assert.doesNotMatch(beforeDeclaration, /\border\s*\./, "order usado antes da declaração");
  assert.match(beforeDeclaration, /sha256Hex\(/);
  assert.match(beforeDeclaration, /\$\{orderId\}\|/);
});

test("CHECKOUT: Preference usa exclusivamente a credencial OAuth do vendedor", () => {
  const router = read("supabase/functions/payments/index.ts");
  const provider = read("supabase/functions/_shared/payments/mercadopago.ts");

  assert.match(router, /const loaded = await loadCredentials\(catalog\.id, provider\)/);
  assert.match(router, /providerImpl\.createPayment\(loaded\.credentials,/);
  assert.match(provider, /token: credentials\.accessToken/);
  // O token client_credentials da plataforma nunca é usado para cobrar.
  assert.doesNotMatch(provider, /grant_type\s*:\s*["']client_credentials["']/);
});

test("P4/SPLIT: preferência sem comissão e com identificação do pedido e da loja", () => {
  const notificationUrl =
    "https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago";
  const body = buildPreferenceBody(
    {
      catalogId: "catalogo-teste",
      orderId: "pedido-teste",
      amount: 100,
      currency: "BRL",
      description: "Pedido de teste",
      items: [{ name: "Produto", quantity: 1, unitPrice: 100 }],
      shippingAmount: 0,
      returnUrl: "https://vitrine-homolog.meellcriativa.workers.dev/c/loja?payment=return",
      cancelUrl: "https://vitrine-homolog.meellcriativa.workers.dev/c/loja?payment=cancel",
      externalReference: "pedido-teste",
      statementDescriptor: "Loja Teste",
    },
    notificationUrl,
  ) as Record<string, any>;

  assert.equal("marketplace_fee" in body, false, "nenhuma comissão pode ser enviada");
  assert.equal(body.external_reference, "pedido-teste");
  assert.equal(body.notification_url, notificationUrl);
  assert.equal(body.back_urls.success, body.back_urls.pending);
  assert.match(body.back_urls.failure, /payment=cancel/);
  assert.equal(body.auto_return, "approved");
  assert.equal(body.statement_descriptor, "Loja Teste");
  assert.equal(body.metadata.order_id, "pedido-teste");
  assert.equal(body.metadata.catalog_id, "catalogo-teste");
});

test("P1: renovação usa refresh_token e não inventa revogação programática", () => {
  const provider = read("supabase/functions/_shared/payments/mercadopago.ts");
  assert.match(provider, /grant_type:\s*"refresh_token"/);
  assert.match(provider, /async revoke\(credentials: ProviderCredentials\): Promise<RevokeResult>/);
  // M3: não existe endpoint público confirmado; o contrato sinaliza que a
  // revogação é manual em vez de fingir que o acesso foi revogado no MP.
  assert.match(provider, /remoteRevoked:\s*false/);
  assert.match(provider, /manualRequired:\s*true/);
  assert.doesNotMatch(provider, /oauth\/credentials/);
});
