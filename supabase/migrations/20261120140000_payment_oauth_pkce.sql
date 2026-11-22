-- ============================================================================
-- PKCE S256 para o OAuth do Mercado Pago (RFC 7636)
--
-- A troca do authorization code passa a exigir `code_verifier`. O verifier é
-- gerado no servidor, cifrado com AES-256-GCM (PAYMENT_TOKEN_ENCRYPTION_KEY) e
-- gravado na MESMA linha do nonce do `state`. Assim ele herda uso único,
-- expiração e vínculo com usuário/catálogo/provider já existentes.
--
-- NÃO EXECUTAR EM PRODUÇÃO sem autorização. Esta migration é aditiva:
-- nenhuma linha, conexão financeira ou política existente é removida.
-- ============================================================================

begin;

alter table public.payment_oauth_states
  add column if not exists code_challenge text,
  add column if not exists code_verifier_encrypted text;

comment on column public.payment_oauth_states.code_challenge is
  'PKCE S256: BASE64URL(SHA256(verifier)), enviado na URL de autorizacao.';

comment on column public.payment_oauth_states.code_verifier_encrypted is
  'PKCE: verifier cifrado (AES-256-GCM, formato v1:iv:cipher); nunca em claro.';

-- Defesa em profundidade: challenge e verifier existem juntos, o challenge tem
-- o formato S256 e o verifier gravado precisa estar cifrado. Linhas legadas
-- (PayPal) permanecem com ambos nulos e continuam válidas.
do $$
begin
  alter table public.payment_oauth_states
    add constraint payment_oauth_states_pkce_format check (
      (
        code_challenge is null
        or code_challenge ~ '^[A-Za-z0-9_-]{43}$'
      )
      and (
        code_verifier_encrypted is null
        or code_verifier_encrypted ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
      )
      and (
        (code_challenge is null) = (code_verifier_encrypted is null)
      )
    );
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';

commit;
