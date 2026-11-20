-- ─────────────────────────────────────────────────────────────────────────────
-- R-01 (auditoria 2.1) — identificador da OPERAÇÃO de reembolso
--
-- Antes a idempotência do reembolso era derivada do VALOR
-- (`refund-{capture}-{amount}`), então dois reembolsos legítimos de mesmo valor
-- compartilhavam a chave: o segundo nunca era executado no provedor e o saldo
-- local podia ser incrementado duas vezes.
--
-- A partir daqui cada operação de reembolso tem um `operation_id` próprio
-- (UUID gerado pelo painel, com fallback no servidor). Retries da MESMA
-- operação reusam o mesmo id/chave; operações distintas — ainda que de mesmo
-- valor — usam ids distintos.
--
-- Migration ADITIVA e idempotente: pode ser executada mais de uma vez.
-- O código da Edge Function degrada com segurança enquanto ela não for
-- aplicada (insert sem `operation_id`), portanto não há janela de
-- indisponibilidade. A coluna é opcional (`null` = registro anterior).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.payment_refunds
  add column if not exists operation_id uuid;

comment on column public.payment_refunds.operation_id is
  'Identificador da operação de reembolso (idempotência por operação, R-01).';

-- Uma operação só pode existir uma vez por transação. O índice é parcial para
-- não conflitar com os registros históricos (operation_id nulo).
create unique index if not exists payment_refunds_operation_uidx
  on public.payment_refunds (transaction_id, operation_id)
  where operation_id is not null;

-- Busca do reembolso pelo id do provedor (dedupe do ledger) já é coberta pelo
-- índice parcial criado na migration de integridade; reforçamos aqui para
-- consultas por transação + provedor.
create index if not exists payment_refunds_transaction_provider_idx
  on public.payment_refunds (transaction_id, provider);
