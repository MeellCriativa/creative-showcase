-- ═══════════════════════════════════════════════════════════════════════════
-- Etapa 2 — Correções de integridade financeira (auditoria do commit 0b89916)
-- ═══════════════════════════════════════════════════════════════════════════
-- Migration ADITIVA e idempotente. Não altera a migration anterior
-- (20261115090000_add_payment_providers.sql) nem remove dados.
--
-- O que resolve:
--   1. precisão decimal das moedas (numeric(14,2) truncava moedas de 3+ casas);
--   2. reserva exclusiva de captura (evita captura simultânea no PayPal);
--   3. índice único de transação ATIVA por pedido (impede duas cobranças vivas);
--   4. nonce de uso único no OAuth (state não pode ser reapresentado);
--   5. rate limit persistido e atômico das ações públicas;
--   6. contador de tentativas por evento (reprocessamento auditável);
--   7. idempotência de reembolso por id do provedor.
--
-- Rollback no final do arquivo (comentado).
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── 1. Precisão monetária ──────────────────────────────────────────────────
-- Moedas de 3 casas (KWD/BHD/OMR) e de 0 casas (JPY) não podem ser truncadas
-- para 2 casas: o valor cobrado precisa fechar exatamente com o pedido.
alter table public.payment_transactions
  alter column amount          type numeric(20, 6),
  alter column captured_amount type numeric(20, 6),
  alter column refunded_amount type numeric(20, 6);

alter table public.payment_refunds
  alter column amount type numeric(20, 6);

-- ── 2. Reserva exclusiva de captura ────────────────────────────────────────
alter table public.payment_transactions
  add column if not exists capture_claimed_at timestamptz;

comment on column public.payment_transactions.capture_claimed_at is
  'Lease da captura (PayPal). Evita duas capturas simultâneas para a mesma transação.';

-- ── 3. Uma única transação ATIVA por pedido ────────────────────────────────
-- Antes do índice, encerra duplicatas antigas SEM pagamento confirmado
-- (sobras de cliques repetidos). Se houver mais de uma transação ativa COM
-- `provider_payment_id`, a criação do índice falha de propósito: significa que
-- existe pagamento real duplicado e isso precisa de análise manual.
with ranked as (
  select
    id,
    row_number() over (
      partition by order_id
      order by (provider_payment_id is not null) desc, created_at desc, id desc
    ) as rn
  from public.payment_transactions
  where status in ('pending', 'authorized')
)
update public.payment_transactions t
   set status = 'cancelled',
       updated_at = now()
  from ranked r
 where t.id = r.id
   and r.rn > 1
   and t.provider_payment_id is null;

create unique index if not exists payment_transactions_active_order_key
  on public.payment_transactions (order_id)
  where status in ('pending', 'authorized');

comment on index public.payment_transactions_active_order_key is
  'Garante no máximo uma cobrança viva por pedido (qualquer provedor).';

-- ── 4. Nonce de uso único do OAuth ─────────────────────────────────────────
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

-- ── 5. Rate limit das ações públicas ──────────────────────────────────────
create table if not exists public.payment_rate_limits (
  bucket            text primary key,
  window_started_at timestamptz not null default now(),
  hits              integer not null default 0,
  updated_at        timestamptz not null default now()
);

/*
 * Incrementa e devolve a decisão em UMA instrução atômica.
 * Janela fixa por bucket: quando a janela expira, o contador reinicia.
 */
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

-- ── 6. Tentativas por evento de webhook ───────────────────────────────────
alter table public.payment_events
  add column if not exists attempts integer not null default 0;

-- ── 7. Idempotência de reembolso ──────────────────────────────────────────
-- O mesmo reembolso devolvido pelo provedor (retry/duplo clique) não pode
-- gerar duas linhas no histórico.
create unique index if not exists payment_refunds_provider_refund_key
  on public.payment_refunds (provider, provider_refund_id)
  where provider_refund_id is not null;

-- ── 8. RLS e privilégios das tabelas novas ────────────────────────────────
alter table public.payment_oauth_states  enable row level security;
alter table public.payment_rate_limits  enable row level security;

-- Sem políticas: apenas service_role (backend) acessa. Negação por padrão.
revoke all on public.payment_oauth_states from anon;
revoke all on public.payment_oauth_states from authenticated;
revoke all on public.payment_rate_limits from anon;
revoke all on public.payment_rate_limits from authenticated;

-- ── 9. Recarrega o cache de schema do PostgREST ───────────────────────────
notify pgrst, 'reload schema';

commit;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK (executar manualmente, somente em homologação)
-- ═══════════════════════════════════════════════════════════════════════════
-- begin;
--   drop function if exists public.bump_payment_rate_limit(text, integer, integer);
--   drop table if exists public.payment_rate_limits;
--   drop table if exists public.payment_oauth_states;
--   drop index if exists public.payment_refunds_provider_refund_key;
--   drop index if exists public.payment_transactions_active_order_key;
--   alter table public.payment_events drop column if exists attempts;
--   alter table public.payment_transactions drop column if exists capture_claimed_at;
--   alter table public.payment_transactions
--     alter column amount type numeric(14,2),
--     alter column captured_amount type numeric(14,2),
--     alter column refunded_amount type numeric(14,2);
--   alter table public.payment_refunds alter column amount type numeric(14,2);
--   notify pgrst, 'reload schema';
-- commit;
