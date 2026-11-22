/**
 * PKCE S256 do OAuth do Mercado Pago (RFC 7636).
 *
 * Nenhum teste faz rede, banco ou cobrança: fetch é stubado, o "banco" é um
 * store em memória com as MESMAS condições atômicas do SQL e a chave AES é
 * local. Mocks NÃO são apresentados como aprovação do provedor.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decryptSecret,
  encryptSecret,
  generateCodeVerifier,
  isValidCodeVerifier,
  pkceChallenge,
  signState,
  verifyState,
} from "../supabase/functions/_shared/payments/crypto.ts";
import { mercadopagoProvider } from "../supabase/functions/_shared/payments/mercadopago.ts";
import type { ProviderCredentials } from "../supabase/functions/_shared/payments/types.ts";

const ROOT = new URL("../", import.meta.url);
const source = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");

const KEY = "chave-local-de-teste-32-bytes-ok!";
const STATE_SECRET = "state-secret-de-teste";
/** Vetor normativo da RFC 7636, apêndice B. */
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> | T {
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

/* ── Store em memória: mesma condição atômica do SQL de produção ─────────── */

type Grant = {
  nonce: string;
  catalogId: string;
  provider: string;
  userId: string;
  codeChallenge: string | null;
  codeVerifierEncrypted: string | null;
  expiresAtMs: number;
  consumedAt: number | null;
};

function grantStore(rows: Grant[]) {
  return {
    consume(nonce: string, now: number): Grant | null {
      const row = rows.find((r) => r.nonce === nonce);
      // .is("consumed_at", null).gt("expires_at", now()) + UPDATE ... RETURNING
      if (!row || row.consumedAt !== null || row.expiresAtMs <= now) return null;
      row.consumedAt = now;
      return row;
    },
  };
}

async function callbackGrant(
  store: ReturnType<typeof grantStore>,
  payload: Record<string, unknown>,
  now = Date.now(),
): Promise<{ code: string; verifier?: string }> {
  const grant = store.consume(String(payload.nonce ?? ""), now);
  if (!grant) return { code: "state_already_used" };
  if (
    grant.catalogId !== payload.catalog_id ||
    grant.userId !== payload.user_id ||
    grant.provider !== payload.provider
  ) {
    return { code: "invalid_state_binding" };
  }
  if (grant.provider === "mercadopago") {
    if (!grant.codeVerifierEncrypted) return { code: "pkce_verifier_missing" };
    const verifier = await decryptSecret(grant.codeVerifierEncrypted, KEY);
    if (!verifier || !isValidCodeVerifier(verifier)) return { code: "pkce_verifier_invalid" };
    if (grant.codeChallenge && (await pkceChallenge(verifier)) !== grant.codeChallenge) {
      return { code: "pkce_challenge_mismatch" };
    }
    return { code: "ok", verifier };
  }
  return { code: "ok" };
}

function makeGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    nonce: "nonce-1",
    catalogId: "catalogo-1",
    provider: "mercadopago",
    userId: "vendedora-1",
    codeChallenge: RFC_CHALLENGE,
    codeVerifierEncrypted: null,
    expiresAtMs: Date.now() + 60_000,
    consumedAt: null,
    ...overrides,
  };
}

/* ── 1. Geração do verifier ──────────────────────────────────────────────── */

test("PKCE: verifier gerado tem 43 caracteres e charset RFC 7636", () => {
  const verifier = generateCodeVerifier();
  assert.equal(verifier.length, 43);
  assert.match(verifier, /^[A-Za-z0-9\-._~]{43,128}$/);
  assert.equal(isValidCodeVerifier(verifier), true);
});

test("PKCE: verifier é aleatório e respeita 43..128 caracteres", () => {
  const a = generateCodeVerifier();
  const b = generateCodeVerifier();
  assert.notEqual(a, b);
  assert.equal(generateCodeVerifier(96).length, 128);
  assert.equal(isValidCodeVerifier("curto"), false);
  assert.equal(isValidCodeVerifier("!".repeat(43)), false);
  assert.throws(() => generateCodeVerifier(31), /intervalo permitido/);
  assert.throws(() => generateCodeVerifier(97), /intervalo permitido/);
});

/* ── 2. Challenge S256 ───────────────────────────────────────────────────── */

test("PKCE: challenge S256 bate com o vetor normativo da RFC 7636", async () => {
  assert.equal(await pkceChallenge(RFC_VERIFIER), RFC_CHALLENGE);
  assert.equal(RFC_CHALLENGE.length, 43);
  assert.equal(RFC_CHALLENGE.includes("="), false, "Base64URL sem padding");
  assert.notEqual(await pkceChallenge(generateCodeVerifier()), RFC_CHALLENGE);
  await assert.rejects(() => pkceChallenge("curto"), /Verifier PKCE inválido/);
});

/* ── 3. URL de autorização ───────────────────────────────────────────────── */

test("PKCE: URL de autorização leva challenge e método S256, sem verifier", async () => {
  await withEnv({ MP_CLIENT_ID: "app-id", MP_CLIENT_SECRET: "app-secret" }, async () => {
    const url = await mercadopagoProvider.buildAuthorizeUrl({
      state: "estado-assinado",
      redirectUri: "https://projeto.supabase.co/functions/v1/payments-callback",
      codeChallenge: RFC_CHALLENGE,
      codeChallengeMethod: "S256",
    });
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get("code_challenge"), RFC_CHALLENGE);
    assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
    assert.equal(parsed.searchParams.get("state"), "estado-assinado");
    assert.equal(parsed.searchParams.get("response_type"), "code");
    assert.equal(parsed.searchParams.get("platform_id"), "mp");
    assert.equal(parsed.searchParams.has("code_verifier"), false);
    await assert.rejects(
      () =>
        mercadopagoProvider.buildAuthorizeUrl({
          state: "s",
          redirectUri: "https://x/cb",
          codeChallenge: "curto",
        }),
      /pkce_challenge_invalid/,
    );
  });
});

/* ── 4. Recuperação do verifier no callback ──────────────────────────────── */

test("PKCE: callback recupera exatamente o verifier cifrado da tentativa", async () => {
  const verifier = generateCodeVerifier();
  const encrypted = (await encryptSecret(verifier, KEY))!;
  assert.match(encrypted, /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
  assert.equal(encrypted.includes(verifier), false, "verifier nunca em claro no banco");

  const challenge = await pkceChallenge(verifier);
  const store = grantStore([
    makeGrant({ codeChallenge: challenge, codeVerifierEncrypted: encrypted }),
  ]);
  const result = await callbackGrant(store, {
    nonce: "nonce-1",
    catalog_id: "catalogo-1",
    user_id: "vendedora-1",
    provider: "mercadopago",
  });
  assert.equal(result.code, "ok");
  assert.equal(result.verifier, verifier);
  assert.equal(await pkceChallenge(result.verifier!), challenge);
});

test("PKCE: troca de token envia o verifier recuperado", async () => {
  await withEnv({ MP_CLIENT_ID: "app-id", MP_CLIENT_SECRET: "app-secret" }, async () => {
    let body: Record<string, unknown> | null = null;
    await withFetch(
      async (input, init) => {
        if (String(input).endsWith("/oauth/token")) {
          body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return jsonResponse({
            access_token: "at",
            refresh_token: "rt",
            expires_in: 100,
            scope: "offline_access read write",
            user_id: 123,
          });
        }
        return jsonResponse({ id: 123, site_id: "MLB", email: "seller@example.com" });
      },
      async () => {
        await mercadopagoProvider.completeAuthorization({
          query: { code: "codigo" },
          redirectUri: "https://projeto.supabase.co/functions/v1/payments-callback",
          codeVerifier: RFC_VERIFIER,
        });
      },
    );
    assert.equal(body?.code_verifier, RFC_VERIFIER);
    assert.equal(body?.grant_type, "authorization_code");
    assert.equal(body?.redirect_uri, "https://projeto.supabase.co/functions/v1/payments-callback");
  });
});

/* ── 5. Falhas de segurança ──────────────────────────────────────────────── */

test("PKCE: state inválido, adulterado e expirado são recusados", async () => {
  const payload = {
    provider: "mercadopago",
    catalog_id: "catalogo-1",
    user_id: "vendedora-1",
    nonce: "nonce-1",
    env: "production",
    exp: Date.now() + 60_000,
  };
  const state = (await signState(payload, STATE_SECRET))!;
  assert.deepEqual(await verifyState(state, STATE_SECRET), payload);
  assert.equal(await verifyState(state, "outro-segredo"), null);
  const [body, sig] = state.split(".");
  assert.equal(await verifyState(`${body}.${sig === "x" ? "y" : "x"}`, STATE_SECRET), null);
  assert.equal(await verifyState(state, STATE_SECRET, Date.now() + 120_000), null);
});

test("PKCE: verifier expirado não pode ser recuperado", async () => {
  const encrypted = (await encryptSecret(RFC_VERIFIER, KEY))!;
  const store = grantStore([
    makeGrant({
      codeVerifierEncrypted: encrypted,
      expiresAtMs: Date.now() - 1,
    }),
  ]);
  const result = await callbackGrant(store, {
    nonce: "nonce-1",
    catalog_id: "catalogo-1",
    user_id: "vendedora-1",
    provider: "mercadopago",
  });
  assert.equal(result.code, "state_already_used");
  assert.match(source("supabase/functions/_shared/payments/db.ts"), /\.gt\("expires_at"/);
});

test("PKCE: verifier inexistente e ausente retornam erro específico", async () => {
  const empty = grantStore([]);
  assert.equal((await callbackGrant(empty, { nonce: "nao-existe" })).code, "state_already_used");
  const withoutVerifier = grantStore([makeGrant()]);
  assert.equal(
    (
      await callbackGrant(withoutVerifier, {
        nonce: "nonce-1",
        catalog_id: "catalogo-1",
        user_id: "vendedora-1",
        provider: "mercadopago",
      })
    ).code,
    "pkce_verifier_missing",
  );
});

test("PKCE: nonce não pode ser reutilizado", async () => {
  const encrypted = (await encryptSecret(RFC_VERIFIER, KEY))!;
  const store = grantStore([makeGrant({ codeVerifierEncrypted: encrypted })]);
  const payload = {
    nonce: "nonce-1",
    catalog_id: "catalogo-1",
    user_id: "vendedora-1",
    provider: "mercadopago",
  };
  assert.equal((await callbackGrant(store, payload)).code, "ok");
  assert.equal((await callbackGrant(store, payload)).code, "state_already_used");
});

test("PKCE: verifier de outro usuário/catálogo é recusado", async () => {
  const encrypted = (await encryptSecret(RFC_VERIFIER, KEY))!;
  const store = grantStore([makeGrant({ codeVerifierEncrypted: encrypted })]);
  const outroUsuario = await callbackGrant(store, {
    nonce: "nonce-1",
    catalog_id: "catalogo-1",
    user_id: "OUTRA",
    provider: "mercadopago",
  });
  assert.equal(outroUsuario.code, "invalid_state_binding");
  // O nonce já foi queimado pela tentativa legítima de outro lojista: nada vaza.
  const outraLoja = await callbackGrant(
    grantStore([
      makeGrant({
        nonce: "nonce-2",
        codeVerifierEncrypted: encrypted,
      }),
    ]),
    {
      nonce: "nonce-2",
      catalog_id: "OUTRA-LOJA",
      user_id: "vendedora-1",
      provider: "mercadopago",
    },
  );
  assert.equal(outraLoja.code, "invalid_state_binding");
  assert.equal(outraLoja.verifier, undefined);
});

test("PKCE: challenge divergente do verifier quebra a troca", async () => {
  const encrypted = (await encryptSecret(RFC_VERIFIER, KEY))!;
  const store = grantStore([
    makeGrant({
      codeVerifierEncrypted: encrypted,
      codeChallenge: "A".repeat(43),
    }),
  ]);
  assert.equal(
    (
      await callbackGrant(store, {
        nonce: "nonce-1",
        catalog_id: "catalogo-1",
        user_id: "vendedora-1",
        provider: "mercadopago",
      })
    ).code,
    "pkce_challenge_mismatch",
  );
});

/* ── 6. Renovação de token sem regressão ─────────────────────────────────── */

test("PKCE: refresh de access token permanece sem verifier e preserva escopos", async () => {
  const current: ProviderCredentials = {
    accessToken: "antigo",
    refreshToken: "refresh-antigo",
    expiresAt: null,
    scopes: ["offline_access", "read", "write"],
    externalAccountId: "SELLER-A",
    externalAccountLabel: "SELLER-A",
    merchantId: "SELLER-A",
    capabilities: { site_id: "MLB" },
  };
  await withEnv({ MP_CLIENT_ID: "app-id", MP_CLIENT_SECRET: "app-secret" }, async () => {
    let body: Record<string, unknown> | null = null;
    await withFetch(
      async (input, init) => {
        if (String(input).endsWith("/oauth/token")) {
          body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return jsonResponse({
            access_token: "novo",
            refresh_token: "refresh-novo",
            expires_in: 100,
          });
        }
        throw new Error("refresh não deve chamar /users/me");
      },
      async () => {
        const next = await mercadopagoProvider.refreshCredentials({
          refreshToken: "refresh-antigo",
          current,
        });
        assert.equal(next.accessToken, "novo");
        assert.equal(next.refreshToken, "refresh-novo");
        assert.deepEqual(next.scopes, current.scopes);
      },
    );
    assert.equal(body?.grant_type, "refresh_token");
    assert.equal(body?.code_verifier, undefined);
    assert.equal(body?.code, undefined);
  });
});

/* ── 7. Nenhum valor sensível em logs/URL/migration ──────────────────────── */

test("PKCE: verifier não aparece em logs, URL de autorização nem texto do erro", () => {
  const callback = source("supabase/functions/payments-callback/index.ts");
  const connect = source("supabase/functions/payments/index.ts");
  const mp = source("supabase/functions/_shared/payments/mercadopago.ts");
  const migration = source("supabase/migrations/20261120140000_payment_oauth_pkce.sql");

  assert.match(callback, /decryptSecret\(encryptedVerifier\)/);
  assert.match(callback, /consumeOAuthState\(nonce\)/, "PayPal preserva o consumo original");
  assert.match(callback, /codeVerifier \}/);
  assert.match(callback, /pkce_verifier_missing/);
  assert.doesNotMatch(callback, /console\.(log|error|warn)\([^\n]*codeVerifier/);
  assert.match(connect, /generateCodeVerifier\(\)/);
  assert.match(connect, /pkceChallenge\(verifier\)/);
  assert.match(connect, /encryptSecret\(verifier\)/);
  assert.match(mp, /code_challenge_method: "S256"/);
  assert.match(mp, /code_verifier: codeVerifier/);
  assert.match(migration, /code_verifier_encrypted text/);
  assert.doesNotMatch(migration, /drop table|delete from|truncate|revoke /i);
});
