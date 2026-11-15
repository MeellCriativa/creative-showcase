-- ═══════════════════════════════════════════════════════════════════════════
-- Etapa 2 — Formas de pagamento por vendedor (PayPal + Mercado Pago)
-- ═══════════════════════════════════════════════════════════════════════════
-- Escopo:
--   * conexões financeiras por catálogo/provedor (tokens SEMPRE criptografados)
--   * transações, eventos de webhook (idempotentes) e histórico de reembolsos
--   * sessões de checkout (token de uso único) para criação segura de pedidos
--   * fechamento de duas brechas conhecidas:
--       - orders_anon_insert WITH CHECK (true)  → removida
--       - catalogs legível por anon             → removida (view catalogs_public
--                                                 continua sendo a via pública)
--
-- Não destrutivo: apenas CREATE TABLE/INDEX/POLICY e ADD COLUMN nullable.
-- Nenhuma coluna existente é removida ou renomeada.
-- Nenhum valor histórico é recalculado.
-- RLS é habilitada (nunca desabilitada) em todas as tabelas novas.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Orders: estado de pagamento (colunas novas, nullable/com default) ────
alter table public.orders
  add column if not exists payment_status text not null default 'pending',
  add column if not exists payment_provider text,
  add column if not exists payment_transaction_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_payment_status_check'
  ) then
    alter table public.orders
      add constraint orders_payment_status_check
      check (payment_status in (
        'pending', 'approved', 'authorized', 'captured',
        'failed', 'cancelled', 'refunded', 'partially_refunded', 'disputed'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_payment_provider_check'
  ) then
    alter table public.orders
      add constraint orders_payment_provider_check
      check (payment_provider is null or payment_provider in ('paypal', 'mercadopago'));
  end if;
end
$$;

-- ── 2. Conexões financeiras (uma por catálogo + provedor) ──────────────────
create table if not exists public.payment_connections (
  id                     uuid primary key default gen_random_uuid(),
  catalog_id             uuid not null references public.catalogs(id) on delete cascade,
  provider               text not null check (provider in ('paypal', 'mercadopago')),
  environment            text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  status                 text not null default 'pending'
                           check (status in ('pending', 'connected', 'expired', 'revoked', 'error')),
  enabled                boolean not null default false,
  connected              boolean not null default false,
  external_account_id    text,          -- merchant id (PayPal) / user id (Mercado Pago)
  external_account_label text,          -- e-mail ou apelido MASCARADO para exibição
  merchant_id            text,
  scopes                 text[] not null default '{}',
  access_token_enc       text,          -- AES-GCM (nunca em texto puro)
  refresh_token_enc      text,          -- AES-GCM (nunca em texto puro)
  token_expires_at       timestamptz,
  capabilities           jsonb not null default '{}'::jsonb,
  last_verified_at       timestamptz,
  connected_at           timestamptz,
  disconnected_at        timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint payment_connections_catalog_provider_key unique (catalog_id, provider)
);

create index if not exists payment_connections_catalog_idx
  on public.payment_connections (catalog_id);

-- ── 3. Sessões de checkout (token de uso único para o comprador) ────────────
-- O comprador anônimo NUNCA recebe permissão de escrita em orders. O backend
-- cria o pedido e devolve um token aleatório; só o hash SHA-256 é persistido.
create table if not exists public.order_checkout_sessions (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  catalog_id  uuid not null references public.catalogs(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists order_checkout_sessions_order_idx
  on public.order_checkout_sessions (order_id);

-- ── 4. Transações financeiras ───────────────────────────────────────────────
create table if not exists public.payment_transactions (
  id                 uuid primary key default gen_random_uuid(),
  catalog_id         uuid not null references public.catalogs(id) on delete cascade,
  order_id           uuid not null references public.orders(id) on delete cascade,
  provider           text not null check (provider in ('paypal', 'mercadopago')),
  environment        text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  provider_order_id  text,
  provider_payment_id text,
  status             text not null default 'pending'
                       check (status in (
                         'pending', 'approved', 'authorized', 'captured',
                         'failed', 'cancelled', 'refunded', 'partially_refunded', 'disputed'
                       )),
  currency           text not null,
  amount             numeric(14, 2) not null check (amount >= 0),
  amount_minor       bigint not null check (amount_minor >= 0),
  captured_amount    numeric(14, 2) not null default 0,
  refunded_amount    numeric(14, 2) not null default 0,
  checkout_url       text,
  provider_status    text,
  payer_reference    text,          -- referência mascarada; nunca dados completos
  last_event_at      timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists payment_transactions_provider_payment_key
  on public.payment_transactions (provider, provider_payment_id)
  where provider_payment_id is not null;

create index if not exists payment_transactions_order_idx
  on public.payment_transactions (order_id);

create index if not exists payment_transactions_catalog_idx
  on public.payment_transactions (catalog_id, created_at desc);

-- ── 5. Eventos de webhook (idempotência por provedor + id do evento) ────────
create table if not exists public.payment_events (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null check (provider in ('paypal', 'mercadopago')),
  provider_event_id text not null,
  event_type       text,
  transaction_id   uuid references public.payment_transactions(id) on delete set null,
  order_id         uuid references public.orders(id) on delete set null,
  signature_valid  boolean not null default false,
  processed        boolean not null default false,
  processing_error text,
  payload          jsonb not null default '{}'::jsonb,
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  constraint payment_events_provider_event_key unique (provider, provider_event_id)
);

create index if not exists payment_events_order_idx on public.payment_events (order_id);

-- ── 6. Reembolsos (total e parcial) ────────────────────────────────────────
create table if not exists public.payment_refunds (
  id                uuid primary key default gen_random_uuid(),
  transaction_id    uuid not null references public.payment_transactions(id) on delete cascade,
  catalog_id        uuid not null references public.catalogs(id) on delete cascade,
  provider          text not null check (provider in ('paypal', 'mercadopago')),
  provider_refund_id text,
  amount            numeric(14, 2) not null check (amount > 0),
  status            text not null default 'pending'
                      check (status in ('pending', 'approved', 'failed', 'cancelled')),
  reason            text,
  requested_by      uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists payment_refunds_transaction_idx
  on public.payment_refunds (transaction_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. RLS — todas as tabelas financeiras com políticas restritivas
--    (somente o dono do catálogo; service_role bypassa para o backend)
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.payment_connections        enable row level security;
alter table public.order_checkout_sessions    enable row level security;
alter table public.payment_transactions       enable row level security;
alter table public.payment_events             enable row level security;
alter table public.payment_refunds            enable row level security;

-- Conexões: dono lê e atualiza (habilitar/desabilitar). INSERT/DELETE são
-- feitos exclusivamente pelo backend (service_role) após validar o OAuth.
drop policy if exists payment_connections_owner_select on public.payment_connections;
create policy payment_connections_owner_select on public.payment_connections
  for select to authenticated
  using (exists (
    select 1 from public.catalogs c
    where c.id = payment_connections.catalog_id and c.user_id = auth.uid()
  ));

drop policy if exists payment_connections_owner_update on public.payment_connections;
create policy payment_connections_owner_update on public.payment_connections
  for update to authenticated
  using (exists (
    select 1 from public.catalogs c
    where c.id = payment_connections.catalog_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.catalogs c
    where c.id = payment_connections.catalog_id and c.user_id = auth.uid()
  ));

-- Transações: somente leitura pelo dono (escrita é do backend).
drop policy if exists payment_transactions_owner_select on public.payment_transactions;
create policy payment_transactions_owner_select on public.payment_transactions
  for select to authenticated
  using (exists (
    select 1 from public.catalogs c
    where c.id = payment_transactions.catalog_id and c.user_id = auth.uid()
  ));

-- Eventos: somente leitura pelo dono.
drop policy if exists payment_events_owner_select on public.payment_events;
create policy payment_events_owner_select on public.payment_events
  for select to authenticated
  using (exists (
    select 1
    from public.payment_transactions t
    join public.catalogs c on c.id = t.catalog_id
    where t.id = payment_events.transaction_id and c.user_id = auth.uid()
  ));

-- Reembolsos: somente leitura pelo dono (criação é do backend autenticado).
drop policy if exists payment_refunds_owner_select on public.payment_refunds;
create policy payment_refunds_owner_select on public.payment_refunds
  for select to authenticated
  using (exists (
    select 1 from public.catalogs c
    where c.id = payment_refunds.catalog_id and c.user_id = auth.uid()
  ));

-- Sessões de checkout: SEM políticas para anon/authenticated.
-- Apenas service_role (backend) acessa. RLS habilitada = negação por padrão.

-- Defesa em profundidade: nenhum papel público pode escrever nas tabelas
-- financeiras, mesmo que um GRANT padrão do schema public exista.
revoke all on public.payment_connections     from anon;
revoke all on public.order_checkout_sessions from anon;
revoke all on public.payment_transactions    from anon;
revoke all on public.payment_events          from anon;
revoke all on public.payment_refunds         from anon;

revoke insert, update, delete on public.payment_connections     from authenticated;
revoke insert, update, delete on public.order_checkout_sessions from authenticated;
revoke insert, update, delete on public.payment_transactions    from authenticated;
revoke insert, update, delete on public.payment_events          from authenticated;
revoke insert, update, delete on public.payment_refunds         from authenticated;

grant select on public.payment_connections  to authenticated;
grant update (enabled) on public.payment_connections to authenticated;
grant select on public.payment_transactions to authenticated;
grant select on public.payment_events       to authenticated;
grant select on public.payment_refunds      to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. Fechamento das brechas conhecidas
-- ═══════════════════════════════════════════════════════════════════════════

-- 8.1 Pedidos: o navegador não cria mais pedidos diretamente.
--     A criação passa a ser feita pelo backend, que recalcula preços,
--     frete, descontos, moeda e total a partir dos dados oficiais.
drop policy if exists orders_anon_insert on public.orders;
revoke insert on public.orders from anon;

-- 8.2 Catálogos: anon não lê mais a tabela base (que expõe user_id, plan,
--     meta_catalog_connected). A leitura pública continua pela view
--     `catalogs_public`, que é SECURITY DEFINER e permanece intacta.
drop policy if exists catalogs_anon_read on public.catalogs;
drop policy if exists catalogs_public_read on public.catalogs;
revoke select on public.catalogs from anon;

-- A view pública permanece legível por anon/authenticated.
grant select on public.catalogs_public to anon;
grant select on public.catalogs_public to authenticated;

-- ── 9. Recarrega o cache de schema do PostgREST ────────────────────────────
notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (executar manualmente apenas em caso de falha/homologação)
-- ═══════════════════════════════════════════════════════════════════════════
-- begin;
--   -- Restaura o acesso público anterior (NÃO recomendado em produção)
--   grant select on public.catalogs to anon;
--   create policy catalogs_anon_read on public.catalogs for select to anon using (true);
--   grant insert on public.orders to anon;
--   create policy orders_anon_insert on public.orders for insert to anon with check (true);
--
--   drop table if exists public.payment_refunds;
--   drop table if exists public.payment_events;
--   drop table if exists public.payment_transactions;
--   drop table if exists public.order_checkout_sessions;
--   drop table if exists public.payment_connections;
--
--   alter table public.orders drop constraint if exists orders_payment_provider_check;
--   alter table public.orders drop constraint if exists orders_payment_status_check;
--   alter table public.orders
--     drop column if exists payment_transaction_id,
--     drop column if exists payment_provider,
--     drop column if exists payment_status;
--
--   notify pgrst, 'reload schema';
-- commit;
