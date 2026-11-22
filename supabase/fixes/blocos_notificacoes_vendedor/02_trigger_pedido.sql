-- Bloco 2/4 — registro automático para QUALQUER pedido novo.
-- Cobre payments, pix-manual e o insert anônimo de fallback.

create or replace function public.register_seller_order_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.seller_order_notifications
    (order_id, catalog_id, customer_name, total, currency, payment_method)
  values
    (new.id, new.catalog_id, new.customer_name, new.total, new.currency, new.payment_method)
  on conflict (order_id) do nothing;
  return new;
end $$;

drop trigger if exists orders_register_seller_notification on public.orders;
create trigger orders_register_seller_notification
  after insert on public.orders
  for each row execute function public.register_seller_order_notification();

revoke all on function public.register_seller_order_notification() from public, anon, authenticated;
grant execute on function public.register_seller_order_notification() to service_role, postgres;
