CREATE TABLE public.catalogs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  store_name TEXT NOT NULL,
  logo_url TEXT,
  cover_url TEXT,
  whatsapp TEXT,
  primary_color TEXT NOT NULL DEFAULT '#d1477a',
  accent_color TEXT NOT NULL DEFAULT '#fdf2f6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.catalogs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.catalogs TO authenticated;
GRANT ALL ON public.catalogs TO service_role;
ALTER TABLE public.catalogs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catalogs_public_read" ON public.catalogs FOR SELECT USING (true);
CREATE POLICY "catalogs_owner_insert" ON public.catalogs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "catalogs_owner_update" ON public.catalogs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "catalogs_owner_delete" ON public.catalogs FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE public.categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  catalog_id UUID NOT NULL REFERENCES public.catalogs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT ALL ON public.categories TO service_role;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories_public_read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "categories_owner_all" ON public.categories FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

CREATE TABLE public.products (
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.products TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "products_public_read" ON public.products FOR SELECT USING (true);
CREATE POLICY "products_owner_all" ON public.products FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_catalogs_updated_at BEFORE UPDATE ON public.catalogs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "catalog_images_public_read" ON storage.objects FOR SELECT USING (bucket_id = 'catalog-images');
CREATE POLICY "catalog_images_auth_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'catalog-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "catalog_images_auth_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'catalog-images' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "catalog_images_auth_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'catalog-images' AND (storage.foldername(name))[1] = auth.uid()::text);