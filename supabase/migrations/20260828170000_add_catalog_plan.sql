-- Plano/etiqueta da conta do vendedor: free | mensal | trimestral | anual
ALTER TABLE public.catalogs
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- atualiza a view pública para incluir o plano (se existir)
DO $$
DECLARE
  v_cols TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema='public' AND table_name='catalogs_public') THEN
    SELECT string_agg(column_name, ', ')
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema='public' AND table_name='catalogs'
       AND column_name <> 'user_id'
       AND column_name <> 'meta_catalog_connected';
    IF v_cols IS NOT NULL THEN
      EXECUTE format('CREATE OR REPLACE VIEW public.catalogs_public AS SELECT %s FROM public.catalogs;', v_cols);
    END IF;
  END IF;
END $$;