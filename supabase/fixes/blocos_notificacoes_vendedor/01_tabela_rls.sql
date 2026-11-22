-- Bloco 1/4 — tabela de avisos, índice e permissões.
-- Idempotente: pode rodar em homologação e produção.

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
