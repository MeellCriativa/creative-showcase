-- Adds a product type (physical/digital) so digital products are excluded
-- from Melhor Envio freight calculation and don't block the quote when
-- they lack weight/dimensions. Each catalog owner defines the type per product.

alter table public.products
  add column if not exists product_type text not null default 'fisico'
  check (product_type in ('fisico', 'digital'));

-- The Vitrine Criativa demo store (Meell Criativa) sells only digital products,
-- so mark its existing products as digital to avoid freight errors.
update public.products
  set product_type = 'digital'
  where catalog_id = '7fdd223f-8529-45e8-b411-011811574c2c';

-- Reload the PostgREST schema so the new column is visible immediately.
notify pgrst, 'reload schema';
