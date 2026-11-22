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
