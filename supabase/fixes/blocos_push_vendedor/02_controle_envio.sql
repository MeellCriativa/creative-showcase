alter table public.seller_order_notifications
  add column if not exists push_status text not null default 'pending',
  add column if not exists push_attempts integer not null default 0,
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_last_error text;

alter table public.seller_order_notifications
  drop constraint if exists seller_order_notifications_push_status_check;
alter table public.seller_order_notifications
  add constraint seller_order_notifications_push_status_check
  check (push_status in ('pending', 'sending', 'sent', 'failed'));

create or replace function public.claim_seller_order_push(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.seller_order_notifications n
     set push_status = 'sending',
         push_attempts = n.push_attempts + 1
   where n.order_id = p_order_id
     and n.push_status in ('pending', 'failed')
     and n.push_attempts < 5
  returning true into v_claimed;

  return coalesce(v_claimed, false);
end $$;

revoke all on function public.claim_seller_order_push(uuid) from public, anon, authenticated;
grant execute on function public.claim_seller_order_push(uuid) to service_role;

notify pgrst, 'reload schema';
