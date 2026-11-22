-- Pedidos de teste: marcação explícita pelo lojista e exclusão segura.
-- Aditivo: nenhuma coluna existente é alterada e nenhum dado é apagado.

alter table public.orders
  add column if not exists is_test_order boolean not null default false;

comment on column public.orders.is_test_order is
  'Pedido criado pelo próprio lojista para teste; é o único tipo de pedido que o painel pode excluir.';

create index if not exists orders_catalog_test_idx
  on public.orders (catalog_id, is_test_order, created_at desc);

-- A política antiga permitia ao dono apagar qualquer pedido do próprio catálogo,
-- inclusive pedidos reais pagos. A nova versão só permite apagar pedidos marcados
-- explicitamente como teste pelo lojista e sem cobrança real (gateway/transação).
-- Pedidos de teste confirmados via Pix manual têm payment_status='approved' mas
-- nenhuma transação: por isso payment_status NÃO é usado como bloqueio aqui.
drop policy if exists orders_owner_delete on public.orders;
create policy orders_owner_delete on public.orders
  for delete to authenticated
  using (
    exists (
      select 1 from public.catalogs c
      where c.id = catalog_id and c.user_id = auth.uid()
    )
    and is_test_order
    and payment_provider is null
    and not exists (
      select 1 from public.payment_transactions pt where pt.order_id = public.orders.id
    )
  );

notify pgrst, 'reload schema';
