-- Cadastro de produtos, checkout personalizado, Pix manual e links externos digitais.
-- 100% aditivo: nenhuma coluna/tabela existente é removida ou reescrita.
-- Projeto de destino: homologação (ardpqimdllzbbdvwamkh).

-- ---------------------------------------------------------------------------
-- 1) PRODUTOS: informações adicionais, modalidade de entrega digital e
--    configuração visual do checkout por dispositivo (JSONB).
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists additional_info text,
  add column if not exists digital_delivery_mode text not null default 'file'
    check (digital_delivery_mode in ('file', 'link')),
  add column if not exists digital_external_url text,
  add column if not exists checkout_enabled boolean not null default false,
  add column if not exists checkout_desktop_config jsonb not null default '{}'::jsonb,
  add column if not exists checkout_mobile_config jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_digital_link_requires_https'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_digital_link_requires_https
      check (
        digital_delivery_mode <> 'link'
        or (
          digital_external_url is not null
          and btrim(digital_external_url) ~* '^https://'
        )
      );
  end if;
end $$;

-- O link externo do produto digital é secreto até a aprovação do pagamento.
-- Remove apenas o privilégio de SELECT de anon e devolve todas as colunas
-- públicas, exceto a URL bruta. authenticated (dono da loja) mantém acesso.
do $$
declare
  v_cols text;
begin
  revoke select on public.products from anon;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name not in ('digital_external_url');
  execute format('grant select (%s) on public.products to anon', v_cols);
end $$;

-- ---------------------------------------------------------------------------
-- 2) BANNERS: separação desktop / mobile mantendo a tabela existente.
-- ---------------------------------------------------------------------------
alter table public.banners
  add column if not exists device text not null default 'desktop'
    check (device in ('desktop', 'mobile')),
  add column if not exists product_id uuid references public.products(id) on delete cascade;

create index if not exists banners_catalog_device_idx
  on public.banners (catalog_id, device, position);
create index if not exists banners_product_device_idx
  on public.banners (product_id, device, position);

-- ---------------------------------------------------------------------------
-- 3) CATÁLOGOS: dados de recebimento Pix manual.
-- ---------------------------------------------------------------------------
alter table public.catalogs
  add column if not exists pix_mode text not null default 'key'
    check (pix_mode in ('key', 'qr', 'both')),
  add column if not exists pix_key_type text,
  add column if not exists pix_key_value text,
  add column if not exists pix_holder_name text,
  add column if not exists pix_holder_document text,
  add column if not exists pix_qr_path text,
  add column if not exists pix_qr_name text,
  add column if not exists pix_qr_mime text,
  add column if not exists pix_qr_size bigint;

-- Documento do titular é dado sensível: nunca disponível ao navegador anônimo.
revoke select (pix_holder_document) on public.catalogs from anon;

-- ---------------------------------------------------------------------------
-- 4) PEDIDOS: método de pagamento e trilha do Pix manual.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists payment_method text
    check (payment_method in ('pix_manual', 'paypal', 'mercadopago', 'whatsapp')),
  add column if not exists pix_declared_at timestamptz,
  add column if not exists pix_confirmed_at timestamptz,
  add column if not exists pix_confirmed_by uuid;

create index if not exists orders_payment_method_idx
  on public.orders (catalog_id, payment_method, created_at desc);

-- ---------------------------------------------------------------------------
-- 5) DEPOIMENTOS: verdadeiros e autorizados (declaração obrigatória).
-- ---------------------------------------------------------------------------
create table if not exists public.product_testimonials (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  customer_name text not null,
  content text not null,
  stars integer not null default 5 check (stars between 1 and 5),
  position integer not null default 0,
  truth_confirmed boolean not null default false check (truth_confirmed),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_testimonials_product_idx
  on public.product_testimonials (product_id, position);

alter table public.product_testimonials enable row level security;

revoke all on public.product_testimonials from anon;
revoke all on public.product_testimonials from authenticated;
grant select on public.product_testimonials to anon, authenticated;
grant insert, update, delete on public.product_testimonials to authenticated;

drop policy if exists product_testimonials_owner_all on public.product_testimonials;
create policy product_testimonials_owner_all on public.product_testimonials
  for all to authenticated
  using (exists (select 1 from public.catalogs c where c.id = catalog_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.catalogs c where c.id = catalog_id and c.user_id = auth.uid()));

drop policy if exists product_testimonials_public_read on public.product_testimonials;
create policy product_testimonials_public_read on public.product_testimonials
  for select to anon
  using (exists (
    select 1 from public.products p
    where p.id = product_id and p.checkout_enabled
  ));

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

-- ---------------------------------------------------------------------------
-- 7) PROTEÇÃO FINANCEIRA: navegador nunca altera status de pagamento.
--    service_role (Edge Functions) continua livre.
-- ---------------------------------------------------------------------------
create or replace function public.protect_order_financial_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'UPDATE' and (
       new.payment_status is distinct from old.payment_status
    or new.payment_provider is distinct from old.payment_provider
    or new.payment_transaction_id is distinct from old.payment_transaction_id
    or new.pix_confirmed_at is distinct from old.pix_confirmed_at
    or new.pix_confirmed_by is distinct from old.pix_confirmed_by
  ) then
    raise exception 'Campos financeiros nao podem ser alterados pelo navegador';
  end if;

  if tg_op = 'INSERT' and (
       coalesce(new.payment_status, 'pending') <> 'pending'
    or new.payment_provider is not null
    or new.pix_confirmed_at is not null
  ) then
    raise exception 'Campos financeiros nao podem ser definidos pelo navegador';
  end if;

  return new;
end $$;

drop trigger if exists orders_protect_financial_columns on public.orders;
create trigger orders_protect_financial_columns
  before insert or update on public.orders
  for each row execute function public.protect_order_financial_columns();

grant execute on function public.protect_order_financial_columns() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8) RPC ATÔMICA DE CONFIRMAÇÃO DO PIX MANUAL (somente service_role).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_manual_payment(
  p_order_id uuid,
  p_actor uuid default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog uuid;
  v_declared timestamptz;
begin
  update public.orders o
     set payment_status = 'approved',
         pix_confirmed_at = now(),
         pix_confirmed_by = p_actor
   where o.id = p_order_id
     and o.payment_method = 'pix_manual'
     and o.payment_status = 'pending'
     and o.pix_declared_at is not null
  returning o.catalog_id, o.pix_declared_at into v_catalog, v_declared;

  if v_catalog is null then
    return false;
  end if;

  insert into public.manual_payment_confirmations
    (order_id, catalog_id, declared_at, confirmed_at, confirmed_by)
  values
    (p_order_id, v_catalog, v_declared, now(), p_actor)
  on conflict (order_id) do update
     set attempts = public.manual_payment_confirmations.attempts + 1,
         confirmed_at = excluded.confirmed_at;

  return true;
end $$;

revoke all on function public.confirm_manual_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_manual_payment(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
