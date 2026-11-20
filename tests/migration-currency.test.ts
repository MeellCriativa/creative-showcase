import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Auditoria automatizada da migration da Etapa 1.
 *
 * O arquivo é lido como texto: os testes verificam o SQL que será executado
 * (linhas comentadas são ignoradas, exceto nos testes que checam o rollback).
 */
const MIGRATION_URL = new URL(
  "../supabase/migrations/20261111120000_add_catalog_currency.sql",
  import.meta.url,
);

const raw = readFileSync(MIGRATION_URL, "utf8");
const lines = raw.split(/\r?\n/);
const executable = lines
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .toLowerCase();

/** Colunas da view exatamente como estão em produção hoje. */
const PRODUCTION_VIEW_COLUMNS = [
  "id",
  "user_id",
  "slug",
  "store_name",
  "logo_url",
  "cover_url",
  "whatsapp",
  "primary_color",
  "accent_color",
  "background_color",
  "store_font",
  "logo_size",
  "logo_position",
  "cart_style",
  "banner_enabled",
  "banner_autoplay",
  "banner_interval",
  "banner_indicators",
  "whatsapp_button_color",
  "payment_methods",
  "store_description",
  "instagram_url",
  "owner_photo_url",
  "owner_name",
  "owner_bio",
  "owner_hours",
  "delivery_methods",
  "shipping_origin_zip",
  "created_at",
  "updated_at",
];

function extractViewColumns(sqlText: string): string[] {
  const match = sqlText.match(
    /create or replace view public\.catalogs_public as\s*select\s*([\s\S]*?)\s*from public\.catalogs;/i,
  );
  assert.ok(match, "migration precisa recriar public.catalogs_public");
  return (match as RegExpMatchArray)[1]!
    .split(",")
    .map((column) => column.trim().toLowerCase())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Estrutura da view pública
// ─────────────────────────────────────────────────────────────────────────────

test("view expõe exatamente as colunas atuais + currency no fim", () => {
  const columns = extractViewColumns(raw);
  assert.deepEqual(columns, [...PRODUCTION_VIEW_COLUMNS, "currency"]);
});

test("currency é a última coluna (create or replace só aceita append)", () => {
  const columns = extractViewColumns(raw);
  assert.equal(columns.at(-1), "currency");
  assert.equal(columns.at(-2), "updated_at");
});

test("view não usa select * (evita expor colunas futuras)", () => {
  assert.doesNotMatch(executable, /select\s+\*/);
});

test("view não expõe colunas privadas da loja", () => {
  const columns = extractViewColumns(raw);
  for (const privada of ["plan", "meta_catalog_connected", "user_id_secret"]) {
    assert.equal(columns.includes(privada), false, `coluna privada exposta: ${privada}`);
  }
});

test("view não ativa security_invoker (quebraria o catálogo público)", () => {
  assert.doesNotMatch(executable, /security_invoker/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Permissões
// ─────────────────────────────────────────────────────────────────────────────

test("preserva GRANT de leitura para anon e authenticated", () => {
  assert.match(
    executable,
    /grant select on public\.catalogs_public to anon;/,
    "anon precisa continuar lendo o catálogo público",
  );
  assert.match(
    executable,
    /grant select on public\.catalogs_public to authenticated;/,
    "authenticated precisa continuar lendo o catálogo público",
  );
});

test("não concede permissões de escrita na view pública", () => {
  assert.doesNotMatch(executable, /grant\s+(insert|update|delete|all)\b[^;]*catalogs_public/);
  assert.doesNotMatch(executable, /grant\s+all\b/);
});

test("não altera políticas de RLS de outras tabelas", () => {
  assert.doesNotMatch(executable, /create policy/);
  assert.doesNotMatch(executable, /drop policy/);
  assert.doesNotMatch(executable, /alter policy/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Backfill do histórico financeiro
// ─────────────────────────────────────────────────────────────────────────────

test("pedidos históricos são fixados em BRL", () => {
  assert.match(
    executable,
    /update public\.orders\s+set currency = 'brl'\s+where currency is null;/,
  );
});

test("backfill toca somente a coluna currency", () => {
  const updates = [...executable.matchAll(/update\s+public\.(\w+)\s+set\s+([\s\S]*?)\s+where/gi)];
  assert.ok(updates.length >= 1, "espera ao menos o backfill de orders");
  for (const [, table, setClause] of updates) {
    assert.equal(table, "orders", `UPDATE inesperado na tabela ${table}`);
    const assigned = (setClause ?? "")
      .split(",")
      .map((part) => part.split("=")[0]!.trim())
      .filter(Boolean);
    assert.deepEqual(assigned, ["currency"], "backfill não pode alterar outros campos");
  }
});

test("nenhum valor financeiro é recalculado ou convertido", () => {
  for (const campo of ["total", "subtotal", "items", "shipping_cost", "price"]) {
    assert.doesNotMatch(
      executable,
      new RegExp(`set[^;]*\\b${campo}\\b\\s*=`),
      `migration não pode escrever em ${campo}`,
    );
  }
  assert.doesNotMatch(executable, /\b(round|convert|multiply)\s*\(/);
});

test("backfill é idempotente", () => {
  assert.match(executable, /add column if not exists currency/);
  assert.match(executable, /where currency is null/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Segurança / não destrutividade
// ─────────────────────────────────────────────────────────────────────────────

test("não executa comandos destrutivos", () => {
  assert.doesNotMatch(executable, /drop table/);
  assert.doesNotMatch(executable, /truncate/);
  assert.doesNotMatch(executable, /delete from/);
  assert.doesNotMatch(executable, /drop column/);
  assert.doesNotMatch(executable, /alter column .* type/);
});

test("rollback está documentado e é o único lugar com DROP COLUMN", () => {
  assert.match(raw, /-- ROLLBACK/);
  assert.match(raw, /-- alter table public\.orders drop column if exists currency;/);
  assert.match(raw, /-- alter table public\.catalogs drop column if exists currency;/);
});

test("valida formato ISO 4217 sem travar pedidos legados", () => {
  assert.match(executable, /check \(currency ~ '\^\[a-z\]\{3\}\$'\)/);
  // Pedidos históricos podiam estar sem moeda antes do backfill.
  assert.match(executable, /check \(currency is null or currency ~/);
});

test("recarrega o schema do PostgREST ao final", () => {
  assert.match(executable, /notify pgrst, 'reload schema';/);
});

test("tudo roda em transação (begin/commit)", () => {
  assert.match(executable, /^begin;/m);
  assert.match(executable, /^commit;/m);
});
