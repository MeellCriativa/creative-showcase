-- Correção: excluir pedido de teste que gerou preferência no Mercado Pago.
-- Sintoma: o botão "Excluir pedido de teste" parecia funcionar (toast de sucesso),
-- mas o pedido continuava na lista. Causa: a política orders_owner_delete exigia
-- payment_provider is null e nenhuma payment_transactions. Um pedido de teste que
-- abortou no checkout tem provider='mercadopago' e uma transação
-- provider_status='preference_created', status='pending', captured_amount=0 —
-- ou seja, nenhum dinheiro foi movimentado.
--
-- RODAR EM: homologação e produção (SQL Editor), um bloco só.
-- Segurança mantida: só o dono do catálogo e só pedidos marcados is_test_order.
-- Continua bloqueado se houver payment_transaction_id (pagamento confirmado) ou
-- qualquer transação com status diferente de preferência, payment id ou valor capturado.

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
