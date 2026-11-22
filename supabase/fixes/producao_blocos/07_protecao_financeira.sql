-- ---------------------------------------------------------------------------
-- 7) PROTEÇÃO FINANCEIRA: navegador nunca altera status de pagamento.
--    service_role (Edge Functions) continua livre.
-- ---------------------------------------------------------------------------
create or replace function public.protect_order_financial_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;

  if tg_op = 'UPDATE' and (
       new.payment_status is distinct from old.payment_status
    or new.payment_provider is distinct from old.payment_provider
    or new.payment_transaction_id is distinct from old.payment_transaction_id
    or new.pix_confirmed_at is distinct from old.pix_confirmed_at
    or new.pix_confirmed_by is distinct from old.pix_confirmed_by
  ) then
    raise exception 'Campos financeiros nao podem ser alterados pelo navegador';
  end if;

  if tg_op = 'INSERT' and (
       coalesce(new.payment_status, 'pending') <> 'pending'
    or new.payment_provider is not null
    or new.pix_confirmed_at is not null
  ) then
    raise exception 'Campos financeiros nao podem ser definidos pelo navegador';
  end if;

  return new;
end $$;

drop trigger if exists orders_protect_financial_columns on public.orders;
create trigger orders_protect_financial_columns
  before insert or update on public.orders
  for each row execute function public.protect_order_financial_columns();

grant execute on function public.protect_order_financial_columns() to anon, authenticated, service_role;
