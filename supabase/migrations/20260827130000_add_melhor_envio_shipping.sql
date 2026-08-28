-- Shipping support for Vitrine Criativa via Melhor Envio (Correios + transportadoras)
-- Adds delivery configuration to catalogs, weight/dimensions to products,
-- shipping/address data to orders, and a per-catalog Melhor Envio account table
-- (multi-tenant: each store has its own OAuth tokens, never mixed).

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

-- Melhor Envio pipeline state (transport-agnostic naming, ME-specific columns)
alter table public.orders
  add column if not exists me_order_id text,
  add column if not exists me_agency_id text,
  add column if not exists me_tracking text,
  add column if not exists me_status text,
  add column if not exists me_protocol text,
  add column if not exists me_label_id text,
  add column if not exists me_label_url text;

-- ── Melhor Envio accounts (multi-tenant, per catalog) ───────────────
create table if not exists public.melhor_envio_accounts (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  environment text not null default 'sandbox',             -- 'sandbox' | 'production'
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  -- Sender (remetente) data required to place cart / generate label
  sender_name text,
  sender_document text,       -- CPF or CNPJ (digits only)
  sender_phone text,
  sender_email text,
  sender_street text,
  sender_number text,
  sender_complement text,
  sender_district text,
  sender_city text,
  sender_state text,
  sender_zip text,
  connected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: only the catalog owner can manage their Melhor Envio account.
drop policy if exists "melhor_envio_accounts_owner_select" on public.melhor_envio_accounts;
create policy "melhor_envio_accounts_owner_select"
  on public.melhor_envio_accounts for select
  using (
    exists (
      select 1 from public.catalogs c
      where c.id = melhor_envio_accounts.catalog_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "melhor_envio_accounts_owner_insert" on public.melhor_envio_accounts;
create policy "melhor_envio_accounts_owner_insert"
  on public.melhor_envio_accounts for insert
  with check (
    exists (
      select 1 from public.catalogs c
      where c.id = melhor_envio_accounts.catalog_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "melhor_envio_accounts_owner_update" on public.melhor_envio_accounts;
create policy "melhor_envio_accounts_owner_update"
  on public.melhor_envio_accounts for update
  using (
    exists (
      select 1 from public.catalogs c
      where c.id = melhor_envio_accounts.catalog_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists "melhor_envio_accounts_owner_delete" on public.melhor_envio_accounts;
create policy "melhor_envio_accounts_owner_delete"
  on public.melhor_envio_accounts for delete
  using (
    exists (
      select 1 from public.catalogs c
      where c.id = melhor_envio_accounts.catalog_id
        and c.user_id = auth.uid()
    )
  );

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

-- Reload the PostgREST schema so new columns are visible immediately.
notify pgrst, 'reload schema';
