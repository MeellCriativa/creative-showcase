# Relatório de execução — Mercado Pago PKCE (homologação)

**Data:** 21/11/2026 (UTC)
**Projetos:** produção `wdcufpvlbisnqtvmbyso` · homologação `ardpqimdllzbbdvwamkh`

Todas as operações de banco foram feitas pela **Management API com `project_ref` explícito**,
com confirmação do projeto (`GET /v1/projects/<ref>`) imediatamente antes de cada escrita.
`supabase db query --linked` **não foi utilizado**. Nenhuma credencial, token, verifier
ou Secrets foram exibidos. Nenhum commit/push foi feito.

---

## 1. Configuração local

- `supabase/config.toml` → `project_id = "ardpqimdllzbbdvwamkh"` (já corrigido na etapa anterior).
- `.temp/project-ref` e `.temp/linked-project.json` → `ardpqimdllzbbdvwamkh`.
- A divergência histórica da CLI (`db query --linked` resolvendo produção) permanece;
  por isso ela foi evitada. A Management API foi a única via de banco utilizada.

---

## 2. Homologação — resultado

| Item | Resultado |
|---|---|
| Migration `20261120140000_payment_oauth_pkce.sql` | **aplicada** via Management API |
| Colunas `code_challenge`, `code_verifier_encrypted` | presentes (`text`, nullable) |
| Constraint `payment_oauth_states_pkce_format` | presente |
| Histórico `schema_migrations` | versão `20261120140000` registrada |
| Funções publicadas | `payments`, `payments-callback`, `webhooks-mercadopago` → **v12**, `ACTIVE`, `verify_jwt=false` |
| Bundles v12 inspecionados (ESZIP) | `code_challenge`, `code_challenge_method: "S256"`, `code_verifier`, `pkceChallenge` presentes |
| Catálogo de teste | `2e2cf2a3-d28d-40a0-8d9e-68df03a006b8` (slug `pkce-homolog-73ff28d6e9`) |
| Estados OAuth | 3 (2 consumidos), todos com challenge válido e verifier cifrado |
| Conexões / transações | 1 conexão Sandbox / 0 transações |

### Correção do redirect_uri no app Sandbox

A primeira tentativa de autorização falhou com `strict_redirect_uri_mismatch`: o app
Mercado Pago (`3678587502945752`) estava cadastrado com o callback de **produção**
(`wdcufpvlbisnqtvmbyso`). A URL foi corrigida no painel do app para
`https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/payments-callback`, com o
flag `use_pkce=true` já habilitado, e a persistência foi confirmada por recarga.
Nenhum Secret da aplicação foi alterado.

### OAuth Sandbox — validação concluída

1. `POST /functions/v1/payments?action=connect` retornou SUCESSO.
2. URL de autorização conferida: host `auth.mercadopago.com.br`, `response_type=code`,
   `code_challenge_method=S256`, `code_challenge` com 43 caracteres BASE64URL,
   `state` assinado com `env=sandbox` e `redirect_uri` do projeto de homologação.
3. Banco: 1 linha com challenge idêntico ao da URL, verifier cifrado (`v1:...`),
   `consumed_at IS NULL`, escopo `provider=mercadopago` + `catalog_id` correto.
4. Teste da troca com **código inválido** (`INVALID_TEST_CODE`): o callback consumiu o
   grant, descriptografou o verifier e tentou `POST /oauth/token` com `code_verifier`
   (confirmado no bundle v12). O Mercado Pago respondeu e o fluxo terminou em
   `connected=0`, erro `authorization_expired` — sem emissão de token, sem conexão
   gravada. Esse state foi consumido, como esperado (uso único).
5. Após corrigir o redirect_uri, uma nova autorização S256 gerou `code_challenge` válido,
   o login da conta de teste foi aprovado e o retorno chegou em
   `/painel/pagamentos?provider=mercadopago&connected=1`.
6. Verificação no banco de homologação:

| Verificação | Resultado |
|---|---|
| `payment_connections` | 1 linha, `provider=mercadopago`, `environment=sandbox`, `status=connected`, `connected=true` |
| `access_token_enc` / `refresh_token_enc` | ambos presentes no formato cifrado `v1:...` (valores nunca exibidos) |
| `external_account_id` | presente |
| `token_expires_at > now()` | `true` |
| Estados OAuth | 3 no total, 2 consumidos, 2 com verifier cifrado consumido |
| `payment_transactions` | 0 — nenhuma cobrança |
| Eventos com indício de credencial no payload/erro | 0 (varredura por padrões, sem exibir valores) |

O Access Token foi obtido e a conexão registrada, ambos criptografados em repouso.
Nenhum valor sensível foi exibido em nenhum momento.

---

## 3. Produção — resultado

| Item | Resultado |
|---|---|
| DDL PKCE já aplicado no incidente | verificado como **equivalente** ao arquivo da migration (tipos, nullable, comments e definição da constraint idênticos) |
| Histórico `schema_migrations` | versão `20261120140000` **registrada** (`name=payment_oauth_pkce`, 1 statement) |
| Catálogo órfão `aa220e73-979f-400c-a761-73cfb1656005` | **removido** após confirmação de identidade, `usuario_existe=false` e 0 dependentes |
| Busca por `pkce-homolog-%` | 0 registros |
| `payment_connections` / `payment_transactions` | 0 / 0 |
| Funções publicadas | `payments` v8, `payments-callback` v8, `webhooks-mercadopago` v8 — **inalteradas** |
| Secrets | inalterados |
| Cobranças reais | nenhuma |

---

## 4. Regressão PayPal

- Código PayPal não modificado nesta etapa.
- `npm test` → **535 testes, 535 pass, 0 fail** (inclui a suíte PKCE e os testes de correções M1/M4/P3/P5).
- Nenhuma chamada de cobrança foi feita em nenhum provedor.

---

## 5. Segurança e escopo

- Antes de cada escrita: confirmação do projeto pela Management API.
- Depois de cada operação: verificação do resultado por nova consulta.
- Nenhum valor de Secret, token, verifier, hash ou credencial foi exibido.
- Nenhum deploy em produção, nenhuma alteração de funções publicadas em produção,
  nenhuma nova migration em produção, nenhuma alteração de Secrets, nenhuma cobrança real.
- Nenhum commit ou push.

---

## 6. Resumo do objetivo final

| Entrega | Status |
|---|---|
| Homologação com migration e funções compatíveis | ✅ concluído |
| Catálogo órfão tratado | ✅ concluído |
| Histórico de migration consistente (ambos os projetos) | ✅ concluído |
| PayPal sem regressões | ✅ concluído |
| OAuth Sandbox aprovado | ✅ concluído (após corrigir redirect_uri do app) |
| Access Token obtido e conexão registrada | ✅ concluído (cifrado, `status=connected`, sandbox) |
| Verifier armazenado cifrado | ✅ concluído (uso único confirmado) |
| PayPal sem regressões | ✅ concluído (535/535 testes) |
| Publicação em produção | ⏳ aguardando autorização expressa |

---

## 7. Próximo passo

Todas as entregas de homologação foram concluídas.

---

## 8. Publicação em produção (autorizada posteriormente)

Após o relato de erro no ambiente de produção ("Desculpe, não foi possível conectar o
aplicativo à sua conta"), foi feita auditoria READ-ONLY que identificou duas causas:

1. **Causa imediata:** a correção do `callback_url` do app Mercado Pago para homologação
   removeu o retorno de produção → `strict_redirect_uri_mismatch`.
2. **Causa de fundo:** produção ainda executava as funções **v8**, sem PKCE — 4 estados
   OAuth recentes, nenhum com `code_challenge`.

Com autorização expressa:

| Ação | Resultado |
|---|---|
| Deploy `payments`, `payments-callback`, `webhooks-mercadopago` em `wdcufpvlbisnqtvmbyso` | **v9**, `ACTIVE`, `verify_jwt=false` |
| Bundles v9 inspecionados (ESZIP) | `generateCodeVerifier`, `pkceChallenge`, `code_challenge`, `code_verifier` presentes |
| Callback de produção cadastrado no app Mercado Pago | adicionado **sem remover** o de homologação; `use_pkce=true` mantido |
| Persistência confirmada por recarga | ambas as URLs presentes |
| Produção after-care | 0 conexões, 0 transações, 0 cobranças — nenhuma alteração de Secrets |

O deploy usou sempre `--project-ref` explícito; `db query --linked` não foi utilizado.
Nenhum commit ou push foi feito.

### Observação sobre homologação

A mensagem "Mercado Pago conectado! Verifique a conta e habilite o método no checkout."
indica que a conexão Sandbox foi gravada mas está com `enabled=false`. É necessário
habilitar o método na tela de formas de pagamento do painel. Há 2 conexões Sandbox
registradas (duas tentativas de OAuth), ambas `connected=true`, `enabled=false`; nenhuma
foi removida.
