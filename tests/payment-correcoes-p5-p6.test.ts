/**
 * Testes de regressão das correções P5 e P6 (Etapa Final).
 *
 * P5 — Notification URL: fail-fast, caminho exato da Edge Function e
 *      rejeição de URLs de outro ambiente (ex.: produção em Sandbox).
 * P6 — x-signature: múltiplos valores v1 sem sobrescrita, ts em segundos ou
 *      milissegundos, comparação em tempo constante e defesa contra replay.
 *
 * Determinísticos: HMAC local, funções puras e fetch simulado. Sem rede,
 * sem banco, sem cobrança, sem Segredos reais.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  assertNotificationUrlForCurrentEnvironment,
  EnvironmentConfigError,
  validatedPaymentsWebhookUrl,
} from "../supabase/functions/_shared/payments/urls.ts";
import {
  buildPreferenceBody,
  mercadopagoProvider,
} from "../supabase/functions/_shared/payments/mercadopago.ts";
import type { CreatePaymentInput, ProviderCredentials } from "../supabase/functions/_shared/payments/types.ts";

const HOMOLOGATION = "https://ardpqimdllzbbdvwamkh.supabase.co";
const PRODUCTION = "https://wdcufpvlbisnqtvmbyso.supabase.co";
const WEBHOOK_PATH = "/functions/v1/webhooks-mercadopago";
const WEBHOOK_SECRET = "webhook-secret-local-de-teste";
const PAYMENT_ID = "1234567890";
const ORDER_ID = "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f";

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> | T {
  const global = globalThis as unknown as { Deno?: unknown };
  const had = Object.prototype.hasOwnProperty.call(global, "Deno");
  const previous = global.Deno;
  global.Deno = { env: { get: (key: string) => vars[key] } };
  const restore = () => {
    if (had) global.Deno = previous;
    else delete global.Deno;
  };
  try {
    const result = fn();
    if (result instanceof Promise) return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function credentials(): ProviderCredentials {
  return {
    accessToken: "token-de-vendedor-de-teste",
    refreshToken: null,
    expiresAt: null,
    scopes: [],
    externalAccountId: "777777777",
    externalAccountLabel: "vendedor-teste",
    merchantId: "777777777",
    capabilities: {},
  };
}

function paymentInput(): CreatePaymentInput {
  return {
    catalogId: "cat-1",
    orderId: ORDER_ID,
    amount: 100,
    currency: "BRL",
    description: "Pedido de teste",
    items: [{ name: "Produto", quantity: 1, unitPrice: 100 }],
    shippingAmount: 0,
    returnUrl: "https://vitrine-homolog.meellcriativa.workers.dev/c/loja?payment=return",
    cancelUrl: "https://vitrine-homolog.meellcriativa.workers.dev/c/loja?payment=cancel",
    externalReference: ORDER_ID,
    buyerEmail: "comprador-teste@example.com",
  };
}

function signature(secret: string, dataId: string, requestId: string, ts: string): string {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

function webhookRequest(signatureHeader: string, requestId = "req-p6") {
  return {
    rawBody: JSON.stringify({ type: "payment", action: "payment.updated", data: { id: PAYMENT_ID } }),
    headers: { "x-request-id": requestId, "x-signature": signatureHeader },
    query: {},
  };
}

function seconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

function milliseconds(): string {
  return String(Date.now());
}

// ─────────────────────────────────────────────────────────────────────────────
// P5 — Notification URL
// ─────────────────────────────────────────────────────────────────────────────

test("P5: Notification URL é derivada do runtime de homologação e validada", () => {
  withEnv({ SUPABASE_URL: HOMOLOGATION }, () => {
    assert.equal(validatedPaymentsWebhookUrl(), `${HOMOLOGATION}${WEBHOOK_PATH}`);
    assert.doesNotThrow(() =>
      assertNotificationUrlForCurrentEnvironment(`${HOMOLOGATION}${WEBHOOK_PATH}`),
    );
  });
});

test("P5: sem SUPABASE_URL a criação falha rápido (EnvironmentConfigError)", async () => {
  const original = globalThis.fetch;
  let fetchCalls = 0;
  (globalThis as unknown as { fetch: unknown }).fetch = async () => {
    fetchCalls += 1;
    throw new Error("fetch não deveria ser chamado");
  };
  try {
    await assert.rejects(
      () =>
        withEnv({ MP_ENV: "sandbox" }, () =>
          mercadopagoProvider.createPayment(credentials(), paymentInput()),
        ),
      (error: unknown) => error instanceof EnvironmentConfigError && /SUPABASE_URL/.test(String(error)),
    );
    assert.equal(fetchCalls, 0, "nenhuma preferência pode ser criada sem URL válida");
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = original;
  }
});

test("P5: URL de produção é recusada em Sandbox", () => {
  withEnv({ SUPABASE_URL: HOMOLOGATION, MP_ENV: "sandbox" }, () => {
    assert.throws(
      () => assertNotificationUrlForCurrentEnvironment(`${PRODUCTION}${WEBHOOK_PATH}`),
      EnvironmentConfigError,
      /outro ambiente/,
    );
  });
});

test("P5: caminho diferente da Edge Function de webhook é recusado", () => {
  withEnv({ SUPABASE_URL: HOMOLOGATION }, () => {
    assert.throws(
      () => assertNotificationUrlForCurrentEnvironment(`${HOMOLOGATION}/functions/v1/outra`),
      EnvironmentConfigError,
      /caminho deve ser exatamente/,
    );
    assert.throws(
      () => assertNotificationUrlForCurrentEnvironment(`${HOMOLOGATION}${WEBHOOK_PATH}/extra`),
      EnvironmentConfigError,
    );
  });
});

test("P5: HTTP, query string, fragmento e credenciais na URL são recusados", () => {
  withEnv({ SUPABASE_URL: HOMOLOGATION }, () => {
    const invalid = [
      `http://ardpqimdllzbbdvwamkh.supabase.co${WEBHOOK_PATH}`,
      `${HOMOLOGATION}${WEBHOOK_PATH}?x=1`,
      `${HOMOLOGATION}${WEBHOOK_PATH}#x`,
      `https://user:pass@ardpqimdllzbbdvwamkh.supabase.co${WEBHOOK_PATH}`,
      "nao-e-uma-url",
    ];
    for (const url of invalid) {
      assert.throws(() => assertNotificationUrlForCurrentEnvironment(url), EnvironmentConfigError, url);
    }
  });
});

test("P5: createPayment envia a Notification URL do projeto atual", async () => {
  const original = globalThis.fetch;
  const bodies: Record<string, unknown>[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (_input: unknown, init: RequestInit = {}) => {
    bodies.push(typeof init.body === "string" ? JSON.parse(init.body) : {});
    return new Response(JSON.stringify({ id: "pref-1", init_point: "https://mp.test/checkout" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await withEnv({ SUPABASE_URL: HOMOLOGATION, MP_ENV: "sandbox" }, () =>
      mercadopagoProvider.createPayment(credentials(), paymentInput()),
    );
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0]!["notification_url"], `${HOMOLOGATION}${WEBHOOK_PATH}`);
    assert.equal(bodies[0]!["external_reference"], ORDER_ID);
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = original;
  }
});

test("P5: preferência sem Notification URL é recusada antes da chamada à API", () => {
  assert.throws(
    () => buildPreferenceBody(paymentInput(), ""),
    /notification URL ausente/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// P6 — x-signature com múltiplos v1
// ─────────────────────────────────────────────────────────────────────────────

test("P6: v1 válido no início NÃO é sobrescrito por v1 inválido no fim", async () => {
  const ts = seconds();
  const valid = signature(WEBHOOK_SECRET, PAYMENT_ID, "req-p6", ts);
  const header = `ts=${ts},v1=${valid},v1=${"0".repeat(64)}`;
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(webhookRequest(header)),
  );
  assert.equal(result.valid, true, "o último v1 não pode invalidar o anterior");
  assert.equal(result.reason, undefined);
});

test("P6: v1 válido no fim da lista também é aceito", async () => {
  const ts = seconds();
  const valid = signature(WEBHOOK_SECRET, PAYMENT_ID, "req-p6", ts);
  const header = `v1=${"0".repeat(64)},ts=${ts},v1=${valid}`;
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(webhookRequest(header)),
  );
  assert.equal(result.valid, true);
});

test("P6: todos os v1 inválidos são recusados", async () => {
  const ts = seconds();
  const header = `ts=${ts},v1=${"0".repeat(64)},v1=${"1".repeat(64)}`;
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(webhookRequest(header)),
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "Assinatura do webhook inválida.");
});

test("P6: ts em milissegundos (documentação oficial) é aceito", async () => {
  const ts = milliseconds();
  const header = `ts=${ts},v1=${signature(WEBHOOK_SECRET, PAYMENT_ID, "req-p6", ts)}`;
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(webhookRequest(header)),
  );
  assert.equal(result.valid, true);
});

test("P6: ts em milissegundos antigo é recusado (replay)", async () => {
  const ts = String(Date.now() - 3_600_000);
  const header = `ts=${ts},v1=${signature(WEBHOOK_SECRET, PAYMENT_ID, "req-p6", ts)}`;
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(webhookRequest(header)),
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "Assinatura fora da janela de validade.");
});

test("P6: rotação com dois ts — assinatura fresca vale, assinatura antiga não", async () => {
  const fresh = seconds();
  const stale = String(Math.floor(Date.now() / 1000) - 3600);
  const freshSig = signature(WEBHOOK_SECRET, PAYMENT_ID, "req-p6", fresh);
  const staleSig = signature(WEBHOOK_SECRET, PAYMENT_ID, "req-p6", stale);

  const aceita = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(
      webhookRequest(`ts=${stale},v1=${staleSig},ts=${fresh},v1=${freshSig}`),
    ),
  );
  assert.equal(aceita.valid, true);

  const recusada = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(
      webhookRequest(`ts=${fresh},v1=${staleSig},ts=${stale},v1=${staleSig}`),
    ),
  );
  assert.equal(recusada.valid, false);
  assert.equal(recusada.reason, "Assinatura do webhook inválida.");
});

test("P6: separador ':' também é aceito (formatos documentados)", async () => {
  const ts = seconds();
  const header = `ts:${ts},v1:${signature(WEBHOOK_SECRET, PAYMENT_ID, "req-p6", ts)}`;
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(webhookRequest(header)),
  );
  assert.equal(result.valid, true);
});

test("P6: manifesto omite x-request-id ausente, conforme documentação oficial", async () => {
  const ts = seconds();
  const manifest = `id:${PAYMENT_ID};ts:${ts};`;
  const v1 = createHmac("sha256", WEBHOOK_SECRET).update(manifest).digest("hex");
  const request = webhookRequest(`ts=${ts},v1=${v1}`, "");
  delete request.headers["x-request-id"];
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(request),
  );
  assert.equal(result.valid, true);
});

test("P6: assinatura ausente continua recusada", async () => {
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(webhookRequest(`ts=${seconds()}`)),
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "Assinatura ausente.");
});

test("P6: idempotência por x-request-id permanece intacta com múltiplos v1", async () => {
  const ts = seconds();
  const valid = signature(WEBHOOK_SECRET, PAYMENT_ID, "req-estavel", ts);
  const header = `ts=${ts},v1=${"f".repeat(64)},v1=${valid}`;
  const result = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET }, () =>
    mercadopagoProvider.verifyWebhook(webhookRequest(header, "req-estavel")),
  );
  assert.equal(result.valid, true);
  assert.equal(result.eventId, `payment:${PAYMENT_ID}:req-estavel`);
});

test("P6: mensagem de Secret ausente usa o nome correto", async () => {
  const result = await withEnv({}, () =>
    mercadopagoProvider.verifyWebhook(webhookRequest(`ts=${seconds()},v1=abc`)),
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, "MERCADOPAGO_WEBHOOK_SECRET não configurado.");
});
