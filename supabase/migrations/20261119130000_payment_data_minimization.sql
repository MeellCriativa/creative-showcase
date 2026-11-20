-- ============================================================================
-- Etapa 2.2 — minimização de dados financeiros expostos ao navegador
--
-- As Edge Functions usam `service_role` e continuam com acesso completo.
-- Usuários autenticados passam a ver apenas colunas necessárias ao painel;
-- o painel já consome tudo por meio da função `payments`, nunca via PostgREST.
--
-- NÃO EXECUTAR EM PRODUÇÃO sem revisão e aprovação. Aplicar primeiro em
-- homologação e validar o painel `/painel/pagamentos` antes de promover.
-- ============================================================================

begin;

-- Tokens cifrados, label bruta da conta e identificadores de conta saem do
-- escopo de SELECT do navegador. A Edge Function devolve versões mascaradas.
-- `REVOKE ALL` também remove TRUNCATE/TRIGGER e quaisquer grants a nível de
-- coluna; em seguida concedemos só o necessário.
revoke all on table public.payment_connections from anon, authenticated;
grant select (
  id, catalog_id, provider, environment, status, enabled, connected,
  capabilities, connected_at, last_verified_at, created_at, updated_at
) on public.payment_connections to authenticated;
-- Preserva o toggle existente no painel (quando feito via PostgREST).
grant update (enabled) on public.payment_connections to authenticated;

-- `payer_reference`, `checkout_url` e `metadata` podem conter identificadores
-- do comprador ou links de pagamento. Nunca devem ser lidos diretamente.
revoke all on table public.payment_transactions from anon, authenticated;
grant select (
  id, catalog_id, order_id, provider, environment, provider_order_id,
  provider_payment_id, status, provider_status, currency, amount,
  amount_minor, captured_amount, refunded_amount, last_event_at,
  created_at, updated_at
) on public.payment_transactions to authenticated;

-- Payload bruto de webhook e erro de processamento ficam apenas no backend.
revoke all on table public.payment_events from anon, authenticated;
grant select (
  id, provider, provider_event_id, event_type, transaction_id, order_id,
  signature_valid, processed, received_at, processed_at
) on public.payment_events to authenticated;

-- `reason` é texto livre digitado pelo lojista e pode conter dados pessoais.
revoke all on table public.payment_refunds from anon, authenticated;
grant select (
  id, transaction_id, catalog_id, provider, provider_refund_id, amount,
  status, requested_by, created_at, updated_at
) on public.payment_refunds to authenticated;

notify pgrst, 'reload schema';

commit;
