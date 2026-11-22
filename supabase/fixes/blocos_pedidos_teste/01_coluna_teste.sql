-- Bloco 1/2 — coluna de marcação de pedido de teste (padrão false = pedido real).
-- Idempotente: pode rodar em homologação e produção.

alter table public.orders
  add column if not exists is_test_order boolean not null default false;

comment on column public.orders.is_test_order is
  'Pedido criado pelo próprio lojista para teste; é o único tipo de pedido que o painel pode excluir.';

create index if not exists orders_catalog_test_idx
  on public.orders (catalog_id, is_test_order, created_at desc);
