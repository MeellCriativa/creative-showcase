import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

test("painel WhatsApp habilita a conexão real", () => {
  const page = read("src/routes/painel.whatsapp.tsx");

  assert.match(page, /onClick=\{handleConnect\}/);
  assert.match(page, /startOAuth\.mutateAsync\(\{ catalogId, phoneNumber: normalized \}\)/);
  assert.match(page, /id="whatsapp-phone"/);
  assert.match(page, /disabled=\{startOAuth\.isPending\}/);
  assert.doesNotMatch(page, /common\.comingSoon/);
  assert.doesNotMatch(page, /whatsapp\.comingSoonText/);
  assert.doesNotMatch(page, /whatsapp\.integrationInProgress/);
});

test("textos de conexão existem em pt/en/es", () => {
  const i18n = read("src/i18n/namespaces/whatsapp.ts");

  for (const key of [
    "connectTitle",
    "phoneLabel",
    "phoneHint",
    "connectHint",
    "connectionIssue",
    "reconnect",
  ]) {
    const occurrences = i18n.match(new RegExp(`^\\s{4}${key}:`, "gm")) ?? [];
    assert.equal(occurrences.length, 3, `${key} deve existir nas 3 línguas`);
  }
});

test("OAuth Meta usa o redirect e as permissões esperadas", () => {
  const start = read("supabase/functions/meta-oauth-start/index.ts");
  const callback = read("supabase/functions/meta-oauth-callback/index.ts");

  assert.match(start, /`\$\{vitrineUrl\}\/painel\/whatsapp`/);
  assert.match(start, /const state = catalogId/);
  assert.match(start, /catalog_management,business_management/);
  assert.match(callback, /`\$\{vitrineUrl\}\/painel\/whatsapp`/);
  assert.match(callback, /owned_product_catalogs/);
  assert.match(callback, /grant_type=fb_exchange_token/);
});

test("falha ao salvar conexão Meta nunca é reportada como sucesso", () => {
  const start = read("supabase/functions/meta-oauth-start/index.ts");
  const callback = read("supabase/functions/meta-oauth-callback/index.ts");

  assert.match(start, /const \{ error: phoneSaveError \} = await admin/);
  assert.match(start, /if \(phoneSaveError\)/);
  assert.match(callback, /const \{ error: upsertError \} = await admin/);
  assert.match(callback, /if \(upsertError\)/);
  assert.match(callback, /status: 500/);
});

test("registro pendente da Meta preenche colunas obrigatórias", () => {
  const start = read("supabase/functions/meta-oauth-start/index.ts");

  assert.match(start, /facebook_user_id: "pending"/);
  assert.match(start, /token_expires_at: new Date\(0\)\.toISOString\(\)/);
  assert.match(start, /business_id: ""/);
  assert.match(start, /catalog_id_meta: ""/);
});

test("funções Meta aceitam os nomes de secrets configurados", () => {
  const start = read("supabase/functions/meta-oauth-start/index.ts");
  const callback = read("supabase/functions/meta-oauth-callback/index.ts");

  assert.match(start, /Deno\.env\.get\("META_APP_ID"\) \|\| Deno\.env\.get\("APP_ID_META"\)/);
  assert.match(callback, /Deno\.env\.get\("META_APP_ID"\) \|\| Deno\.env\.get\("APP_ID_META"\)/);
  assert.match(
    callback,
    /Deno\.env\.get\("META_APP_SECRET"\) \|\| Deno\.env\.get\("APP_SECRET_META"\)/,
  );
});
