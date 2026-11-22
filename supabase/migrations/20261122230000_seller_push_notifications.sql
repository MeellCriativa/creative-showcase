-- Web Push de novo pedido para o vendedor.
-- 100% aditivo e idempotente: pode rodar em homologação e produção.

-- ---------------------------------------------------------------------------
-- 1) INSCRIÇÕES POR DISPOSITIVO (uma linha por endpoint push)
-- ---------------------------------------------------------------------------
create table if not exists public.seller_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint)
);

create index if not exists seller_push_subscriptions_catalog_idx
  on public.seller_push_subscriptions (catalog_id);

alter table public.seller_push_subscriptions enable row level security;

drop policy if exists seller_push_subscriptions_owner_all
  on public.seller_push_subscriptions;
create policy seller_push_subscriptions_owner_all
  on public.seller_push_subscriptions
  for all to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.catalogs c
      where c.id = catalog_id and c.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.catalogs c
      where c.id = catalog_id and c.user_id = auth.uid()
    )
  );

revoke all on public.seller_push_subscriptions from anon;
grant select, insert, update, delete on public.seller_push_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- 2) CONTROLE DE ENVIO NA FILA DE NOTIFICAÇÕES
-- ---------------------------------------------------------------------------
alter table public.seller_order_notifications
  add column if not exists push_status text not null default 'pending',
  add column if not exists push_attempts integer not null default 0,
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_last_error text;

alter table public.seller_order_notifications
  drop constraint if exists seller_order_notifications_push_status_check;
alter table public.seller_order_notifications
  add constraint seller_order_notifications_push_status_check
  check (push_status in ('pending', 'sending', 'sent', 'failed'));

create or replace function public.claim_seller_order_push(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.seller_order_notifications n
     set push_status = 'sending',
         push_attempts = n.push_attempts + 1
   where n.order_id = p_order_id
     and n.push_status in ('pending', 'failed')
     and n.push_attempts < 5
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end $$;

revoke all on function public.claim_seller_order_push(uuid) from public, anon, authenticated;
grant execute on function public.claim_seller_order_push(uuid) to service_role;

notify pgrst, 'reload schema';
