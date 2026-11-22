-- Bloco 2/2 — só permite excluir pedidos marcados como teste e sem cobrança real.
-- Pedidos de teste confirmados via Pix manual ficam approved, mas não têm
-- payment_provider nem payment_transactions: podem ser excluídos normalmente.
-- Idempotente: pode rodar em homologação e produção.

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
