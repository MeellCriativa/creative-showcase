-- Schema aditivo de pagamentos para PRODUÇÃO (Vitrine Criativa).
--
-- Objetivo: criar somente os objetos que a Edge Function `payments` precisa,
-- sem alterar o comportamento público atual da vitrine.
--
-- PRESERVA EXPLICITAMENTE:
--   * `anon` continua podendo SELECT em public.catalogs;
--   * `anon` continua podendo INSERT em public.orders com a política
--     endurecida aplicada em 2026-11-20;
--   * nenhuma linha existente é excluída, atualizada ou renomeada;
--   * nenhuma coluna existente é removida.
--
-- NÃO HABILITA COBRANÇAS:
--   * nenhuma conexão Mercado Pago/PayPal é criada;
--   * nenhum Secret é definido;
--   * `methods` continua retornando [] até uma vendedora conectar OAuth;
--   * `create_payment` continua fail-closed.
--
-- Ordem: este arquivo consolida, de forma idempotente, as partes aditivas das
-- migrações 20261115090000, 20261116090000, 20261118120000,
-- 20261118130000 e 20261119130000.

begin;

/* -------------------------------------------------------------------------- */
/* 1. Pedidos: colunas de estado financeiro                                  */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* 2. Conexões financeiras por loja/provedor                                  */
/* -------------------------------------------------------------------------- */

create table if not exists public.payment_connections (
  id                     uuid primary key default gen_random_uuid(),
  catalog_id             uuid not null references public.catalogs(id) on delete cascade,
  provider               text not null check (provider in ('paypal', 'mercadopago')),
  environment            text not null default 'sandbox' check (environment in ('sandbox', 'production')),
  status                 text not null default 'pending'
                           check (status in ('pending', 'connected', 'expired', 'revoked', 'error')),
  enabled                boolean not null default false,
  connected              boolean not null default false,
  external_account_id    text,
  external_account_label text,
  merchant_id            text,
  scopes                 text[] not null default '{}',
  access_token_enc       text,
  refresh_token_enc      text,
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

/* -------------------------------------------------------------------------- */
/* 3. Sessões de checkout (token de uso único)                                */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* 4. Transações financeiras                                                  */
/* -------------------------------------------------------------------------- */

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
  amount             numeric(20, 6) not null check (amount >= 0),
  amount_minor       bigint not null check (amount_minor >= 0),
  captured_amount    numeric(20, 6) not null default 0,
  refunded_amount    numeric(20, 6) not null default 0,
  checkout_url       text,
  provider_status    text,
  payer_reference    text,
  capture_claimed_at timestamptz,
  last_event_at      timestamptz,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists payment_transactions_provider_payment_key
  on public.payment_transactions (provider, provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists payment_transactions_active_order_key
  on public.payment_transactions (order_id)
  where status in ('pending', 'authorized');

create index if not exists payment_transactions_order_idx
  on public.payment_transactions (order_id);

create index if not exists payment_transactions_catalog_idx
  on public.payment_transactions (catalog_id, created_at desc);

/* -------------------------------------------------------------------------- */
/* 5. Eventos de webhook                                                      */
/* -------------------------------------------------------------------------- */

create table if not exists public.payment_events (
  id                uuid primary key default gen_random_uuid(),
  provider          text not null check (provider in ('paypal', 'mercadopago')),
  provider_event_id text not null,
  event_type        text,
  transaction_id    uuid references public.payment_transactions(id) on delete set null,
  order_id          uuid references public.orders(id) on delete set null,
  signature_valid   boolean not null default false,
  processed         boolean not null default false,
  processing_error  text,
  attempts          integer not null default 0,
  payload           jsonb not null default '{}'::jsonb,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz,
  constraint payment_events_provider_event_key unique (provider, provider_event_id)
);

create index if not exists payment_events_order_idx on public.payment_events (order_id);

/* -------------------------------------------------------------------------- */
/* 6. Reembolsos e ciclo de vida                                              */
/* -------------------------------------------------------------------------- */

create table if not exists public.payment_refunds (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     uuid not null references public.payment_transactions(id) on delete cascade,
  catalog_id         uuid not null references public.catalogs(id) on delete cascade,
  provider           text not null check (provider in ('paypal', 'mercadopago')),
  provider_refund_id text,
  operation_id       uuid,
  idempotency_key    text,
  entry_kind         text not null default 'operation',
  dedupe_key         text,
  last_error         text,
  last_attempt_at    timestamptz,
  amount             numeric(20, 6) not null check (amount > 0),
  status             text not null default 'pending'
                       check (status in ('pending', 'approved', 'failed', 'cancelled')),
  reason             text,
  requested_by       uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_refunds_entry_kind_check'
      and conrelid = 'public.payment_refunds'::regclass
  ) then
    alter table public.payment_refunds
      add constraint payment_refunds_entry_kind_check
      check (entry_kind in ('operation', 'snapshot'));
  end if;
end
$$;

create unique index if not exists payment_refunds_provider_refund_key
  on public.payment_refunds (provider, provider_refund_id)
  where provider_refund_id is not null;

create unique index if not exists payment_refunds_operation_uidx
  on public.payment_refunds (transaction_id, operation_id)
  where operation_id is not null;

create unique index if not exists payment_refunds_pending_guard_uidx
  on public.payment_refunds (dedupe_key)
  where dedupe_key is not null and status = 'pending';

create index if not exists payment_refunds_transaction_idx
  on public.payment_refunds (transaction_id);

create index if not exists payment_refunds_transaction_provider_idx
  on public.payment_refunds (transaction_id, provider);

create index if not exists payment_refunds_transaction_status_idx
  on public.payment_refunds (transaction_id, status);

create index if not exists payment_refunds_catalog_status_idx
  on public.payment_refunds (catalog_id, status);

/* -------------------------------------------------------------------------- */
/* 7. OAuth (nonce de uso único) e rate limit                                 */
/* -------------------------------------------------------------------------- */

create table if not exists public.payment_oauth_states (
  nonce       text primary key,
  catalog_id  uuid not null references public.catalogs(id) on delete cascade,
  provider    text not null check (provider in ('paypal', 'mercadopago')),
  user_id     uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists payment_oauth_states_expires_idx
  on public.payment_oauth_states (expires_at);

create table if not exists public.payment_rate_limits (
  bucket            text primary key,
  window_started_at timestamptz not null default now(),
  hits              integer not null default 0,
  updated_at        timestamptz not null default now()
);

create or replace function public.bump_payment_rate_limit(
  p_bucket    text,
  p_window_ms integer,
  p_max       integer
)
returns table (allowed boolean, retry_after_ms integer, hits integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now    timestamptz := clock_timestamp();
  v_window interval;
  v_row    public.payment_rate_limits;
begin
  if p_bucket is null or length(p_bucket) = 0 then
    return query select true, 0, 0;
    return;
  end if;

  if p_window_ms is null or p_window_ms <= 0 then
    p_window_ms := 60000;
  end if;

  if p_max is null or p_max <= 0 then
    return query select true, 0, 0;
    return;
  end if;

  v_window := make_interval(secs => p_window_ms / 1000.0);

  insert into public.payment_rate_limits as rl (bucket, window_started_at, hits, updated_at)
  values (p_bucket, v_now, 1, v_now)
  on conflict (bucket) do update
     set hits = case
                  when rl.window_started_at < v_now - v_window then 1
                  else rl.hits + 1
                end,
         window_started_at = case
                  when rl.window_started_at < v_now - v_window then v_now
                  else rl.window_started_at
                end,
         updated_at = v_now
  returning * into v_row;

  if v_row.hits > p_max then
    return query select
      false,
      greatest(
        0,
        ceil(extract(epoch from (v_row.window_started_at + v_window - v_now)) * 1000)
      )::integer,
      v_row.hits;
  end if;

  return query select true, 0, v_row.hits;
end;
$$;

revoke all on function public.bump_payment_rate_limit(text, integer, integer) from public;
revoke all on function public.bump_payment_rate_limit(text, integer, integer) from anon;
revoke all on function public.bump_payment_rate_limit(text, integer, integer) from authenticated;
grant execute on function public.bump_payment_rate_limit(text, integer, integer) to service_role;

/* -------------------------------------------------------------------------- */
/* 8. RLS e grants das tabelas novas                                          */
/* -------------------------------------------------------------------------- */

alter table public.payment_connections        enable row level security;
alter table public.order_checkout_sessions    enable row level security;
alter table public.payment_transactions       enable row level security;
alter table public.payment_events             enable row level security;
alter table public.payment_refunds            enable row level security;
alter table public.payment_oauth_states       enable row level security;
alter table public.payment_rate_limits        enable row level security;

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

drop policy if exists payment_transactions_owner_select on public.payment_transactions;
create policy payment_transactions_owner_select on public.payment_transactions
  for select to authenticated
  using (exists (
    select 1 from public.catalogs c
    where c.id = payment_transactions.catalog_id and c.user_id = auth.uid()
  ));

drop policy if exists payment_events_owner_select on public.payment_events;
create policy payment_events_owner_select on public.payment_events
  for select to authenticated
  using (exists (
    select 1
    from public.payment_transactions t
    join public.catalogs c on c.id = t.catalog_id
    where t.id = payment_events.transaction_id and c.user_id = auth.uid()
  ));

drop policy if exists payment_refunds_owner_select on public.payment_refunds;
create policy payment_refunds_owner_select on public.payment_refunds
  for select to authenticated
  using (exists (
    select 1 from public.catalogs c
    where c.id = payment_refunds.catalog_id and c.user_id = auth.uid()
  ));

-- order_checkout_sessions, payment_oauth_states e payment_rate_limits ficam sem
-- políticas: apenas service_role (backend) acessa. Negação por padrão.

revoke all on table public.payment_connections     from anon, authenticated;
revoke all on table public.order_checkout_sessions from anon, authenticated;
revoke all on table public.payment_transactions    from anon, authenticated;
revoke all on table public.payment_events          from anon, authenticated;
revoke all on table public.payment_refunds         from anon, authenticated;
revoke all on table public.payment_oauth_states    from anon, authenticated;
revoke all on table public.payment_rate_limits     from anon, authenticated;

grant select (
  id, catalog_id, provider, environment, status, enabled, connected,
  capabilities, connected_at, last_verified_at, created_at, updated_at
) on public.payment_connections to authenticated;
grant update (enabled) on public.payment_connections to authenticated;

grant select (
  id, catalog_id, order_id, provider, environment, provider_order_id,
  provider_payment_id, status, provider_status, currency, amount,
  amount_minor, captured_amount, refunded_amount, last_event_at,
  created_at, updated_at
) on public.payment_transactions to authenticated;

grant select (
  id, provider, provider_event_id, event_type, transaction_id, order_id,
  signature_valid, processed, received_at, processed_at
) on public.payment_events to authenticated;

grant select (
  id, transaction_id, catalog_id, provider, provider_refund_id, amount,
  status, requested_by, created_at, updated_at
) on public.payment_refunds to authenticated;

notify pgrst, 'reload schema';

commit;
