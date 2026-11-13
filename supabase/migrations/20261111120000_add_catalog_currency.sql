-- ============================================================================
-- Vitrine Criativa — Etapa 1: moeda principal por loja
-- ----------------------------------------------------------------------------
-- NÃO destrutiva. Não altera nenhum valor já cadastrado.
--
-- Retrocompatibilidade:
--   • catalogs.currency entra com DEFAULT 'BRL' NOT NULL  → todas as lojas
--     existentes passam a ser BRL automaticamente, sem conversão de preços;
--   • orders.currency fica NULL para os pedidos antigos → a aplicação resolve
--     a moeda do pedido como "moeda da loja", preservando o histórico;
--   • nenhum UPDATE em products / price_options / orders é executado aqui.
-- ============================================================================

begin;

-- ── 1. Moeda principal da loja ──────────────────────────────────────────────
alter table public.catalogs
  add column if not exists currency text not null default 'BRL';

-- Código ISO 4217 alfa-3 (maiúsculo). Garante integridade sem depender da app.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalogs_currency_iso4217'
      and conrelid = 'public.catalogs'::regclass
  ) then
    alter table public.catalogs
      add constraint catalogs_currency_iso4217
      check (currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column public.catalogs.currency is
  'Moeda principal da loja (ISO 4217). Padrão BRL para lojas anteriores à Etapa 1.';

-- ── 2. Moeda do pedido (histórico) ──────────────────────────────────────────
-- NULL = pedido anterior à migração; a app usa a moeda da loja.
alter table public.orders
  add column if not exists currency text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_currency_iso4217'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_currency_iso4217
      check (currency is null or currency ~ '^[A-Z]{3}$');
  end if;
end $$;

comment on column public.orders.currency is
  'Moeda usada no momento da compra (ISO 4217). NULL = pedido anterior à Etapa 1 (usa a moeda da loja).';

-- ── 3. View pública: passa a expor a moeda da loja ──────────────────────────
-- ATENÇÃO: `create or replace view` só permite ADICIONAR colunas no FIM.
-- Por isso `currency` entra depois de `updated_at` (nunca no meio).
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
  created_at, updated_at,
  currency
from public.catalogs;

grant select on public.catalogs_public to anon;
grant select on public.catalogs_public to authenticated;

-- ── 4. Reload do schema do PostgREST ────────────────────────────────────────
notify pgrst, 'reload schema';

commit;

-- ============================================================================
-- ROLLBACK (executar somente se necessário)
-- ----------------------------------------------------------------------------
-- begin;
-- create or replace view public.catalogs_public as
-- select
--   id, user_id, slug, store_name, logo_url, cover_url,
--   whatsapp, primary_color, accent_color, background_color,
--   store_font, logo_size, logo_position, cart_style,
--   banner_enabled, banner_autoplay, banner_interval, banner_indicators,
--   whatsapp_button_color, payment_methods,
--   store_description, instagram_url,
--   owner_photo_url, owner_name, owner_bio, owner_hours,
--   delivery_methods, shipping_origin_zip,
--   created_at, updated_at
-- from public.catalogs;
-- alter table public.orders drop constraint if exists orders_currency_iso4217;
-- alter table public.orders drop column if exists currency;
-- alter table public.catalogs drop constraint if exists catalogs_currency_iso4217;
-- alter table public.catalogs drop column if exists currency;
-- notify pgrst, 'reload schema';
-- commit;
-- ============================================================================
