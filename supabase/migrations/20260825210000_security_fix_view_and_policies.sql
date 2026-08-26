-- ============================================
-- FIX: Segurança - View pública + Orders
-- ============================================

-- 1. View pública: só campos seguros + whatsapp (necessário para pedidos)
CREATE OR REPLACE VIEW public.catalogs_public AS
SELECT
  id, user_id, slug, store_name, logo_url, cover_url,
  whatsapp, primary_color, accent_color, background_color,
  store_font, logo_size, logo_position, cart_style,
  banner_enabled, banner_autoplay, banner_interval, banner_indicators,
  whatsapp_button_color, payment_methods,
  created_at, updated_at
FROM public.catalogs;

-- 2. Permissões na view
GRANT SELECT ON public.catalogs_public TO anon;
GRANT SELECT ON public.catalogs_public TO authenticated;

-- 3. Remove leitura pública direta da tabela catalogs
DROP POLICY IF EXISTS catalogs_public_read ON public.catalogs;

-- 4. Owner lê só seu próprio catálogo (para o painel)
CREATE POLICY catalogs_owner_select ON public.catalogs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- 5. Orders: separar em policies explícitas
DROP POLICY IF EXISTS orders_owner_all ON public.orders;

CREATE POLICY orders_owner_select ON public.orders
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalogs c
    WHERE c.id = catalog_id AND c.user_id = auth.uid()
  ));

CREATE POLICY orders_owner_update ON public.orders
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalogs c
    WHERE c.id = catalog_id AND c.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.catalogs c
    WHERE c.id = catalog_id AND c.user_id = auth.uid()
  ));

CREATE POLICY orders_owner_delete ON public.orders
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalogs c
    WHERE c.id = catalog_id AND c.user_id = auth.uid()
  ));

NOTIFY pgrst, 'reload schema';
