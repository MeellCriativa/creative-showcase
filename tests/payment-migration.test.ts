import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Auditoria automatizada da migration da Etapa 2.
 *
 * O SQL é lido como texto: comentários são ignorados nas verificações de
 * execução, mas preservados nos testes de rollback.
 */
const MIGRATION_URL = new URL(
  "../supabase/migrations/20261115090000_add_payment_providers.sql",
  import.meta.url,
);

const raw = readFileSync(MIGRATION_URL, "utf8");
const lines = raw.split(/\r?\n/);
const executable = lines
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n")
  .toLowerCase();

const FINANCIAL_TABLES = [
  "payment_connections",
  "order_checkout_sessions",
  "payment_transactions",
  "payment_events",
  "payment_refunds",
];

const REQUIRED_STATUSES = [
  "pending",
  "approved",
  "authorized",
  "captured",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
  "disputed",
];

// ─────────────────────────────────────────────────────────────────────────────
// 1. Estrutura e não destrutividade
// ─────────────────────────────────────────────────────────────────────────────

test("tudo roda em transação (begin/commit)", () => {
  assert.match(executable, /^begin;/m);
  assert.match(executable, /^commit;/m);
});

test("nenhum comando destrutivo é executado", () => {
  assert.doesNotMatch(executable, /drop table/);
  assert.doesNotMatch(executable, /truncate/);
  assert.doesNotMatch(executable, /delete from/);
  assert.doesNotMatch(executable, /drop column/);
  assert.doesNotMatch(executable, /alter column .* type/);
  assert.doesNotMatch(executable, /drop schema/);
});

test("as 5 tabelas financeiras são criadas de forma idempotente", () => {
  for (const table of FINANCIAL_TABLES) {
    assert.match(
      executable,
      new RegExp(`create table if not exists public\\.${table}\\b`),
      `tabela ${table} não criada`,
    );
  }
});

test("colunas novas de orders são nullable/default (sem reescrever histórico)", () => {
  assert.match(executable, /alter table public\.orders/);
  assert.match(executable, /add column if not exists payment_status text not null default 'pending'/);
  assert.match(executable, /add column if not exists payment_provider text/);
  assert.match(executable, /add column if not exists payment_transaction_id uuid/);
  assert.doesNotMatch(executable, /payment_status text not null\s*(,|;)/);
});

test("constraints de pagamento são criadas com guarda (idempotência)", () => {
  assert.match(executable, /orders_payment_status_check/);
  assert.match(executable, /orders_payment_provider_check/);
  assert.match(executable, /if not exists \(\s*select 1 from pg_constraint/);
});

test("estados mínimos exigidos estão no CHECK de status", () => {
  for (const status of REQUIRED_STATUSES) {
    assert.match(
      executable,
      new RegExp(`'${status}'`),
      `estado ${status} ausente`,
    );
  }
});

test("apenas os dois provedores são aceitos", () => {
  assert.match(executable, /provider in \('paypal', 'mercadopago'\)/);
  assert.doesNotMatch(executable, /provider in \([^)]*cakto/);
});

test("valores financeiros têm escala e proteção contra negativo", () => {
  assert.match(executable, /amount\s+numeric\(14, 2\) not null check \(amount >= 0\)/);
  assert.match(executable, /amount_minor\s+bigint not null check \(amount_minor >= 0\)/);
  assert.match(executable, /amount\s+numeric\(14, 2\) not null check \(amount > 0\)/);
});

test("índices únicos impedem conexão e evento duplicados", () => {
  assert.match(executable, /unique \(catalog_id, provider\)/);
  assert.match(executable, /unique \(provider, provider_event_id\)/);
  assert.match(
    executable,
    /create unique index if not exists payment_transactions_provider_payment_key[\s\S]*?where provider_payment_id is not null/,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tokens e segredos
// ─────────────────────────────────────────────────────────────────────────────

test("tokens de provedor só existem em colunas criptografadas", () => {
  assert.match(executable, /access_token_enc\s+text/);
  assert.match(executable, /refresh_token_enc\s+text/);
  // Nenhuma coluna de token em texto puro.
  assert.doesNotMatch(executable, /\baccess_token\s+text/);
  assert.doesNotMatch(executable, /\brefresh_token\s+text/);
  assert.doesNotMatch(executable, /\bclient_secret\b/);
});

test("o token do comprador é persistido apenas como hash", () => {
  assert.match(executable, /token_hash\s+text not null unique/);
  assert.doesNotMatch(executable, /\btoken\s+text not null/);
  assert.match(executable, /expires_at\s+timestamptz not null/);
  assert.match(executable, /consumed_at\s+timestamptz/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. RLS restritiva
// ─────────────────────────────────────────────────────────────────────────────

test("RLS é habilitada em todas as tabelas financeiras", () => {
  for (const table of FINANCIAL_TABLES) {
    assert.match(
      executable,
      new RegExp(`alter table public\\.${table}\\s+enable row level security;`),
      `RLS não habilitada em ${table}`,
    );
  }
});

test("RLS nunca é desabilitada", () => {
  assert.doesNotMatch(executable, /disable row level security/);
  assert.doesNotMatch(executable, /no force row level security/);
});

test("políticas de leitura são owner-only (via join com catalogs.user_id)", () => {
  for (const table of [
    "payment_connections",
    "payment_transactions",
    "payment_events",
    "payment_refunds",
  ]) {
    assert.match(
      executable,
      new RegExp(`create policy ${table}_owner_select on public\\.${table}`),
      `política de leitura ausente em ${table}`,
    );
  }
  assert.match(executable, /c\.user_id = auth\.uid\(\)/);
  // Nenhuma política permissiva.
  assert.doesNotMatch(executable, /using \(true\)/);
  assert.doesNotMatch(executable, /with check \(true\)/);
});

test("sessões de checkout não têm política para anon/authenticated", () => {
  assert.doesNotMatch(executable, /create policy [a-z_]* on public\.order_checkout_sessions/);
  assert.doesNotMatch(executable, /grant (select|all) on public\.order_checkout_sessions/);
});

test("anon não tem nenhum privilégio nas tabelas financeiras", () => {
  for (const table of FINANCIAL_TABLES) {
    assert.match(
      executable,
      new RegExp(`revoke all on public\\.${table}\\s+from anon;`),
      `anon ainda pode acessar ${table}`,
    );
    assert.doesNotMatch(
      executable,
      new RegExp(`grant [^;]*on public\\.${table}[^;]*to anon`),
      `grant indevido para anon em ${table}`,
    );
  }
});

test("authenticated só lê (e só altera `enabled` nas conexões)", () => {
  for (const table of FINANCIAL_TABLES) {
    assert.match(
      executable,
      new RegExp(`revoke insert, update, delete on public\\.${table}\\s+from authenticated;`),
      `escrita de authenticated não revogada em ${table}`,
    );
  }
  assert.match(executable, /grant select on public\.payment_connections\s+to authenticated;/);
  assert.match(executable, /grant update \(enabled\) on public\.payment_connections to authenticated;/);
  assert.doesNotMatch(executable, /grant update on public\.payment_connections/);
  assert.doesNotMatch(executable, /grant (insert|delete) on public\.payment_/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Fechamento das brechas conhecidas
// ─────────────────────────────────────────────────────────────────────────────

test("orders_anon_insert é removida e o INSERT anônimo revogado", () => {
  assert.match(executable, /drop policy if exists orders_anon_insert on public\.orders;/);
  assert.match(executable, /revoke insert on public\.orders from anon;/);
  assert.doesNotMatch(executable, /create policy orders_anon_insert/);
});

test("catalogs deixa de ser legível por anon, preservando catalogs_public", () => {
  assert.match(executable, /drop policy if exists catalogs_anon_read on public\.catalogs;/);
  assert.match(executable, /drop policy if exists catalogs_public_read on public\.catalogs;/);
  assert.match(executable, /revoke select on public\.catalogs from anon;/);
  assert.match(executable, /grant select on public\.catalogs_public to anon;/);
  assert.match(executable, /grant select on public\.catalogs_public to authenticated;/);
});

test("nenhuma outra política é removida ou alterada", () => {
  const dropped = [...executable.matchAll(/drop policy if exists (\w+) on public\.(\w+);/g)].map(
    ([, policy]) => policy,
  );
  assert.deepEqual(dropped.sort(), [
    "catalogs_anon_read",
    "catalogs_public_read",
    "orders_anon_insert",
    "payment_connections_owner_select",
    "payment_connections_owner_update",
    "payment_events_owner_select",
    "payment_refunds_owner_select",
    "payment_transactions_owner_select",
  ]);
  assert.doesNotMatch(executable, /alter policy/);
  assert.doesNotMatch(executable, /drop policy [^;]*on public\.(products|categories|banners|orders_owner)/);
});

test("catalogs_public não é recriada nem perde permissões", () => {
  assert.doesNotMatch(executable, /create or replace view public\.catalogs_public/);
  assert.doesNotMatch(executable, /revoke [^;]*catalogs_public/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Isolamento com a Cakto (assinaturas não são tocadas)
// ─────────────────────────────────────────────────────────────────────────────

test("migration não menciona Cakto, planos ou assinaturas", () => {
  assert.doesNotMatch(executable, /cakto/);
  assert.doesNotMatch(executable, /subscription/);
  assert.doesNotMatch(executable, /\bplans?\b/);
  assert.doesNotMatch(executable, /assinatura/);
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Rollback e recarga de schema
// ─────────────────────────────────────────────────────────────────────────────

test("rollback está documentado e é o único lugar com DROP", () => {
  assert.match(raw, /-- ROLLBACK/);
  assert.match(raw, /-- begin;/);
  for (const table of FINANCIAL_TABLES) {
    assert.match(raw, new RegExp(`--\\s*drop table if exists public\\.${table};`));
  }
  assert.match(raw, /--\s*drop column if exists payment_status;/);
  assert.match(raw, /--\s*grant select on public\.catalogs to anon;/);
  assert.match(raw, /--\s*create policy orders_anon_insert on public\.orders/);
});

test("recarrega o schema do PostgREST ao final", () => {
  assert.match(executable, /notify pgrst, 'reload schema';/);
});
