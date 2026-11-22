-- ---------------------------------------------------------------------------
-- 8) RPC ATÔMICA DE CONFIRMAÇÃO DO PIX MANUAL (somente service_role).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_manual_payment(
  p_order_id uuid,
  p_actor uuid default null
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog uuid;
  v_declared timestamptz;
begin
  update public.orders o
     set payment_status = 'approved',
         pix_confirmed_at = now(),
         pix_confirmed_by = p_actor
   where o.id = p_order_id
     and o.payment_method = 'pix_manual'
     and o.payment_status = 'pending'
     and o.pix_declared_at is not null
  returning o.catalog_id, o.pix_declared_at into v_catalog, v_declared;

  if v_catalog is null then
    return false;
  end if;

  insert into public.manual_payment_confirmations
    (order_id, catalog_id, declared_at, confirmed_at, confirmed_by)
  values
    (p_order_id, v_catalog, v_declared, now(), p_actor)
  on conflict (order_id) do update
     set attempts = public.manual_payment_confirmations.attempts + 1,
         confirmed_at = excluded.confirmed_at;

  return true;
end $$;

revoke all on function public.confirm_manual_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_manual_payment(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
