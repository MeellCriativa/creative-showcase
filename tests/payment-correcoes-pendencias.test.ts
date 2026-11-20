/**
 * Testes de regressão das pendências P4, P7, P8, P10, P11, P12, P13 e P15
 * corrigidas na etapa final de homologação.
 *
 * Determinísticos: funções puras, fetch simulado, leitura de arquivos e env
 * local. Sem rede, banco, cobrança ou Secrets reais.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  panelBaseUrl,
  panelOrigin,
  panelUrl,
} from "../supabase/functions/_shared/payments/urls.ts";
import { paymentIdForLookup } from "../supabase/functions/_shared/payments/lifecycle.ts";
import { clientFingerprintFromHeaders } from "../supabase/functions/_shared/payments/fingerprint.ts";
import { resolveTransaction } from "../supabase/functions/_shared/payments/resolution.ts";
import {
  buildPreferenceBody,
  mercadopagoProvider,
} from "../supabase/functions/_shared/payments/mercadopago.ts";
import type {
  CreatePaymentInput,
  ProviderCredentials,
} from "../supabase/functions/_shared/payments/types.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string): string => readFileSync(`${ROOT}${relative}`, "utf8");

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): T | Promise<T> {
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
    accessToken: "token-teste",
    refreshToken: null,
    expiresAt: null,
    scopes: [],
    externalAccountId: "777777777",
    externalAccountLabel: "vendedor-teste",
    merchantId: "777777777",
    capabilities: {},
  };
}

function input(): CreatePaymentInput {
  return {
    catalogId: "cat-1",
    orderId: "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f",
    amount: 100,
    currency: "BRL",
    description: "Pedido de teste",
    items: [{ name: "Produto", quantity: 1, unitPrice: 100 }],
    shippingAmount: 0,
    returnUrl: "https://vitrine-homolog.meellcriativa.workers.dev/c/loja",
    cancelUrl: "https://vitrine-homolog.meellcriativa.workers.dev/c/loja?payment=cancel",
    externalReference: "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// P13 — base com path vs origem estrita
// ─────────────────────────────────────────────────────────────────────────────

test("P13: VITRINE_URL com path mantém origem estrita e base correta", () => {
  withEnv({ VITRINE_URL: "https://vitrine-homolog.meellcriativa.workers.dev/app/" }, () => {
    assert.equal(panelBaseUrl(), "https://vitrine-homolog.meellcriativa.workers.dev/app");
    assert.equal(panelOrigin(), "https://vitrine-homolog.meellcriativa.workers.dev");
    assert.equal(panelUrl(), "https://vitrine-homolog.meellcriativa.workers.dev/app/painel/pagamentos");
  });
});

test("P13: VITRINE_URL sem path continua compatível", () => {
  withEnv({ VITRINE_URL: "https://vitrine-homolog.meellcriativa.workers.dev" }, () => {
    assert.equal(panelOrigin(), panelBaseUrl());
    assert.equal(panelUrl(), `${panelBaseUrl()}/painel/pagamentos`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// P15.2 — id de pagamento mais recente
// ─────────────────────────────────────────────────────────────────────────────

test("P15.2: MP prefere o id notificado ao id salvo na transação", () => {
  assert.equal(
    paymentIdForLookup({
      provider: "mercadopago",
      providerPaymentId: "id-antigo",
      providerOrderId: "pref-1",
      resourceType: "payment",
      resourceId: "id-novo",
      resolvedPaymentId: "id-oficial",
    }),
    "id-novo",
  );
  assert.equal(
    paymentIdForLookup({
      provider: "mercadopago",
      providerPaymentId: "id-antigo",
      providerOrderId: "pref-1",
      resourceType: "merchant_order",
      resolvedPaymentId: "id-oficial",
    }),
    "id-oficial",
  );
  assert.equal(
    paymentIdForLookup({
      provider: "paypal",
      providerPaymentId: "captura",
      providerOrderId: "ordem",
    }),
    "ordem",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// P8 — fingerprint confiável
// ─────────────────────────────────────────────────────────────────────────────

test("P8: cf-connecting-ip só é aceito com cf-ray", () => {
  assert.equal(
    clientFingerprintFromHeaders({ "cf-ray": "abc", "cf-connecting-ip": "203.0.113.9" }),
    "203.0.113.9",
  );
  assert.equal(
    clientFingerprintFromHeaders({ "cf-connecting-ip": "203.0.113.9" }),
    "unknown",
  );
});

test("P8: XFF usa o último valor (proxy), não o spoofável", () => {
  assert.equal(
    clientFingerprintFromHeaders({
      "x-forwarded-for": "1.1.1.1, 2.2.2.2, 198.51.100.7",
    }),
    "198.51.100.7",
  );
  assert.equal(clientFingerprintFromHeaders({}), "unknown");
  assert.equal(
    clientFingerprintFromHeaders(new Headers({ "x-forwarded-for": "9.9.9.9, 198.51.100.8" })),
    "198.51.100.8",
  );
});

test("P8: ações mutantes falham fechado no chamador", () => {
  const source = read("supabase/functions/payments/index.ts");
  assert.match(source, /const failClosed = action === "create_order" \|\| action === "create_payment"/);
  assert.match(source, /decision\.degraded \? 503 : 429/);
  assert.match(source, /code: decision\.degraded \? "rate_limiter_unavailable" : "rate_limited"/);
});

// ─────────────────────────────────────────────────────────────────────────────
// P15.1 — limitação do caminho inválido do webhook
// ─────────────────────────────────────────────────────────────────────────────

test("P15.1: webhook limita POSTs com assinatura inválida", () => {
  const source = read("supabase/functions/_shared/payments/webhooks.ts");
  assert.match(source, /bucket: `webhook:\$\{input\.provider\}:\$\{clientFingerprintFromHeaders/);
  assert.match(source, /if \(decision === "reject"\) \{[\s\S]{0,600}enforceRateLimit/);
});

// ─────────────────────────────────────────────────────────────────────────────
// P7 — sellerAccountId da API oficial propaga até o webhook
// ─────────────────────────────────────────────────────────────────────────────

test("P7: resolução oficial propaga collector_id", async () => {
  const result = await resolveTransaction({
    provider: "mercadopago",
    resource: { type: "payment", id: "123", isPaymentResource: true },
    payload: {},
    providerPaymentId: null,
    deps: {
      byProviderPayment: async () => null,
      byOrder: async (orderId) =>
        orderId === "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f"
          ? {
              id: "tx-1",
              order_id: orderId,
              provider_payment_id: null,
              provider_order_id: null,
            }
          : null,
      byProviderOrder: async () => null,
      resolveNotification: async () => ({
        externalReference: "3f9d1c2e-7b4a-4c5d-8e6f-1a2b3c4d5e6f",
        providerPaymentId: "123",
        sellerAccountId: "777777777",
      }),
    },
  });
  assert.equal(result?.sellerAccountId, "777777777");
  assert.equal(result?.via, "official_lookup");
});

test("P7: webhook usa collector_id quando payload não tem user_id", () => {
  const source = read("supabase/functions/_shared/payments/webhooks.ts");
  assert.match(source, /!notification\.catalogId && resolved\.sellerAccountId/);
  assert.match(source, /officialConnection\.catalog_id !== resolved\.transaction\.catalog_id/);
});

// ─────────────────────────────────────────────────────────────────────────────
// P10 — política anônima segura
// ─────────────────────────────────────────────────────────────────────────────

test("P10: arquivo de correção não reintroduz with check (true)", () => {
  const executable = read("supabase/fixes/20261118_restore_orders_anon_insert.sql")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(executable, /with\s+check\s*\(\s*true\s*\)/i);
  assert.match(executable, /public\.catalogs_public/);
  assert.match(executable, /status = 'novo'/);
  // O GRANT é necessário para o fallback funcional; a segurança vem do WITH CHECK.
  assert.match(executable, /grant\s+insert\s+on\s+public\.orders\s+to\s+anon;/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// P11 / P12 — nonce e logs
// ─────────────────────────────────────────────────────────────────────────────

test("P11: falha ao gravar nonce aborta o connect", () => {
  const db = read("supabase/functions/_shared/payments/db.ts");
  const handler = read("supabase/functions/payments/index.ts");
  assert.match(db, /Promise<\{ ok: true \} \| \{ ok: false; error: string \}>/);
  assert.match(handler, /if \(!savedState\.ok\) \{[\s\S]{0,200}HttpError\(503/);
});

test("P12: erro bruto do provedor não vai para log", () => {
  const executable = read("supabase/functions/payments-callback/index.ts")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"))
    .join("\n");
  // O texto cru nunca é passado diretamente para console.* — só via stableError.
  assert.doesNotMatch(executable, /console\.(?:warn|error)\([^\n]*,\s*(?:providerError|\(error as Error\)\.message)\s*\)/);
  assert.match(executable, /console\.warn\([^\n]*stableError\(providerError\)\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// P4 / P15.3 — idempotência por tentativa e descriptor da loja
// ─────────────────────────────────────────────────────────────────────────────

test("P15.3: statement_descriptor usa o nome da loja sanitizado", () => {
  const body = buildPreferenceBody(
    { ...input(), statementDescriptor: "Loja Ação++" },
    "https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago",
  ) as Record<string, unknown>;
  assert.equal(body["statement_descriptor"], "Loja Acao");
  const fallback = buildPreferenceBody(
    input(),
    "https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago",
  ) as Record<string, unknown>;
  assert.equal(fallback["statement_descriptor"], "VITRINE CRIATIVA");
});

test("P4: X-Idempotency-Key usa a chave da tentativa quando fornecida", async () => {
  const original = globalThis.fetch;
  const headers: Record<string, string>[] = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    _url: unknown,
    init: RequestInit = {},
  ) => {
    headers.push((init.headers ?? {}) as Record<string, string>);
    return new Response(
      JSON.stringify({ id: "pref-1", sandbox_init_point: "https://sandbox.mp/checkout" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    await withEnv({ SUPABASE_URL: "https://ardpqimdllzbbdvwamkh.supabase.co", MP_ENV: "sandbox" }, () =>
      mercadopagoProvider.createPayment(credentials(), {
        ...input(),
        idempotencyKey: "mercadopago-abc123",
      }),
    );
    assert.equal(headers[0]!["X-Idempotency-Key"], "mercadopago-abc123");
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = original;
  }
});

test("P4: sem chave de tentativa, mantém compatibilidade com external_reference", async () => {
  const original = globalThis.fetch;
  let sent: Record<string, string> = {};
  (globalThis as unknown as { fetch: unknown }).fetch = async (
    _url: unknown,
    init: RequestInit = {},
  ) => {
    sent = (init.headers ?? {}) as Record<string, string>;
    return new Response(
      JSON.stringify({ id: "pref-2", sandbox_init_point: "https://sandbox.mp/checkout" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    await withEnv({ SUPABASE_URL: "https://ardpqimdllzbbdvwamkh.supabase.co", MP_ENV: "sandbox" }, () =>
      mercadopagoProvider.createPayment(credentials(), input()),
    );
    assert.equal(sent["X-Idempotency-Key"], input().externalReference);
  } finally {
    (globalThis as unknown as { fetch: unknown }).fetch = original;
  }
});
