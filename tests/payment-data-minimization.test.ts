import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const MIGRATION_URL = new URL(
  "../supabase/migrations/20261119130000_payment_data_minimization.sql",
  import.meta.url,
);

const sql = readFileSync(MIGRATION_URL, "utf8");
const executable = sql
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .toLowerCase();

test("migração de minimização revoga TODOS os privilégios do navegador", () => {
  for (const table of [
    "payment_connections",
    "payment_transactions",
    "payment_events",
    "payment_refunds",
  ]) {
    assert.match(
      executable,
      new RegExp(`revoke all on table public\\.${table} from anon, authenticated`),
    );
  }
  // TRUNCATE/TRIGGER não são preservados: RLS não protege TRUNCATE.
  assert.equal(/grant\s+truncate/i.test(executable), false);
  assert.equal(/grant\s+trigger/i.test(executable), false);
});

test("toggle de conexão continua disponível via PostgREST", () => {
  assert.match(executable, /grant update \(enabled\) on public\.payment_connections to authenticated/);
});

test("colunas sensíveis NÃO são concedidas ao navegador", () => {
  for (const column of [
    "access_token_enc",
    "refresh_token_enc",
    "external_account_label",
    "payer_reference",
    "checkout_url",
    "payload",
    "processing_error",
    "reason",
  ]) {
    assert.equal(executable.includes(column), false, `${column} não pode ser lido pelo cliente`);
  }
});

test("service_role não é alterado e o schema é recarregado", () => {
  assert.match(executable, /notify pgrst, 'reload schema'/);
  assert.equal(executable.includes("revoke select on public.payment_connections from service_role"), false);
  assert.equal(executable.includes("revoke all on table public.payment_connections from service_role"), false);
});
