-- Endurecimento da política de INSERT anônimo em public.orders para PRODUÇÃO.
--
-- Contexto: em produção as colunas `payment_status` e `payment_provider`
-- introduzidas pela migração 20261115090000 ainda não existem. Portanto a
-- versão deste arquivo usa somente colunas presentes no schema atual.
--
-- Esta correção:
--   * não exclui nem altera nenhum pedido existente;
--   * não cria nem modifica tabelas, colunas, índices ou triggers;
--   * mantém o fallback `insertOrderDirectly` funcional;
--   * elimina o `with check (true)` irrestrito.
--
-- A politica so permite gravar pedido:
--   * em um catalogo existente na view publica;
--   * no estado minimo produzido pelo checkout (`status = 'novo'`);
--   * com nome do cliente e itens coerentes;
--   * com total nao negativo.

grant insert on public.orders to anon;

drop policy if exists orders_anon_insert on public.orders;

create policy orders_anon_insert on public.orders
  for insert to anon
  with check (
    exists (
      select 1 from public.catalogs_public c where c.id = catalog_id
    )
    and status = 'novo'
    and customer_name is not null
    and length(btrim(customer_name)) between 1 and 120
    and total is not null
    and total >= 0
    and jsonb_typeof(items) = 'array'
    and jsonb_array_length(items) between 1 and 200
  );
