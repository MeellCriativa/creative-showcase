/**
 * Testes determinísticos das correções M1–M4 (Mercado Pago) e P3–P5 (PayPal).
 *
 * Nenhum teste faz rede, banco ou cobrança: fetch é sempre stubado, HMAC é
 * calculado localmente e as verificações de fluxo usam leitura de código-fonte.
 * Mocks NÃO são apresentados como comprovação de aprovação do provedor.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { signState, verifyState } from "../supabase/functions/_shared/payments/crypto.ts";
import {
  checkCurrencySupport,
  MERCADOPAGO_SITE_CURRENCIES,
} from "../supabase/functions/_shared/payments/currencies.ts";
import {
  detectDivergence,
  detectPaymentOwnershipMismatch,
  paypalAccountMatchesConnection,
  paymentConfirmationGate,
} from "../supabase/functions/_shared/payments/lifecycle.ts";
import { mercadopagoProvider, mpScopesFromToken } from "../supabase/functions/_shared/payments/mercadopago.ts";
import {
  paypalProvider,
  paypalSnapshotFromOrder,
} from "../supabase/functions/_shared/payments/paypal.ts";
import { eventDecision } from "../supabase/functions/_shared/payments/lifecycle.ts";
import type { ProviderCredentials } from "../supabase/functions/_shared/payments/types.ts";

const ROOT = new URL("../", import.meta.url);
const source = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");

const STATE_SECRET = "state-secret-de-teste";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

const CREDENTIALS: ProviderCredentials = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: null,
  scopes: ["offline_access", "read", "write"],
  externalAccountId: "SELLER-A",
  externalAccountLabel: "SELLER-A",
  merchantId: "SELLER-A",
  capabilities: { site_id: "MLB" },
};

/* ────────────────────────────────────────────────────────────────────────────
 * M1 — decisão registrada: sem PKCE; state/nonce e assinatura de webhook
 * ──────────────────────────────────────────────────────────────────────────── */

test("M1: PKCE permanece fora do escopo — sem challenge/verifier no fluxo", async () => {
  const env = {
    MP_CLIENT_ID: "app-id",
    MP_CLIENT_SECRET: "app-secret",
    PAYMENT_STATE_SECRET: STATE_SECRET,
  };
  await withEnv(env, async () => {
    const url = await mercadopagoProvider.buildAuthorizeUrl({
      state: "state-valido",
      redirectUri: "https://projeto.supabase.co/functions/v1/payments-callback",
    });
    assert.doesNotMatch(url, /code_challenge/);
    assert.doesNotMatch(url, /code_challenge_method/);
    assert.doesNotMatch(url, /[?&]scope=/);

    let tokenBody: Record<string, unknown> | null = null;
    await withFetch(async (input, init) => {
      const target = String(input);
      if (target.endsWith("/oauth/token")) {
        tokenBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return jsonResponse({
          access_token: "at", refresh_token: "rt", expires_in: 100,
          scope: "offline_access read write", user_id: 123,
        });
      }
      return jsonResponse({ id: 123, site_id: "MLB", email: "seller@example.com" });
    }, async () => {
      await mercadopagoProvider.completeAuthorization({
        query: { code: "codigo" },
        redirectUri: "https://projeto.supabase.co/functions/v1/payments-callback",
      });
    });
    assert.ok(tokenBody);
    assert.equal((tokenBody as Record<string, unknown>).code_verifier, undefined);

    // Comentários explicam a decisão; aqui verificamos que nenhum código foi
    // adicionado (only comments mention PKCE).
    assert.doesNotMatch(source("supabase/functions/_shared/payments/types.ts"), /codeChallenge\?:|codeVerifier\?:/);
    assert.doesNotMatch(
      source("supabase/functions/_shared/payments/mercadopago.ts"),
      /query\.set\("code_challenge"|code_verifier:\s*codeVerifier|mpPkceEnabled/,
    );
    assert.doesNotMatch(
      source("supabase/functions/payments/index.ts"),
      /usePkce|codeVerifierEnc|mpPkceEnabled|pkceChallenge/,
    );
    assert.doesNotMatch(
      source("supabase/functions/payments-callback/index.ts"),
      /consumeOAuthStateWithVerifier|payload\.pkce|codeVerifier:/,
    );
    assert.doesNotMatch(source("supabase/functions/_shared/payments/db.ts"), /code_verifier_enc/);
  });
});

test("M1: state assinado aceita campos de ambiente/loja e continua expirando", async () => {
  const payload = {
    catalog_id: "catalogo", user_id: "vendedora", provider: "mercadopago",
    env: "production", nonce: "nonce-1", site_id: "MLA",
    exp: Date.now() + 60_000,
  };
  const state = await signState(payload, STATE_SECRET);
  assert.ok(state);
  const verified = await verifyState(state, STATE_SECRET);
  assert.deepEqual(verified, payload);

  assert.equal(await verifyState(state, STATE_SECRET, Date.now() + 120_000), null);
  const [body, sig] = state!.split(".");
  const adulterado = `${body}.${sig === "x" ? "y" : "x"}`;
  assert.equal(await verifyState(adulterado, STATE_SECRET), null);
});

test("M1: nonce de uso único não pode ser reutilizado", async () => {
  // Store em memória com a MESMA condição atômica do SQL (consumed_at IS NULL).
  const store = new Map<string, { consumed: boolean; expiresAt: number }>([
    ["nonce-valido", { consumed: false, expiresAt: Date.now() + 60_000 }],
  ]);
  const consume = (nonce: string): boolean => {
    const row = store.get(nonce);
    if (!row || row.consumed || row.expiresAt <= Date.now()) return false;
    row.consumed = true;
    return true;
  };
  assert.equal(consume("nonce-valido"), true);
  assert.equal(consume("nonce-valido"), false);
  assert.equal(consume("nonce-inexistente"), false);
  const callback = source("supabase/functions/payments-callback/index.ts");
  assert.match(callback, /consumeOAuthState\(nonce\)/);
  assert.match(callback, /state_already_used/);
});

test("M1: assinatura de webhook MP válida/inválida é verificada localmente", async () => {
  const secret = "webhook-secret";
  const payload = { type: "payment", data: { id: "12345" } };
  const ts = String(Math.floor(Date.now() / 1000));
  const manifest = `id:12345;request-id:req-1;ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  const request = {
    rawBody: JSON.stringify(payload),
    headers: { "x-request-id": "req-1", "x-signature": `ts=${ts},v1=${v1}` },
    query: {},
  };
  const valid = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: secret }, () =>
    mercadopagoProvider.verifyWebhook(request),
  );
  assert.equal(valid.valid, true);
  const invalid = await withEnv({ MERCADOPAGO_WEBHOOK_SECRET: secret }, () =>
    mercadopagoProvider.verifyWebhook({ ...request, headers: { ...request.headers, "x-signature": `ts=${ts},v1=deadbeef` } }),
  );
  assert.equal(invalid.valid, false);
});

/* ────────────────────────────────────────────────────────────────────────────
 * M2 — escopos concedidos
 * ──────────────────────────────────────────────────────────────────────────── */

test("M2: escopos são normalizados por espaço e vírgula", () => {
  const parsed = mpScopesFromToken(" OFFLINE_ACCESS, read ,write ");
  assert.deepEqual(parsed.scopes, ["offline_access", "read", "write"]);
  assert.equal(parsed.known, true);
  assert.deepEqual(parsed.missing, []);
});

test("M2: scope ausente ou parcial nunca vira permissão concedida", async () => {
  assert.equal(mpScopesFromToken(null).known, false);
  assert.deepEqual(mpScopesFromToken("read, write").missing, ["offline_access"]);
  assert.deepEqual(mpScopesFromToken("offline_access read").missing, ["write"]);

  await withEnv({ MP_CLIENT_ID: "app-id", MP_CLIENT_SECRET: "app-secret" }, async () => {
    await withFetch(async (input) => {
      if (String(input).endsWith("/oauth/token")) {
        return jsonResponse({ access_token: "at", scope: "read write", user_id: 123 });
      }
      return jsonResponse({ id: 123 });
    }, async () => {
      await assert.rejects(
        () => mercadopagoProvider.completeAuthorization({ query: { code: "c" }, redirectUri: "https://x/cb" }),
        /permissions_not_granted/,
      );
    });
  });
});

test("M2: token inválido/expirado e refresh sem permissões falham fechado", async () => {
  await withEnv({ MP_CLIENT_ID: "app-id", MP_CLIENT_SECRET: "app-secret" }, async () => {
    await withFetch(async () => jsonResponse({ message: "invalid_grant" }, 401), async () => {
      await assert.rejects(() => mercadopagoProvider.refreshCredentials({
        refreshToken: "expirado", current: CREDENTIALS,
      }), /renovar a autorização/);
    });
    await withFetch(async () => jsonResponse({
      access_token: "at2", scope: "read write", expires_in: 100,
    }), async () => {
      await assert.rejects(() => mercadopagoProvider.refreshCredentials({
        refreshToken: "rt", current: CREDENTIALS,
      }), /perdeu permissões/);
    });
    await withFetch(async () => jsonResponse({ access_token: "at3", expires_in: 100 }), async () => {
      const refreshed = await mercadopagoProvider.refreshCredentials({
        refreshToken: "rt", current: CREDENTIALS,
      });
      assert.deepEqual(refreshed.scopes, CREDENTIALS.scopes);
    });
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * M3 — revogação sinalizada, nunca simulada
 * ──────────────────────────────────────────────────────────────────────────── */

test("M3: revoke sinaliza ação manual e não inventa endpoint", async () => {
  const mp = await mercadopagoProvider.revoke(CREDENTIALS);
  assert.equal(mp.remoteRevoked, false);
  assert.equal(mp.manualRequired, true);
  const pp = await paypalProvider.revoke(CREDENTIALS);
  assert.equal(pp.remoteRevoked, false);
  assert.equal(pp.manualRequired, true);
  const mpSource = source("supabase/functions/_shared/payments/mercadopago.ts");
  assert.doesNotMatch(mpSource, /oauth\/credentials/);
});

test("M3: desconectar apaga o local e devolve o aviso de revogação", () => {
  const index = source("supabase/functions/payments/index.ts");
  const start = index.indexOf("async function disconnectAction");
  const end = index.indexOf("async function verifyAction", start);
  const block = index.slice(start, end);
  assert.match(block, /deleteConnection\(catalog\.id, provider\)/);
  assert.match(block, /revocation/);
  assert.match(block, /manualRequired:\s*true/);
  const panel = source("src/routes/painel.pagamentos.tsx");
  assert.match(panel, /disconnectManualRevokeWarning/);
  for (const lang of ["pt", "en", "es"]) {
    const dict = source("src/i18n/namespaces/payments.ts");
    assert.ok(dict.includes("disconnectManualRevokeWarning"));
    void lang;
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * M4 — site_id e liquidação
 * ──────────────────────────────────────────────────────────────────────────── */

test("M4: URL usa MLB por padrão e o site informado quando válido", async () => {
  await withEnv({ MP_CLIENT_ID: "app-id", MP_CLIENT_SECRET: "app-secret" }, async () => {
    const base = "https://auth.mercadopago.com.br/authorization";
    const fallback = await mercadopagoProvider.buildAuthorizeUrl({ state: "s", redirectUri: "https://x/cb" });
    assert.match(fallback, /site_id=MLB/);
    const explicit = await mercadopagoProvider.buildAuthorizeUrl({ state: "s", redirectUri: "https://x/cb", siteId: "mla" });
    assert.match(explicit, /site_id=MLA/);
    assert.ok(explicit.startsWith(base));
    assert.equal(MERCADOPAGO_SITE_CURRENCIES["MLZ"], undefined);
    const connect = source("supabase/functions/payments/index.ts");
    assert.match(connect, /MERCADOPAGO_SITE_CURRENCIES\[rawSite\]/);
  });
});

test("M4: site desconhecido bloqueia escrita, leitura permanece fail-open", () => {
  const write = checkCurrencySupport("mercadopago", { currency: "BRL", accountSiteId: null, requireKnownSite: true });
  assert.equal(write.supported, false);
  assert.equal(write.code === "account_site_unknown", true);
  const read = checkCurrencySupport("mercadopago", { currency: "BRL", accountSiteId: null });
  assert.equal(read.supported, true);
  const mismatch = checkCurrencySupport("mercadopago", { currency: "BRL", accountSiteId: "MLA", requireKnownSite: true });
  assert.equal(mismatch.supported, false);
  assert.equal(mismatch.code, "account_currency_mismatch");
});

test("M4: verifyConnection não apaga o site_id já persistido", async () => {
  await withEnv({ MP_CLIENT_ID: "app-id", MP_CLIENT_SECRET: "app-secret" }, async () => {
    await withFetch(async () => jsonResponse({ id: 123, nickname: "loja" }), async () => {
      const verified = await mercadopagoProvider.verifyConnection({
        ...CREDENTIALS, capabilities: { site_id: "MLA", scopes_known: true },
      });
      assert.equal(verified.ok, true);
      assert.equal(verified.capabilities.site_id, "MLA");
      assert.equal(verified.capabilities.scopes_known, true);
    });
  });
});

test("M4: divergência de país é sinalizada no callback e exibida no painel", () => {
  const callback = source("supabase/functions/payments-callback/index.ts");
  assert.match(callback, /siteMismatch/);
  assert.match(callback, /site_mismatch:\s*"1"/);
  const panel = source("src/routes/painel.pagamentos.tsx");
  assert.match(panel, /params\.get\("site_mismatch"\)/);
  assert.match(panel, /payments\.siteMismatchWarning/);
  const dict = source("src/i18n/namespaces/payments.ts");
  assert.equal((dict.match(/siteMismatchWarning:/g) ?? []).length, 3);
});

/* ────────────────────────────────────────────────────────────────────────────
 * P3/P4/P5 — PayPal: referência, merchant e isolamento antes da captura
 * ──────────────────────────────────────────────────────────────────────────── */

function paypalOrder(merchantId: string, externalReference = ORDER_ID): Record<string, unknown> {
  return {
    id: "ORDER-1",
    status: "APPROVED",
    purchase_units: [{
      reference_id: externalReference,
      custom_id: externalReference,
      payee: { merchant_id: merchantId },
      amount: { currency_code: "BRL", value: "10.00" },
      payments: {
        captures: [{
          id: "CAPTURE-1",
          status: "COMPLETED",
          amount: { currency_code: "BRL", value: "10.00" },
          payee: { merchant_id: merchantId },
        }],
      },
    }],
  };
}

test("P3: snapshot PayPal expõe pedido e conta da ordem oficial", () => {
  const snapshot = paypalSnapshotFromOrder(paypalOrder("MERCHANT-A"), "ORDER-1");
  assert.ok(snapshot);
  assert.equal(snapshot.externalReference, ORDER_ID);
  assert.equal(snapshot.sellerAccountId, "MERCHANT-A");
  assert.equal(snapshot.status, "captured");
  const semConta = paypalSnapshotFromOrder({
    id: "ORDER-2", status: "APPROVED", purchase_units: [{ custom_id: ORDER_ID, amount: { currency_code: "BRL", value: "1" } }],
  }, "ORDER-2");
  assert.equal(semConta?.sellerAccountId, null);
});

test("P3: requireOrderReference/requireSellerAccount valem para os dois provedores", () => {
  const missing = detectPaymentOwnershipMismatch({
    expectedOrderId: ORDER_ID,
    snapshotOrderId: null,
    expectedSellerId: "SELLER-A",
    snapshotSellerId: null,
    requireOrderReference: true,
    requireSellerAccount: true,
  });
  assert.equal(missing.missingOrderReference, true);
  assert.equal(missing.missingSellerAccount, true);
  assert.equal(missing.hasMismatch, true);
  const webhooks = source("supabase/functions/_shared/payments/webhooks.ts");
  assert.match(webhooks, /requireOrderReference:\s*true/);
  assert.match(webhooks, /requireSellerAccount:\s*true/);
});

test("P4/P5: merchant divergente ou ausente bloqueia; conta correta libera", () => {
  assert.equal(paypalAccountMatchesConnection({
    snapshotMerchantId: "MERCHANT-A",
    connectionMerchantId: "MERCHANT-A",
    connectionExternalAccountId: "MERCHANT-A",
  }), true);
  assert.equal(paypalAccountMatchesConnection({
    snapshotMerchantId: "MERCHANT-B",
    connectionMerchantId: "MERCHANT-A",
    connectionExternalAccountId: "MERCHANT-A",
  }), false);
  assert.equal(paypalAccountMatchesConnection({
    snapshotMerchantId: "merchant-a",
    connectionMerchantId: "MERCHANT-A",
  }), false);
  assert.equal(paypalAccountMatchesConnection({
    snapshotMerchantId: null,
    connectionMerchantId: "MERCHANT-A",
  }), false);
  assert.equal(paypalAccountMatchesConnection({
    snapshotMerchantId: "MERCHANT-A",
    connectionMerchantId: null,
    connectionExternalAccountId: null,
  }), false);
  const webhooks = source("supabase/functions/_shared/payments/webhooks.ts");
  assert.match(webhooks, /paypal_merchant_mismatch/);
  assert.match(webhooks, /cross_seller_event/);
});

test("P4: notificação resolve a conta oficial e o webhooks a compara com a loja", async () => {
  const env = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_PARTNER_ID: "partner", PAYPAL_WEBHOOK_ID: "wh" };
  await withEnv(env, async () => {
    await withFetch(async (input) => {
      const target = String(input);
      if (target.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "platform-token" });
      if (target.includes("/v2/checkout/orders/")) return jsonResponse(paypalOrder("MERCHANT-A"));
      throw new Error(`fetch inesperado: ${target}`);
    }, async () => {
      const resolved = await paypalProvider.resolveNotification({ ...CREDENTIALS }, { type: "CHECKOUT.ORDER.APPROVED", id: "ORDER-1" });
      assert.equal(resolved?.externalReference, ORDER_ID);
      assert.equal(resolved?.sellerAccountId, "MERCHANT-A");
    });
  });
});

test("P5: valor divergente, moeda errada e vendedor incorreto não confirmam o pedido", () => {
  const amount = detectDivergence({
    expectedAmount: 10, expectedCurrency: "BRL",
    snapshotAmount: 9.50, snapshotCurrency: "BRL", decimals: 2,
  });
  assert.equal(amount.hasDivergence, true);
  const currency = detectDivergence({
    expectedAmount: 10, expectedCurrency: "BRL",
    snapshotAmount: 10, snapshotCurrency: "USD", decimals: 2,
  });
  assert.equal(currency.currencyMismatch, true);
  const ownership = detectPaymentOwnershipMismatch({
    expectedOrderId: ORDER_ID,
    snapshotOrderId: ORDER_ID,
    expectedSellerId: "SELLER-A",
    snapshotSellerId: "SELLER-B",
    requireOrderReference: true,
    requireSellerAccount: true,
  });
  assert.equal(ownership.sellerMismatch, true);
  assert.equal(paymentConfirmationGate({ divergence: amount, ownership }).allow, false);
  assert.equal(paymentConfirmationGate({ divergence: currency, ownership }).allow, false);

  // Alteração indevida de status: a sincronização do pedido vem DEPOIS do gate.
  const webhooks = source("supabase/functions/_shared/payments/webhooks.ts");
  const gateAt = webhooks.indexOf("if (!checked.gate.allow)");
  const syncAt = webhooks.indexOf("const synced = await syncOrderPayment");
  assert.ok(gateAt > 0 && syncAt > gateAt);
});

test("P3: webhook duplicado responde 200 sem reprocessar", () => {
  assert.equal(eventDecision({ valid: true, existing: true, processed: true }), "duplicate");
  assert.equal(eventDecision({ valid: true, existing: true, processed: false }), "reprocess");
  assert.equal(eventDecision({ valid: false, existing: false, processed: false }), "reject");
});

test("P5: assinatura PayPal é confirmada ONLY pela API oficial", async () => {
  const env = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_WEBHOOK_ID: "wh" };
  const request = {
    rawBody: JSON.stringify({ id: "EVENT-1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "ORDER-1" } }),
    headers: {
      "paypal-auth-algo": "SHA256withRSA",
      "paypal-cert-url": "https://cert.example/cert.pem",
      "paypal-transmission-id": "trans-1",
      "paypal-transmission-sig": "sig-1",
      "paypal-transmission-time": "2026-11-20T00:00:00Z",
    },
    query: {},
  };
  await withEnv(env, async () => {
    let verificationBody: Record<string, unknown> | null = null;
    await withFetch(async (input, init) => {
      const target = String(input);
      if (target.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "platform-token" });
      if (target.endsWith("/v1/notifications/verify-webhook-signature")) {
        verificationBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return jsonResponse({ verification_status: "SUCCESS" });
      }
      throw new Error(`fetch inesperado: ${target}`);
    }, async () => {
      const valid = await paypalProvider.verifyWebhook(request);
      assert.equal(valid.valid, true);
      assert.equal(valid.eventId, "EVENT-1");
    });
    assert.equal(verificationBody?.auth_algo, "SHA256withRSA");
    assert.equal(verificationBody?.transmission_id, "trans-1");
    assert.equal(verificationBody?.webhook_id, "wh");

    await withFetch(async (input) => {
      if (String(input).endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "platform-token" });
      return jsonResponse({ verification_status: "FAILURE" });
    }, async () => {
      const invalid = await paypalProvider.verifyWebhook(request);
      assert.equal(invalid.valid, false);
    });
  });
});

test("captura e reembolso duplicados usam a MESMA chave de idempotência", async () => {
  const env = { PAYPAL_CLIENT_ID: "id", PAYPAL_CLIENT_SECRET: "secret", PAYPAL_PARTNER_ID: "partner" };
  await withEnv(env, async () => {
    const captureKeys: string[] = [];
    await withFetch(async (input, init) => {
      const target = String(input);
      if (target.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "platform-token" });
      if (target.includes("/capture")) {
        captureKeys.push(String((init?.headers as Record<string, string>)["PayPal-Request-Id"]));
        return jsonResponse({ details: [{ issue: "ORDER_ALREADY_CAPTURED" }] }, 422);
      }
      return jsonResponse(paypalOrder("MERCHANT-A"));
    }, async () => {
      const first = await paypalProvider.capture(CREDENTIALS, "ORDER-1");
      const second = await paypalProvider.capture(CREDENTIALS, "ORDER-1");
      assert.equal(first?.status, "captured");
      assert.equal(second?.status, "captured");
    });
    assert.deepEqual(captureKeys, ["capture-ORDER-1", "capture-ORDER-1"]);

    const refundKeys: string[] = [];
    await withFetch(async (input, init) => {
      const target = String(input);
      if (target.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "platform-token" });
      refundKeys.push(String((init?.headers as Record<string, string>)["PayPal-Request-Id"]));
      return jsonResponse({ id: "REFUND-1", status: "COMPLETED", amount: { value: "10.00" } });
    }, async () => {
      const input = {
        providerPaymentId: "CAPTURE-1", amount: 10, currency: "BRL",
        idempotencyKey: "operacao-unica", reason: "teste",
      };
      const a = await paypalProvider.refund(CREDENTIALS, input);
      const b = await paypalProvider.refund(CREDENTIALS, input);
      assert.equal(a.providerRefundId, "REFUND-1");
      assert.equal(b.providerRefundId, "REFUND-1");
    });
    assert.deepEqual(refundKeys, ["operacao-unica", "operacao-unica"]);
  });
});
