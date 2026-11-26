-- Segurança do OAuth da Melhor Envio: state de uso único e isolamento por loja.
-- Migration aditiva: cria tabela/RPC opcionais, sem alterar contas já conectadas.

create table if not exists public.melhor_envio_oauth_states (
  state_hash text primary key,
  catalog_id uuid not null references public.catalogs (id) on delete cascade,
  user_id uuid not null,
  environment text not null check (environment in ('sandbox', 'production')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists melhor_envio_oauth_states_expires_at_idx
  on public.melhor_envio_oauth_states (expires_at);

alter table public.melhor_envio_oauth_states enable row level security;

-- Nenhuma policy: só service_role (backend) pode ler/gravar. Clientes
-- autenticados e anônimos não acessam states de ninguém.
revoke all on table public.melhor_envio_oauth_states from anon, authenticated;
grant all on table public.melhor_envio_oauth_states to service_role;

-- Consome o state atomicamente: concorrência/replay retornam zero linhas.
create or replace function public.consume_melhor_envio_oauth_state(p_state_hash text)
returns table (catalog_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    update public.melhor_envio_oauth_states s
       set consumed_at = now()
     where s.state_hash = p_state_hash
       and s.consumed_at is null
       and s.expires_at > now()
    returning s.catalog_id, s.user_id;
end;
$$;

revoke execute on function public.consume_melhor_envio_oauth_state(text) from public, anon, authenticated;
grant execute on function public.consume_melhor_envio_oauth_state(text) to service_role;

-- Limpeza opcional de states antigos (seguro rodar periodicamente).
create or replace function public.cleanup_melhor_envio_oauth_states()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.melhor_envio_oauth_states
   where expires_at < now() - interval '1 day';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function public.cleanup_melhor_envio_oauth_states() from public, anon, authenticated;
grant execute on function public.cleanup_melhor_envio_oauth_states() to service_role;

notify pgrst, 'reload schema';
