-- WhatsApp/Meta: coluna usada para guardar o número informado no painel.
-- Rode este bloco no SQL Editor do projeto de produção (wdcufpvlbisnqtvmbyso).

alter table public.meta_catalog_connections
  add column if not exists phone_number text;

comment on column public.meta_catalog_connections.phone_number is
  'Normalized WhatsApp Business phone number (e.g. +5551999999999)';

-- Conferência opcional: deve devolver uma linha com phone_number.
-- select column_name, data_type
-- from information_schema.columns
-- where table_schema = 'public'
--   and table_name = 'meta_catalog_connections'
--   and column_name = 'phone_number';
