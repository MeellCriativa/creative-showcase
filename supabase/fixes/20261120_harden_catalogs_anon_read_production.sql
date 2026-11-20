-- Endurecimento de leitura anônima em public.catalogs para PRODUÇÃO.
--
-- A vitrine pública (src/routes/c.$slug.tsx) consulta exclusivamente
-- public.catalogs_public. O painel usa o cliente autenticado e a política
-- `catalogs_owner_select`. Portanto o acesso anônimo à tabela base não é
-- necessário e expõe colunas como user_id, plan e meta_catalog_connected.
--
-- Esta correção:
--   * não exclui nem altera nenhum catálogo;
--   * não modifica a view catalogs_public;
--   * preserva o acesso público via view;
--   * preserva o acesso autenticado do dono via RLS.

begin;

drop policy if exists catalogs_anon_read on public.catalogs;
drop policy if exists catalogs_public_read on public.catalogs;

revoke select on public.catalogs from anon;

grant select on public.catalogs_public to anon;
grant select on public.catalogs_public to authenticated;

notify pgrst, 'reload schema';

commit;
