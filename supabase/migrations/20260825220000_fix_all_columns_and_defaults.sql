-- =============================================================
-- VITRINE CRIATIVA — MIGRATION DEFINITIVA
-- Execute este SQL no Supabase SQL Editor
-- Adiciona TODAS as colunas ausentes, cria view pública,
-- corrige cores padrão, e recarrega o schema cache.
-- =============================================================

-- ── 1. catalogs: adicionar TODAS as colunas ausentes ──
ALTER TABLE public.catalogs
  ADD COLUMN IF NOT EXISTS store_font            TEXT    NOT NULL DEFAULT 'moderna',
  ADD COLUMN IF NOT EXISTS logo_size             TEXT    NOT NULL DEFAULT 'medio',
  ADD COLUMN IF NOT EXISTS logo_position         TEXT    NOT NULL DEFAULT 'esquerda',
  ADD COLUMN IF NOT EXISTS cart_style            TEXT    NOT NULL DEFAULT 'carrinho',
  ADD COLUMN IF NOT EXISTS banner_enabled        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banner_autoplay       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS banner_interval       INT     NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS banner_indicators     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_button_color TEXT    DEFAULT '#8b5cf6',
  ADD COLUMN IF NOT EXISTS store_description     TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url         TEXT,
  ADD COLUMN IF NOT EXISTS payment_methods       JSONB   DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS owner_photo_url       TEXT,
  ADD COLUMN IF NOT EXISTS owner_name            TEXT,
  ADD COLUMN IF NOT EXISTS owner_bio             TEXT,
  ADD COLUMN IF NOT EXISTS owner_hours           TEXT,
  ADD COLUMN IF NOT EXISTS background_color      TEXT    DEFAULT '#FFFFFF';

-- ── 2. Corrigir cores padrão (rosa -> lilás) ──
ALTER TABLE public.catalogs
  ALTER COLUMN primary_color SET DEFAULT '#8b5cf6',
  ALTER COLUMN accent_color  SET DEFAULT '#f3eefc';

-- Atualizar lojas existentes que ainda tenham o rosa antigo
UPDATE public.catalogs
SET primary_color = '#8b5cf6', accent_color = '#f3eefc'
WHERE primary_color = '#d1477a';

UPDATE public.catalogs
SET background_color = '#FFFFFF'
WHERE background_color IS NULL;

-- ── 3. banners: object_position ──
ALTER TABLE public.banners
  ADD COLUMN IF NOT EXISTS object_position TEXT DEFAULT 'center';

-- ── 4. products: price_options ──
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_options JSONB DEFAULT '[]'::jsonb;

-- ── 5. View pública (campos necessários para catálogo + boas-vindas) ──
CREATE OR REPLACE VIEW public.catalogs_public AS
SELECT
  id, user_id, slug, store_name, logo_url, cover_url,
  whatsapp, primary_color, accent_color, background_color,
  store_font, logo_size, logo_position, cart_style,
  banner_enabled, banner_autoplay, banner_interval, banner_indicators,
  whatsapp_button_color, payment_methods,
  store_description, instagram_url,
  owner_photo_url, owner_name, owner_bio, owner_hours,
  created_at, updated_at
FROM public.catalogs;

-- ── 6. Permissões na view ──
GRANT SELECT ON public.catalogs_public TO anon;
GRANT SELECT ON public.catalogs_public TO authenticated;

-- ── 7. RLS: remover leitura pública direta da tabela ──
DROP POLICY IF EXISTS catalogs_public_read ON public.catalogs;

-- Owner lê só seu próprio catálogo (para o painel)
DROP POLICY IF EXISTS catalogs_owner_select ON public.catalogs;
CREATE POLICY catalogs_owner_select ON public.catalogs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- ── 8. Orders: policies explícitas ──
DROP POLICY IF EXISTS orders_owner_all ON public.orders;
DROP POLICY IF EXISTS orders_owner_select ON public.orders;
DROP POLICY IF EXISTS orders_owner_update ON public.orders;
DROP POLICY IF EXISTS orders_owner_delete ON public.orders;

CREATE POLICY orders_owner_select ON public.orders
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

CREATE POLICY orders_owner_update ON public.orders
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

CREATE POLICY orders_owner_delete ON public.orders
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

-- ── 9. Recarregar schema cache do PostgREST ──
NOTIFY pgrst, 'reload schema';
