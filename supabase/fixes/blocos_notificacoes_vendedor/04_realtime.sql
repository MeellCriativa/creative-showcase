-- Bloco 4/4 — publica a tabela no Realtime para o aviso aparecer no painel.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'seller_order_notifications'
  ) then
    alter publication supabase_realtime add table public.seller_order_notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
