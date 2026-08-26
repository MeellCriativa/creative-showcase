-- Meta Commerce Catalog Integration
-- Migration: 20260827000000_meta_catalog_integration.sql

-- ============================================================
-- 1. Add meta_catalog_connected column to catalogs
-- ============================================================
ALTER TABLE public.catalogs
  ADD COLUMN IF NOT EXISTS meta_catalog_connected BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 2. meta_catalog_connections — OAuth tokens + catalog link
-- ============================================================
CREATE TABLE IF NOT EXISTS public.meta_catalog_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_id UUID NOT NULL UNIQUE REFERENCES public.catalogs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  facebook_user_id TEXT NOT NULL,
  facebook_access_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token TEXT,
  business_id TEXT NOT NULL,
  business_name TEXT,
  catalog_id_meta TEXT NOT NULL,
  catalog_name TEXT,
  whatsapp_business_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'disconnected',
  last_synced_at TIMESTAMPTZ,
  last_sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. meta_product_mapping — dedup backbone
-- ============================================================
CREATE TABLE IF NOT EXISTS public.meta_product_mapping (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  meta_retailer_id TEXT NOT NULL,
  meta_item_id TEXT,
  sync_state TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(catalog_id, meta_retailer_id),
  UNIQUE(catalog_id, product_id)
);

-- ============================================================
-- 4. meta_sync_logs — audit trail
-- ============================================================
CREATE TABLE IF NOT EXISTS public.meta_sync_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  items_total INTEGER DEFAULT 0,
  items_created INTEGER DEFAULT 0,
  items_updated INTEGER DEFAULT 0,
  items_deleted INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,
  error_details JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- 5. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_meta_mapping_catalog ON public.meta_product_mapping(catalog_id);
CREATE INDEX IF NOT EXISTS idx_meta_mapping_product ON public.meta_product_mapping(product_id);
CREATE INDEX IF NOT EXISTS idx_meta_mapping_retailer ON public.meta_product_mapping(catalog_id, meta_retailer_id);
CREATE INDEX IF NOT EXISTS idx_meta_sync_logs_catalog ON public.meta_sync_logs(catalog_id, started_at DESC);

-- ============================================================
-- 6. RLS
-- ============================================================
ALTER TABLE public.meta_catalog_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_product_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_sync_logs ENABLE ROW LEVEL SECURITY;

-- service_role full access for edge functions
GRANT ALL ON public.meta_catalog_connections TO service_role;
GRANT ALL ON public.meta_product_mapping TO service_role;
GRANT ALL ON public.meta_sync_logs TO service_role;

-- authenticated users: read own data
GRANT SELECT ON public.meta_catalog_connections TO authenticated;
GRANT SELECT ON public.meta_product_mapping TO authenticated;
GRANT SELECT ON public.meta_sync_logs TO authenticated;

-- Connections: owner only
CREATE POLICY meta_conn_owner_all ON public.meta_catalog_connections
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Mapping: owner via catalog
CREATE POLICY meta_mapping_owner_read ON public.meta_product_mapping
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalogs c
    WHERE c.id = meta_product_mapping.catalog_id AND c.user_id = auth.uid()
  ));

-- Logs: owner via catalog
CREATE POLICY meta_logs_owner_read ON public.meta_sync_logs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.catalogs c
    WHERE c.id = meta_sync_logs.catalog_id AND c.user_id = auth.uid()
  ));

-- ============================================================
-- 7. Triggers updated_at
-- ============================================================
CREATE TRIGGER update_meta_connections_updated_at
  BEFORE UPDATE ON public.meta_catalog_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_meta_mapping_updated_at
  BEFORE UPDATE ON public.meta_product_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
