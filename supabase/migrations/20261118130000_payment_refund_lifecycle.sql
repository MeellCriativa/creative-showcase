-- ─────────────────────────────────────────────────────────────────────────────
-- 2.1.3 (F-01, F-02, F-03, F-06) — CICLO DE VIDA da operação de reembolso
--
-- Contexto dos defeitos corrigidos:
--
--  • F-01: a identidade da operação vivia só no navegador (`useRef`). Reload,
--    logout ou timeout perdiam o `operation_id`; a próxima tentativa criava uma
--    chave NOVA no provedor e podia reembolsar o mesmo dinheiro duas vezes.
--    Agora a chave de idempotência é persistida ANTES da chamada ao provedor.
--
--  • F-02: o webhook gravava uma linha `approved` anônima (sem id do provedor,
--    sem operação, sem solicitante) a cada aumento do total oficial. O ledger
--    somava essa linha AO total oficial e o saldo dobrava (30 → 60). Agora
--    essas linhas são classificadas como `snapshot` (espelho, nunca somável).
--
--  • F-03: no reembolso duplicado a linha redundante recebia o
--    `provider_refund_id` do original, violando o índice único; o erro era
--    ignorado e a linha ficava presa em `pending`. Agora ela é cancelada.
--
--  • F-06A: falhas de persistência eram descartadas (sucesso financeiro sem
--    estado gravado). As colunas de diagnóstico abaixo dão suporte ao
--    `local_persist_failed`, sem guardar segredos.
--
-- ── ORDEM DE APLICAÇÃO ───────────────────────────────────────────────────────
--   1. 20261115090000_add_payment_providers.sql      (tabelas base)
--   2. 20261118120000_payment_refund_operations.sql  (operation_id)
--   3. ESTA migration                                (ciclo de vida)
--
-- ── SEGURANÇA / IDEMPOTÊNCIA ────────────────────────────────────────────────
--   • 100% ADITIVA: só cria colunas/índices/comentários. Nenhum DELETE, DROP,
--     rename ou alteração de valor histórico de dinheiro.
--   • `if not exists` em tudo: pode ser reexecutada após falha parcial. Cada
--     bloco é independente — se parar no meio, basta rodar de novo.
--   • O backfill só PREENCHE metadados de classificação (`entry_kind`,
--     `dedupe_key`); não muda `amount`, `status` nem ids.
--
-- ── CONVIVÊNCIA CÓDIGO ANTIGO × NOVO ────────────────────────────────────────
--   • Código NOVO + migration NÃO aplicada: o claim da operação falha FECHADO
--     (HTTP 503 `schema_missing`) e NENHUM reembolso é enviado ao provedor.
--     Leitura de transações/webhooks continua funcionando.
--   • Código ANTIGO + migration aplicada: as colunas novas são opcionais; o
--     código antigo ignora `entry_kind`/`dedupe_key`/`idempotency_key`. Os
--     inserts antigos recebem `entry_kind = 'operation'` (default) e as linhas
--     anônimas do webhook continuam sendo reconhecidas pelo código novo pela
--     assinatura estrutural (aprovada, sem provedor/operação/solicitante).
--     Enquanto o código antigo estiver no ar, a duplicação de saldo do F-02
--     pode continuar apenas na EXIBIÇÃO; nenhum valor novo é somado ao banco.
--   • Recomendado: aplicar esta migration e publicar o código novo na mesma
--     janela. A migration sozinha não piora nada.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Colunas de ciclo de vida ─────────────────────────────────────────────

alter table public.payment_refunds
  add column if not exists idempotency_key text;

alter table public.payment_refunds
  add column if not exists entry_kind text not null default 'operation';

alter table public.payment_refunds
  add column if not exists dedupe_key text;

alter table public.payment_refunds
  add column if not exists last_error text;

alter table public.payment_refunds
  add column if not exists last_attempt_at timestamptz;

-- Só dois tipos de linha: operação real e espelho do total oficial.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_refunds_entry_kind_check'
      and conrelid = 'public.payment_refunds'::regclass
  ) then
    alter table public.payment_refunds
      add constraint payment_refunds_entry_kind_check
      check (entry_kind in ('operation', 'snapshot'));
  end if;
end
$$;

comment on column public.payment_refunds.idempotency_key is
  'Chave de idempotência enviada ao provedor, persistida ANTES da chamada (F-01).';
comment on column public.payment_refunds.entry_kind is
  'operation = reembolso real; snapshot = espelho do total oficial (nunca somável, F-02).';
comment on column public.payment_refunds.dedupe_key is
  'Guarda de ambiguidade: igual a transaction_id enquanto a linha está pending (F-01).';
comment on column public.payment_refunds.last_error is
  'Último erro da operação (sem segredos), para diagnóstico e retry seguro (F-06A).';
comment on column public.payment_refunds.last_attempt_at is
  'Momento da última tentativa no provedor (F-01/F-06A).';

-- ── 2. Backfill de classificação (metadados apenas) ─────────────────────────

-- Linhas anônimas gravadas pelo webhook antigo: aprovadas, sem id do provedor,
-- sem operação e sem solicitante. São ESPELHOS do total oficial, nunca
-- reembolsos adicionais. O código novo já as reconhece pela estrutura; este
-- backfill as torna explícitas e auditáveis.
update public.payment_refunds
set entry_kind = 'snapshot'
where entry_kind is distinct from 'snapshot'
  and status = 'approved'
  and provider_refund_id is null
  and operation_id is null
  and requested_by is null
  and amount > 0;

-- Uma única pendência por transação: a MAIS ANTIGA recebe a guarda. As demais
-- permanecem sem `dedupe_key` (ambíguas legadas) e continuam visíveis no
-- painel para retomada — nada é apagado nem cancelado automaticamente.
with ranked as (
  select
    r.id,
    r.transaction_id,
    row_number() over (
      partition by r.transaction_id
      order by r.created_at asc, r.id asc
    ) as position
  from public.payment_refunds r
  where r.status = 'pending'
    and r.dedupe_key is null
    and r.entry_kind <> 'snapshot'
    and not exists (
      select 1
      from public.payment_refunds existing
      where existing.transaction_id = r.transaction_id
        and existing.dedupe_key is not null
    )
)
update public.payment_refunds target
set dedupe_key = target.transaction_id::text
from ranked
where target.id = ranked.id
  and ranked.position = 1;

-- ── 3. Índices ──────────────────────────────────────────────────────────────

-- Guarda de concorrência: no máximo UMA operação pendente por transação.
-- Parcial de propósito: linhas já concluídas não conflitam entre si.
create unique index if not exists payment_refunds_pending_guard_uidx
  on public.payment_refunds (dedupe_key)
  where dedupe_key is not null and status = 'pending';

-- Busca das pendências por transação (retry/reconciliação).
create index if not exists payment_refunds_transaction_status_idx
  on public.payment_refunds (transaction_id, status);

-- Painel: pendências do catálogo inteiro (retomada após reload/logout, F-01).
create index if not exists payment_refunds_catalog_status_idx
  on public.payment_refunds (catalog_id, status);
