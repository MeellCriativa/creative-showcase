-- Entrega automática de produtos digitais por e-mail (somente aditivo).
-- Nenhuma coluna/tabela existente é removida ou reescrita.

alter table public.products
  add column if not exists digital_file_path text,
  add column if not exists digital_file_name text,
  add column if not exists digital_file_mime text,
  add column if not exists digital_file_size bigint,
  add column if not exists digital_file_checksum text,
  add column if not exists digital_instructions text,
  add column if not exists digital_link_ttl_minutes integer default 1440,
  add column if not exists digital_max_downloads integer default 5;

alter table public.orders
  add column if not exists customer_email text;

create table if not exists public.digital_deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  customer_email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'revoked')),
  attempts integer not null default 0,
  provider_message_id text,
  sent_at timestamptz,
  revoked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint digital_deliveries_order_product_key unique (order_id, product_id)
);

create table if not exists public.digital_download_tokens (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.digital_deliveries(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  max_uses integer not null default 5,
  used_count integer not null default 0,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.digital_download_events (
  id bigint generated always as identity primary key,
  token_id uuid references public.digital_download_tokens(id) on delete cascade,
  order_id uuid,
  product_id uuid,
  event_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists digital_deliveries_catalog_idx
  on public.digital_deliveries (catalog_id, created_at desc);
create index if not exists digital_download_tokens_order_idx
  on public.digital_download_tokens (order_id);
create index if not exists digital_download_events_order_idx
  on public.digital_download_events (order_id, created_at desc);

alter table public.digital_deliveries enable row level security;
alter table public.digital_download_tokens enable row level security;
alter table public.digital_download_events enable row level security;

-- Nenhuma política para anon: compradores só acessam via endpoint com token.
revoke all on public.digital_deliveries from anon;
revoke all on public.digital_download_tokens from anon;
revoke all on public.digital_download_events from anon;

drop policy if exists digital_deliveries_owner_select on public.digital_deliveries;
create policy digital_deliveries_owner_select on public.digital_deliveries
  for select to authenticated
  using (exists (select 1 from public.catalogs c where c.id = catalog_id and c.user_id = auth.uid()));

-- Colunas sensíveis (hash do token) nunca são expostas ao navegador.
revoke all on public.digital_download_tokens from authenticated;
grant select (id, delivery_id, order_id, catalog_id, product_id, expires_at, max_uses, used_count, revoked_at, created_at)
  on public.digital_download_tokens to authenticated;

drop policy if exists digital_download_tokens_owner_select on public.digital_download_tokens;
create policy digital_download_tokens_owner_select on public.digital_download_tokens
  for select to authenticated
  using (exists (select 1 from public.catalogs c where c.id = catalog_id and c.user_id = auth.uid()));

revoke all on public.digital_download_events from authenticated;
grant select (id, token_id, order_id, product_id, event_type, created_at)
  on public.digital_download_events to authenticated;

drop policy if exists digital_download_events_owner_select on public.digital_download_events;
create policy digital_download_events_owner_select on public.digital_download_events
  for select to authenticated
  using (exists (
    select 1 from public.orders o
    join public.catalogs c on c.id = o.catalog_id
    where o.id = digital_download_events.order_id and c.user_id = auth.uid()
  ));

-- Bucket privado: nenhuma política de leitura pública.
insert into storage.buckets (id, name, public, file_size_limit)
values ('digital-products', 'digital-products', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists digital_products_owner_insert on storage.objects;
create policy digital_products_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'digital-products' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists digital_products_owner_select on storage.objects;
create policy digital_products_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'digital-products' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists digital_products_owner_update on storage.objects;
create policy digital_products_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'digital-products' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'digital-products' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists digital_products_owner_delete on storage.objects;
create policy digital_products_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'digital-products' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
