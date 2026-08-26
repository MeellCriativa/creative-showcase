-- =============================================================
-- Garantia de schema completo para o Vitrine Criativa
-- Todas as alterações usam IF NOT EXISTS / IF EXISTS para serem seguras
-- =============================================================

-- ── catalogs: todas as colunas de personalização ──
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

ALTER TABLE public.catalogs
  ALTER COLUMN primary_color SET DEFAULT '#8b5cf6',
  ALTER COLUMN accent_color  SET DEFAULT '#f3eefc';

-- ── banners ──
CREATE TABLE IF NOT EXISTS public.banners (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_id     UUID        NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  image_url      TEXT        NOT NULL,
  href           TEXT,
  position       INTEGER     NOT NULL DEFAULT 0,
  object_position TEXT       NOT NULL DEFAULT 'center',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banners_catalog ON public.banners(catalog_id, position);

GRANT SELECT ON public.banners TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banners TO authenticated;
GRANT ALL ON public.banners TO service_role;

ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "banners_public_read" ON public.banners;
CREATE POLICY "banners_public_read" ON public.banners
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "banners_owner_all" ON public.banners;
CREATE POLICY "banners_owner_all" ON public.banners FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

-- ── catalog_visits ──
CREATE TABLE IF NOT EXISTS public.catalog_visits (
  id           BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  catalog_id   UUID        NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  visited_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visits_catalog ON public.catalog_visits(catalog_id, visited_at DESC);

GRANT SELECT ON public.catalog_visits TO anon;
GRANT INSERT ON public.catalog_visits TO anon;
GRANT SELECT ON public.catalog_visits TO authenticated;
GRANT ALL ON public.catalog_visits TO service_role;

ALTER TABLE public.catalog_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visits_public_insert" ON public.catalog_visits;
CREATE POLICY "visits_public_insert" ON public.catalog_visits
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "visits_owner_read" ON public.catalog_visits;
CREATE POLICY "visits_owner_read" ON public.catalog_visits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

-- ── orders ──
CREATE TABLE IF NOT EXISTS public.orders (
  id             UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_id     UUID        NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  customer_name  TEXT        NOT NULL,
  customer_phone TEXT,
  items          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  note           TEXT,
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,
  status         TEXT        NOT NULL DEFAULT 'novo',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_catalog ON public.orders(catalog_id, created_at DESC);

GRANT SELECT ON public.orders TO anon;
GRANT INSERT ON public.orders TO anon;
GRANT SELECT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_anon_insert" ON public.orders;
CREATE POLICY "orders_anon_insert" ON public.orders
  FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS "orders_owner_all" ON public.orders;
CREATE POLICY "orders_owner_all" ON public.orders FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

-- ── products: price_options ──
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_options JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── Recarrega cache do PostgREST ──
NOTIFY pgrst, 'reload schema';