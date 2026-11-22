-- ---------------------------------------------------------------------------
-- 4) PEDIDOS: método de pagamento e trilha do Pix manual.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists payment_method text
    check (payment_method in ('pix_manual', 'paypal', 'mercadopago', 'whatsapp')),
  add column if not exists pix_declared_at timestamptz,
  add column if not exists pix_confirmed_at timestamptz,
  add column if not exists pix_confirmed_by uuid;

create index if not exists orders_payment_method_idx
  on public.orders (catalog_id, payment_method, created_at desc);
