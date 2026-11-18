-- ⚠️ Rodar no Supabase SQL Editor (bloco único).
--
-- Restaura a gravação de pedidos feita pelo catálogo público.
--
-- Contexto: a migration de pagamentos (20261115090000) remove a política
-- `orders_anon_insert` porque, na Etapa 2, o pedido passa a ser criado pela
-- Edge Function `payments` (que usa service role). Só que essa função ainda
-- NÃO está publicada em produção — então, sem esta política, o checkout não
-- grava pedido nenhum no painel (o erro aparece como
-- "new row violates row-level security policy for table orders").
--
-- Enquanto a Etapa 2 (pagamentos) não estiver publicada, o catálogo grava o
-- pedido direto na tabela `orders`, exatamente como na Etapa 1.
-- Quando os pagamentos entrarem no ar, a migration 20261115090000 volta a
-- remover esta política.

grant insert on public.orders to anon;

drop policy if exists orders_anon_insert on public.orders;

create policy orders_anon_insert on public.orders
  for insert to anon
  with check (true);
