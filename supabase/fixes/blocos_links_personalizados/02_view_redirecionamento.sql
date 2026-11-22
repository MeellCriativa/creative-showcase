-- Bloco 2/2 — view pública somente leitura usada por /s/CODIGO.
-- Não altera catalogs_public nem nenhuma política existente.

create or replace view public.store_short_links_public as
select
  short_code,
  slug
from public.catalogs
where short_code is not null;

grant select on public.store_short_links_public to anon;
grant select on public.store_short_links_public to authenticated;

notify pgrst, 'reload schema';
