/**
 * Auditoria/correção da integração Melhor Envio.
 *
 * Nenhum teste faz rede, banco ou autorização real: as funções puras usam
 * WebCrypto local e os mocks de arquivo garantem o contrato do servidor/UI.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ME_STATE_TTL_MS,
  createOAuthState,
  decryptMeToken,
  encryptMeToken,
  getRedirectUri,
  hashOAuthState,
  readOAuthState,
} from "../supabase/functions/_shared/melhor-envio-oauth.ts";

const ROOT = new URL("../", import.meta.url);
const source = (path: string): string => readFileSync(new URL(path, ROOT), "utf8");

const ENV = {
  PAYMENT_STATE_SECRET: "state-secret-de-teste-melhor-envio",
  PAYMENT_TOKEN_ENCRYPTION_KEY: "chave-local-de-teste-32-bytes-ok!",
  ME_CLIENT_SECRET: "client-secret-de-teste",
  SUPABASE_URL: "https://wdcufpvlbisnqtvmbyso.supabase.co",
};

function withEnv<T>(
  vars: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): T | Promise<T> {
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

const CATALOG = "7fdd223f-8529-45e8-b411-011811574c2c";
const USER = "5b721660-98bc-485b-a5f1-a4c305059937";
const NOW = 1_790_000_000_000;

test("state OAuth é assinado, opaco e vinculado à loja, ao dono e ao ambiente", async () => {
  await withEnv(ENV, async () => {
    const state = await createOAuthState(
      { catalogId: CATALOG, userId: USER, environment: "production" },
      NOW,
    );
    assert.ok(state.includes("."), "state deve ser <payload>.<assinatura>");
    assert.ok(!state.includes(CATALOG), "catalog_id não pode aparecer em claro no state");
    assert.ok(!state.includes(USER), "user_id não pode aparecer em claro no state");

    const parsed = await readOAuthState(state, "production", NOW + 1000);
    assert.equal(parsed?.catalogId, CATALOG);
    assert.equal(parsed?.userId, USER);
    assert.equal(parsed?.environment, "production");
    assert.ok((parsed?.nonce.length ?? 0) >= 16);
    assert.equal(parsed?.expiresAt, NOW + ME_STATE_TTL_MS);
  });
});

test("state é rejeitado se adulterado, expirado, de outro ambiente ou sem assinatura", async () => {
  await withEnv(ENV, async () => {
    const state = await createOAuthState(
      { catalogId: CATALOG, userId: USER, environment: "sandbox" },
      NOW,
    );
    assert.ok(await readOAuthState(state, "sandbox", NOW));
    assert.equal(await readOAuthState(state, "production", NOW), null);
    assert.equal(await readOAuthState(state, "sandbox", NOW + ME_STATE_TTL_MS + 1), null);

    const [payload, signature] = state.split(".");
    const tampered = `${payload}.${signature === "a" ? "b" : "a"}${signature!.slice(1)}`;
    assert.equal(await readOAuthState(tampered, "sandbox", NOW), null);
    assert.equal(await readOAuthState(CATALOG, "sandbox", NOW), null);
    assert.equal(await readOAuthState(null, "sandbox", NOW), null);
  });
});

test("nonce do state é único entre duas autorizações", async () => {
  await withEnv(ENV, async () => {
    const a = await createOAuthState(
      { catalogId: CATALOG, userId: USER, environment: "sandbox" },
      NOW,
    );
    const b = await createOAuthState(
      { catalogId: CATALOG, userId: USER, environment: "sandbox" },
      NOW,
    );
    assert.notEqual(a, b);
    assert.notEqual(await hashOAuthState(a), await hashOAuthState(b));
    assert.equal(await hashOAuthState(a), await hashOAuthState(a));
  });
});

test("tokens são cifrados em repouso e tokens antigos em texto puro continuam válidos", async () => {
  await withEnv(ENV, async () => {
    const encrypted = await encryptMeToken("access-token-sensivel");
    assert.ok(encrypted?.startsWith("v1:"), "token novo deve ser cifrado");
    assert.ok(!encrypted?.includes("access-token-sensivel"));
    assert.equal(await decryptMeToken(encrypted), "access-token-sensivel");

    // Contas conectadas antes da correção têm token em texto puro no banco.
    assert.equal(await decryptMeToken("token-antigo-em-texto-puro"), "token-antigo-em-texto-puro");

    assert.equal(await decryptMeToken(`${encrypted!.slice(0, -2)}xx`), null);
    assert.equal(await encryptMeToken(null), null);
  });
});

test("redirect URI é única e configurável, com padrão na Edge Function de produção", async () => {
  assert.equal(
    await withEnv({ SUPABASE_URL: ENV.SUPABASE_URL }, () => getRedirectUri()),
    "https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/melhor-envio-callback",
  );
  assert.equal(
    await withEnv(
      { SUPABASE_URL: ENV.SUPABASE_URL, ME_REDIRECT_URI: "https://exemplo.test/cb/" },
      () => getRedirectUri(),
    ),
    "https://exemplo.test/cb/functions/v1/melhor-envio-callback",
  );
});

test("callback valida state, dono da loja, consumo único e não loga tokens", () => {
  const callback = source("supabase/functions/melhor-envio-callback/index.ts");
  assert.match(callback, /readOAuthState\(state, env\)/);
  assert.match(callback, /catalog\.user_id !== stateData\.userId/);
  assert.match(callback, /consume_melhor_envio_oauth_state/);
  assert.match(callback, /getRedirectUri\(\)/);
  assert.match(callback, /encryptMeToken\(tokenData\.access_token/);
  assert.doesNotMatch(callback, /console\.log\([^\n]*rawText/);
  assert.doesNotMatch(callback, /console\.(log|error)\([^\n]*access_token/);
  assert.doesNotMatch(callback, /state \|\| ""/);
});

test("autorização usa state seguro e operações de envio são isoladas por loja", () => {
  const router = source("supabase/functions/melhor-envio/index.ts");
  assert.match(router, /createOAuthState\(\{/);
  assert.match(router, /recordOAuthState\(state, catalogId, ctx\.user!\.id, env\)/);
  assert.match(router, /getRedirectUri\(\)/);
  assert.doesNotMatch(router, /const state = `\$\{catalogId\}`/);
  assert.match(router, /async function getOwnedMeOrder/);
  assert.match(router, /getOwnedMeOrder\(ctx, catalogId, meOrderId\)/);
  assert.match(router, /\.eq\("catalog_id", catalogId\)/);

  const shared = source("supabase/functions/_shared/melhor-envio.ts");
  assert.match(shared, /getBase\(account\.environment \|\| getPlatformEnv\(\)\)/);
  assert.match(shared, /decryptMeToken\(row\.access_token\)/);
  assert.match(shared, /encryptMeToken\(data\.access_token as string\)/);
});

test("migration de segurança é aditiva e bloqueia acesso cruzado via RLS", () => {
  const sql = source("supabase/migrations/20261126000000_melhor_envio_oauth_security.sql");
  assert.match(sql, /create table if not exists public\.melhor_envio_oauth_states/);
  assert.match(sql, /enable row level security/);
  assert.match(
    sql,
    /revoke all on table public\.melhor_envio_oauth_states from anon, authenticated/,
  );
  assert.match(sql, /grant all on table public\.melhor_envio_oauth_states to service_role/);
  assert.match(sql, /create or replace function public\.consume_melhor_envio_oauth_state/);
  assert.match(sql, /s\.consumed_at is null/);
  assert.match(
    sql,
    /revoke execute on function public\.consume_melhor_envio_oauth_state\(text\) from public, anon, authenticated/,
  );
});

test("instruções ficam abaixo do botão de conexão e existem em pt/en/es", () => {
  const page = source("src/routes/painel.envio.tsx");
  const buttonEnd = page.indexOf("</button>");
  const instructions = page.indexOf('aria-label={t("shipping.guide.title")}');
  assert.ok(buttonEnd > 0 && instructions > buttonEnd, "bloco deve vir depois do botão");
  for (const key of [
    "shipping.guide.step1",
    "shipping.guide.step6",
    "shipping.guide.importantTitle",
    "shipping.guide.important4",
    "shipping.guide.important5",
    "shipping.guide.important6",
    "shipping.guide.helpTitle",
    "shipping.sandboxNoticeTitle",
    "shipping.sandboxNotice",
  ]) {
    assert.ok(page.includes(key), `falta usar ${key} no painel`);
  }
  assert.match(page, /status\?\.environment === "sandbox"/);
  assert.ok(
    page.indexOf('t("shipping.sandboxNoticeTitle")') < buttonEnd,
    "aviso de sandbox deve aparecer antes do botão",
  );

  const i18n = source("src/i18n/namespaces/shipping.ts");
  for (const locale of ["ptBR", "en", "es"]) {
    assert.ok(i18n.includes(`${locale}:`), `falta idioma ${locale}`);
  }
  assert.equal(
    (i18n.match(/title: "(?:Como conectar|How to connect|Cómo conectar)/g) || []).length,
    3,
  );
  assert.equal((i18n.match(/important1:/g) || []).length, 3);
  assert.equal((i18n.match(/important5:/g) || []).length, 3);
  assert.equal((i18n.match(/important6:/g) || []).length, 3);
  assert.equal((i18n.match(/sandboxNoticeTitle:/g) || []).length, 3);
  assert.equal((i18n.match(/helpText:/g) || []).length, 3);
  assert.match(i18n, /mesmo e-mail da sua conta na Vitrine Criativa/);
  assert.match(i18n, /mesmo e-mail da sua loja/);
});

test("credenciais da plataforma nunca chegam ao frontend", () => {
  const frontendFiles = [
    "src/lib/shipping.ts",
    "src/routes/painel.envio.tsx",
    "src/routes/painel.pedidos.tsx",
  ];
  for (const file of frontendFiles) {
    const code = source(file);
    assert.doesNotMatch(code, /ME_CLIENT_SECRET/);
    assert.doesNotMatch(code, /refresh_token/);
  }
});
