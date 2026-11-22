-- Idempotência do e-mail de compra confirmada e reenvio seguro.
-- Aditivo: nenhuma tabela/coluna existente é removida ou reescrita.

create table if not exists public.digital_order_emails (
  order_id uuid primary key references public.orders(id) on delete cascade,
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed')),
  attempts integer not null default 0,
  sent_at timestamptz,
  locked_at timestamptz,
  provider_message_id text,
  last_error text,
  -- JSON criptografado (AES-GCM) com subject/html/text + links reutilizáveis.
  email_bundle_cipher text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.digital_order_emails enable row level security;

-- Nenhum acesso anônimo; o navegador lê apenas metadados da própria loja.
revoke all on public.digital_order_emails from anon;
revoke all on public.digital_order_emails from authenticated;
grant select (order_id, catalog_id, status, attempts, sent_at, provider_message_id, last_error, created_at, updated_at)
  on public.digital_order_emails to authenticated;

drop policy if exists digital_order_emails_owner_select on public.digital_order_emails;
create policy digital_order_emails_owner_select on public.digital_order_emails
  for select to authenticated
  using (exists (
    select 1 from public.catalogs c
    where c.id = catalog_id and c.user_id = auth.uid()
  ));

-- Reserva atômica do envio: apenas uma chamada por vez vence a condição.
-- `sent_at` impede cliques repetidos dentro da janela de resfriamento.
create or replace function public.claim_digital_order_email(
  p_order_id uuid,
  p_allowed_statuses text[],
  p_lock_seconds integer default 120,
  p_cooldown_seconds integer default 5
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed boolean := false;
begin
  update public.digital_order_emails e
     set status = 'sending',
         locked_at = now(),
         updated_at = now()
   where e.order_id = p_order_id
     and e.status = any(p_allowed_statuses)
     and (e.locked_at is null or e.locked_at < now() - (p_lock_seconds || ' seconds')::interval)
     and (e.sent_at is null or e.sent_at < now() - (p_cooldown_seconds || ' seconds')::interval)
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end $$;

-- Finalização atômica: incrementa tentativas e libera a reserva.
create or replace function public.finish_digital_order_email(
  p_order_id uuid,
  p_ok boolean,
  p_message_id text default null,
  p_error text default null,
  p_bundle_cipher text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.digital_order_emails e
     set status = case when p_ok then 'sent' else 'failed' end,
         attempts = e.attempts + 1,
         sent_at = case when p_ok then now() else e.sent_at end,
         locked_at = null,
         provider_message_id = case when p_ok then p_message_id else e.provider_message_id end,
         last_error = case when p_ok then null else p_error end,
         email_bundle_cipher = coalesce(p_bundle_cipher, e.email_bundle_cipher),
         updated_at = now()
   where e.order_id = p_order_id;
end $$;

revoke all on function public.claim_digital_order_email(uuid,text[],integer,integer) from public, anon, authenticated;
revoke all on function public.finish_digital_order_email(uuid,boolean,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_digital_order_email(uuid,text[],integer,integer) to service_role;
grant execute on function public.finish_digital_order_email(uuid,boolean,text,text,text) to service_role;

notify pgrst, 'reload schema';
