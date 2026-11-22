-- Bloco 3/4 — reserva atômica do envio de e-mail (evita duplicatas).

create or replace function public.claim_seller_order_email(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.seller_order_notifications n
     set email_status = 'sending',
         email_attempts = n.email_attempts + 1
   where n.order_id = p_order_id
     and n.email_status in ('pending', 'failed')
     and n.email_attempts < 5
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end $$;

revoke all on function public.claim_seller_order_email(uuid) from public, anon, authenticated;
grant execute on function public.claim_seller_order_email(uuid) to service_role;
