-- Bloco 2/2 — só permite excluir pedidos marcados como teste e sem cobrança real.
-- Pedidos de teste confirmados via Pix manual ficam approved, mas não têm
-- payment_provider nem payment_transactions: podem ser excluídos normalmente.
-- Um pedido de teste que abortou no checkout do Mercado Pago tem
-- payment_provider preenchido e uma transação 'preference_created' (sem pagamento).
-- Isso não é cobrança: a política antiga bloqueava essa exclusão sem mostrar erro.
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
    and payment_transaction_id is null
    and not exists (
      select 1 from public.payment_transactions pt
      where pt.order_id = public.orders.id
        and (
          pt.provider_status is distinct from 'preference_created'
          or pt.provider_payment_id is not null
          or coalesce(pt.captured_amount, 0) > 0
          or coalesce(pt.refunded_amount, 0) > 0
        )
    )
  );

notify pgrst, 'reload schema';
