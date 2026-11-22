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
