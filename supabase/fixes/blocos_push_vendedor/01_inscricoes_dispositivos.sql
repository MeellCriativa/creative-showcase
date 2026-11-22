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
