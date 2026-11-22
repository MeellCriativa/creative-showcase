-- Bloco 1/2 — colunas, código curto automático e backfill das lojas antigas.
-- Idempotente: pode rodar em homologação e produção.

alter table public.catalogs
  add column if not exists short_code text,
  add column if not exists whatsapp_welcome_message text;

create unique index if not exists catalogs_short_code_key
  on public.catalogs (short_code)
  where short_code is not null;

create or replace function public.generate_store_short_code()
returns text
language sql
volatile
set search_path = public
as $$
  select substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
$$;

create or replace function public.normalize_catalog_short_code()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_code text;
  v_tries integer := 0;
begin
  if new.short_code is null or btrim(new.short_code) = '' then
    if tg_op = 'UPDATE' then
      v_code := old.short_code;
    end if;
    if v_code is null or btrim(v_code) = '' then
      loop
        v_tries := v_tries + 1;
        v_code := public.generate_store_short_code();
        exit when not exists (
          select 1 from public.catalogs c
          where c.short_code = v_code and c.id <> new.id
        );
        if v_tries > 20 then
          raise exception 'Não foi possível gerar um código curto único. Tente novamente.';
        end if;
      end loop;
    end if;
  else
    v_code = lower(btrim(new.short_code));
    v_code = regexp_replace(v_code, '[^a-z0-9-]+', '-', 'g');
    v_code = btrim(v_code, '-');
  end if;

  if length(v_code) < 3 or length(v_code) > 24 then
    raise exception 'O código curto deve ter entre 3 e 24 caracteres.';
  end if;
  if v_code in ('c', 's', 'auth', 'api', 'functions', 'painel', 'assets', 'admin', 'www') then
    raise exception 'Esse código curto é reservado. Escolha outro.';
  end if;

  new.short_code := v_code;
  return new;
end $$;

drop trigger if exists catalogs_normalize_short_code on public.catalogs;
create trigger catalogs_normalize_short_code
  before insert or update of short_code on public.catalogs
  for each row execute function public.normalize_catalog_short_code();

do $$
declare
  r record;
  v_code text;
  v_tries integer;
begin
  for r in select id from public.catalogs where short_code is null loop
    v_tries := 0;
    loop
      v_tries := v_tries + 1;
      v_code := public.generate_store_short_code();
      exit when not exists (
        select 1 from public.catalogs c where c.short_code = v_code
      );
      if v_tries > 20 then
        raise exception 'Falha ao gerar código curto para a loja %', r.id;
      end if;
    end loop;
    update public.catalogs set short_code = v_code where id = r.id;
  end loop;
end $$;
