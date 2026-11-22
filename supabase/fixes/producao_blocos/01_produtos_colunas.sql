-- Cadastro de produtos, checkout personalizado, Pix manual e links externos digitais.
-- 100% aditivo: nenhuma coluna/tabela existente é removida ou reescrita.
-- Projeto de destino: PRODUÇÃO (wdcufpvlbisnqtvmbyso).
-- Rodar no SQL Editor, em blocos pequenos, se o navegador travar.
-- Este arquivo é idempotente: pode ser executado mais de uma vez.

-- ---------------------------------------------------------------------------
-- 1) PRODUTOS: informações adicionais, modalidade de entrega digital e
--    configuração visual do checkout por dispositivo (JSONB).
-- ---------------------------------------------------------------------------
alter table public.products
  add column if not exists additional_info text,
  add column if not exists digital_delivery_mode text not null default 'file'
    check (digital_delivery_mode in ('file', 'link')),
  add column if not exists digital_external_url text,
  add column if not exists checkout_enabled boolean not null default false,
  add column if not exists checkout_desktop_config jsonb not null default '{}'::jsonb,
  add column if not exists checkout_mobile_config jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_digital_link_requires_https'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_digital_link_requires_https
      check (
        digital_delivery_mode <> 'link'
        or (
          digital_external_url is not null
          and btrim(digital_external_url) ~* '^https://'
        )
      );
  end if;
end $$;

-- O link externo do produto digital é secreto até a aprovação do pagamento.
-- Remove apenas o privilégio de SELECT de anon e devolve todas as colunas
-- públicas, exceto a URL bruta. authenticated (dono da loja) mantém acesso.
do $$
declare
  v_cols text;
begin
  revoke select on public.products from anon;
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'products'
    and column_name not in ('digital_external_url');
  execute format('grant select (%s) on public.products to anon', v_cols);
end $$;
