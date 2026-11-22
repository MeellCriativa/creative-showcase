-- Notificação de novo pedido para o vendedor.
-- Idempotente: pode ser executado em homologação e produção quantas vezes for preciso.
-- 100% aditivo: nenhuma coluna/tabela existente é removida ou reescrita.

-- ---------------------------------------------------------------------------
-- 1) FILA DE NOTIFICAÇÕES DO VENDEDOR (uma linha por pedido)
-- ---------------------------------------------------------------------------
create table if not exists public.seller_order_notifications (
  order_id uuid primary key references public.orders(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  customer_name text,
  total numeric(14, 2),
  currency text,
  payment_method text,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  email_status text not null default 'pending'
    check (email_status in ('pending', 'sending', 'sent', 'failed')),
  email_attempts integer not null default 0,
  email_last_error text,
  email_sent_at timestamptz
);

create index if not exists seller_order_notifications_unread_idx
  on public.seller_order_notifications (catalog_id, created_at desc)
  where read_at is null;

alter table public.seller_order_notifications enable row level security;

-- O navegador só pode LER e marcar como lida. Nunca altera o estado do e-mail.
revoke all on public.seller_order_notifications from anon;
revoke all on public.seller_order_notifications from authenticated;
grant select on public.seller_order_notifications to authenticated;
grant update (read_at) on public.seller_order_notifications to authenticated;

drop policy if exists seller_order_notifications_owner_select on public.seller_order_notifications;
create policy seller_order_notifications_owner_select on public.seller_order_notifications
  for select to authenticated
  using (exists (
    select 1 from public.catalogs c
    where c.id = catalog_id and c.user_id = auth.uid()
  ));

drop policy if exists seller_order_notifications_owner_read on public.seller_order_notifications;
create policy seller_order_notifications_owner_read on public.seller_order_notifications
  for update to authenticated
  using (exists (
    select 1 from public.catalogs c
    where c.id = catalog_id and c.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.catalogs c
    where c.id = catalog_id and c.user_id = auth.uid()
  ));

-- ---------------------------------------------------------------------------
-- 2) REGISTRO AUTOMÁTICO: vale para QUALQUER forma de criar pedido
--    (payments, pix-manual e o insert anônimo de fallback).
-- ---------------------------------------------------------------------------
create or replace function public.register_seller_order_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.seller_order_notifications
    (order_id, catalog_id, customer_name, total, currency, payment_method)
  values
    (new.id, new.catalog_id, new.customer_name, new.total, new.currency, new.payment_method)
  on conflict (order_id) do nothing;
  return new;
end $$;

drop trigger if exists orders_register_seller_notification on public.orders;
create trigger orders_register_seller_notification
  after insert on public.orders
  for each row execute function public.register_seller_order_notification();

revoke all on function public.register_seller_order_notification() from public, anon, authenticated;
grant execute on function public.register_seller_order_notification() to service_role, postgres;

-- ---------------------------------------------------------------------------
-- 3) RESERVA ATÔMICA DO ENVIO DE E-MAIL (evita e-mail duplicado)
-- ---------------------------------------------------------------------------
create or replace function public.claim_seller_order_email(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.seller_order_notifications n
     set email_status = 'sending',
         email_attempts = n.email_attempts + 1
   where n.order_id = p_order_id
     and n.email_status in ('pending', 'failed')
     and n.email_attempts < 5
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end $$;

revoke all on function public.claim_seller_order_email(uuid) from public, anon, authenticated;
grant execute on function public.claim_seller_order_email(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4) TEMPO REAL NO PAINEL
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'seller_order_notifications'
  ) then
    alter publication supabase_realtime add table public.seller_order_notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
