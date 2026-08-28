-- Correios / Shipping support for Vitrine Criativa
-- Adds delivery configuration to catalogs, weight/dimensions to products,
-- and shipping/address data to orders.

-- ── Catalogs: forma de entrega + CEP de origem ──────────────────────
alter table public.catalogs
  add column if not exists delivery_methods jsonb default '[]'::jsonb,
  add column if not exists shipping_origin_zip text;

-- ── Products: peso e dimensões para cálculo de frete ────────────────
alter table public.products
  add column if not exists weight_grams numeric(10,2),
  add column if not exists length_cm numeric(10,2),
  add column if not exists width_cm numeric(10,2),
  add column if not exists height_cm numeric(10,2);

-- ── Orders: dados de entrega e fretes ───────────────────────────────
alter table public.orders
  add column if not exists delivery_method text,
  add column if not exists shipping_zip text,
  add column if not exists customer_street text,
  add column if not exists customer_number text,
  add column if not exists customer_complement text,
  add column if not exists customer_district text,
  add column if not exists customer_city text,
  add column if not exists customer_state text,
  add column if not exists shipping_service text,
  add column if not exists shipping_service_name text,
  add column if not exists shipping_cost numeric(10,2),
  add column if not exists shipping_eta_days integer,
  add column if not exists shipping_eta_text text,
  add column if not exists subtotal numeric(10,2);

-- Recipe: RLS / grants já cobrem as novas colunas (mesma tabela orders).
-- Recarrega o schema no PostgREST para as novas colunas ficarem visíveis.
notify pgrst, 'reload schema';

-- ── View pública: inclui dados de entrega para o catálogo público ──
create or replace view public.catalogs_public as
select
  id, user_id, slug, store_name, logo_url, cover_url,
  whatsapp, primary_color, accent_color, background_color,
  store_font, logo_size, logo_position, cart_style,
  banner_enabled, banner_autoplay, banner_interval, banner_indicators,
  whatsapp_button_color, payment_methods,
  store_description, instagram_url,
  owner_photo_url, owner_name, owner_bio, owner_hours,
  delivery_methods, shipping_origin_zip,
  created_at, updated_at
from public.catalogs;

grant select on public.catalogs_public to anon;
grant select on public.catalogs_public to authenticated;
