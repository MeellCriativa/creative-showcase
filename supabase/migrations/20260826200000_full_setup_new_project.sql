-- =============================================================
-- VITRINE CRIATIVA — SETUP COMPLETO
-- Execute este SQL no Supabase SQL Editor do projeto
-- =============================================================

-- ── 1. Tabela catalogs ──
CREATE TABLE IF NOT EXISTS public.catalogs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  store_name TEXT NOT NULL,
  logo_url TEXT,
  cover_url TEXT,
  whatsapp TEXT,
  primary_color TEXT NOT NULL DEFAULT '#8b5cf6',
  accent_color TEXT NOT NULL DEFAULT '#f3eefc',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  store_font TEXT NOT NULL DEFAULT 'moderna',
  logo_size TEXT NOT NULL DEFAULT 'medio',
  logo_position TEXT NOT NULL DEFAULT 'esquerda',
  cart_style TEXT NOT NULL DEFAULT 'carrinho',
  banner_enabled BOOLEAN NOT NULL DEFAULT false,
  banner_autoplay BOOLEAN NOT NULL DEFAULT true,
  banner_interval INT NOT NULL DEFAULT 4,
  banner_indicators BOOLEAN NOT NULL DEFAULT true,
  whatsapp_button_color TEXT DEFAULT '#8b5cf6',
  store_description TEXT,
  instagram_url TEXT,
  payment_methods JSONB DEFAULT '[]'::jsonb,
  owner_photo_url TEXT,
  owner_name TEXT,
  owner_bio TEXT,
  owner_hours TEXT,
  background_color TEXT DEFAULT '#FFFFFF'
);

-- ── 2. Tabela categories ──
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Tabela products ──
CREATE TABLE IF NOT EXISTS public.products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  sale_price NUMERIC(10,2),
  images TEXT[] NOT NULL DEFAULT '{}',
  variations JSONB NOT NULL DEFAULT '[]'::jsonb,
  available BOOLEAN NOT NULL DEFAULT true,
  is_new BOOLEAN NOT NULL DEFAULT false,
  is_bestseller BOOLEAN NOT NULL DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  price_options JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- ── 4. Tabela banners ──
CREATE TABLE IF NOT EXISTS public.banners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  href TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  object_position TEXT NOT NULL DEFAULT 'center',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. Tabela orders ──
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  note TEXT,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'novo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 6. Tabela catalog_visits ──
CREATE TABLE IF NOT EXISTS public.catalog_visits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 7. Índices ──
CREATE INDEX IF NOT EXISTS idx_banners_catalog ON public.banners(catalog_id, position);
CREATE INDEX IF NOT EXISTS idx_orders_catalog ON public.orders(catalog_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_catalog ON public.catalog_visits(catalog_id, visited_at DESC);

-- ── 8. Trigger updated_at ──
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_catalogs_updated_at ON public.catalogs;
CREATE TRIGGER update_catalogs_updated_at BEFORE UPDATE ON public.catalogs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON public.products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 9. GRANTs ──
GRANT SELECT ON public.catalogs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalogs TO authenticated;
GRANT ALL ON public.catalogs TO service_role;

GRANT SELECT ON public.categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;

GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;

GRANT SELECT ON public.banners TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banners TO authenticated;
GRANT ALL ON public.banners TO service_role;

GRANT SELECT, INSERT ON public.orders TO anon;
GRANT SELECT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;

GRANT SELECT, INSERT ON public.catalog_visits TO anon;
GRANT SELECT ON public.catalog_visits TO authenticated;
GRANT ALL ON public.catalog_visits TO service_role;

-- ── 10. RLS ──
ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_visits ENABLE ROW LEVEL SECURITY;

-- ── 11. Policies catalogs ──
DROP POLICY IF EXISTS catalogs_public_read ON public.catalogs;
CREATE POLICY catalogs_public_read ON public.catalogs FOR SELECT USING (true);

DROP POLICY IF EXISTS catalogs_owner_insert ON public.catalogs;
CREATE POLICY catalogs_owner_insert ON public.catalogs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS catalogs_owner_update ON public.catalogs;
CREATE POLICY catalogs_owner_update ON public.catalogs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS catalogs_owner_delete ON public.catalogs;
CREATE POLICY catalogs_owner_delete ON public.catalogs FOR DELETE TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS catalogs_anon_read ON public.catalogs;
CREATE POLICY catalogs_anon_read ON public.catalogs FOR SELECT TO anon USING (true);

-- ── 12. Policies categories ──
DROP POLICY IF EXISTS categories_public_read ON public.categories;
CREATE POLICY categories_public_read ON public.categories FOR SELECT USING (true);

DROP POLICY IF EXISTS categories_owner_all ON public.categories;
CREATE POLICY categories_owner_all ON public.categories FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

-- ── 13. Policies products ──
DROP POLICY IF EXISTS products_public_read ON public.products;
CREATE POLICY products_public_read ON public.products FOR SELECT USING (true);

DROP POLICY IF EXISTS products_owner_all ON public.products;
CREATE POLICY products_owner_all ON public.products FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

-- ── 14. Policies banners ──
DROP POLICY IF EXISTS banners_public_read ON public.banners;
CREATE POLICY banners_public_read ON public.banners FOR SELECT USING (true);

DROP POLICY IF EXISTS banners_owner_all ON public.banners;
CREATE POLICY banners_owner_all ON public.banners FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

-- ── 15. Policies orders ──
DROP POLICY IF EXISTS orders_anon_insert ON public.orders;
CREATE POLICY orders_anon_insert ON public.orders FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS orders_owner_select ON public.orders;
CREATE POLICY orders_owner_select ON public.orders FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

DROP POLICY IF EXISTS orders_owner_update ON public.orders;
CREATE POLICY orders_owner_update ON public.orders FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

DROP POLICY IF EXISTS orders_owner_delete ON public.orders;
CREATE POLICY orders_owner_delete ON public.orders FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

-- ── 16. Policies catalog_visits ──
DROP POLICY IF EXISTS visits_public_insert ON public.catalog_visits;
CREATE POLICY visits_public_insert ON public.catalog_visits FOR INSERT TO anon WITH CHECK (true);

DROP POLICY IF EXISTS visits_owner_read ON public.catalog_visits;
CREATE POLICY visits_owner_read ON public.catalog_visits FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

-- ── 17. View pública ──
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

GRANT SELECT ON public.catalogs_public TO anon;
GRANT SELECT ON public.catalogs_public TO authenticated;

-- ── 18. Storage policies ──
CREATE POLICY catalog_images_public_read ON storage.objects FOR SELECT USING (bucket_id = 'catalog-images');
CREATE POLICY catalog_images_auth_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'catalog-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY catalog_images_auth_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'catalog-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY catalog_images_auth_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'catalog-images' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── 19. Recarregar cache ──
NOTIFY pgrst, 'reload schema';
