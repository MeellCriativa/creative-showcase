-- ---------------------------------------------------------------------------
-- 6) AUDITORIA DE CONFIRMAÇÃO MANUAL DO PIX.
-- ---------------------------------------------------------------------------
create table if not exists public.manual_payment_confirmations (
  order_id uuid primary key references public.orders(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  declared_at timestamptz,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.manual_payment_confirmations enable row level security;

revoke all on public.manual_payment_confirmations from anon;
revoke all on public.manual_payment_confirmations from authenticated;
grant select on public.manual_payment_confirmations to authenticated;

drop policy if exists manual_payment_confirmations_owner_select on public.manual_payment_confirmations;
create policy manual_payment_confirmations_owner_select on public.manual_payment_confirmations
  for select to authenticated
  using (exists (select 1 from public.catalogs c where c.id = catalog_id and c.user_id = auth.uid()));
