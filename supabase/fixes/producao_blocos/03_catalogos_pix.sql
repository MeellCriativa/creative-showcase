-- ---------------------------------------------------------------------------
-- 3) CATÁLOGOS: dados de recebimento Pix manual.
-- ---------------------------------------------------------------------------
alter table public.catalogs
  add column if not exists pix_mode text not null default 'key'
    check (pix_mode in ('key', 'qr', 'both')),
  add column if not exists pix_key_type text,
  add column if not exists pix_key_value text,
  add column if not exists pix_holder_name text,
  add column if not exists pix_holder_document text,
  add column if not exists pix_qr_path text,
  add column if not exists pix_qr_name text,
  add column if not exists pix_qr_mime text,
  add column if not exists pix_qr_size bigint;

-- Documento do titular é dado sensível: nunca disponível ao navegador anônimo.
revoke select (pix_holder_document) on public.catalogs from anon;
