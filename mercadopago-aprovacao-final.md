# Mercado Pago — relatório final de aprovação técnica (homologação)

**Data:** 20/11/2026
**Ambiente avaliado:** homologação — Supabase `ardpqimdllzbbdvwamkh`, worker `https://vitrine-homolog.meellcriativa.workers.dev`
**Produção (`wdcufpvlbisnqtvmbyso`):** NÃO foi acessada, consultada, modificada, implantada nem testada em nenhum momento.
**Commits/pushes:** nenhum. Worktree isolada `mp-correcoes-p0-p3`, HEAD `69b642e`, alterações não commitadas.

## Veredito

**NÃO APROVADO para produção.**

A camada de código, os testes automatizados, o isolamento entre ambientes, a criação de preferência Sandbox e a validação de assinatura de webhook estão aprovados. Porém, **os requisitos financeiros essenciais não foram exercitados**: não há nenhuma conexão OAuth de vendedor em homologação (`payment_connections = 0`), o painel do Mercado Pago exige login (credenciais indisponíveis) e todas as tentativas de criar um pagamento com o token da aplicação foram recusadas pelo Mercado Pago (`403`). Não há evidência de pagamento aprovado/pendente/recusado/cancelado, de redirecionamento de retorno, de reembolso Sandbox nem de liquidação Split 1:1 em conta de vendedor.

Classificação final por bloco:

| Bloco | Classificação |
|---|---|
| Correções P0–P3, P4–P8, P11–P15 e testes de regressão | **APROVADO** |
| Isolamento homologação/produção, RLS e Secrets | **APROVADO** (no que é verificável por CLI/API) |
| Assinatura e idempotência de webhook em runtime | **APROVADO** (parcial — sem notificação real do MP) |
| Criação de Checkout Pro Sandbox (Preferences API) | **APROVADO** |
| OAuth de vendedor / callback ponta a ponta | **PENDENTE** |
| Status financeiros, redirecionamentos e reembolsos Sandbox | **PENDENTE** |
| Split 1:1 com `collector_id` de vendedor | **PENDENTE** |
| Configuração externa no painel do Mercado Pago | **NÃO TESTÁVEL** |
| **Prontidão para produção** | **REPROVADO** |

---

## 1. Ambiente, deploy e rastreabilidade

Todos os comandos remotos foram executados com `--project-ref ardpqimdllzbbdvwamkh`. Nenhum comando usou `supabase/config.toml` como padrão (ele aponta para produção).

Funções após o deploy final:

| Função | Status | Versão | `verify_jwt` |
|---|---|---:|---|
| `payments` | ACTIVE | 8 | `false` |
| `payments-callback` | ACTIVE | 8 | `false` |
| `webhooks-mercadopago` | ACTIVE | 8 | `false` |
| `webhooks-paypal` | ACTIVE | 8 | `false` |
| `melhor-envio` | ACTIVE | 22 | `false` |
| `melhor-envio-callback` | ACTIVE | 22 | `false` |

Secrets conferidos **por nome e hash, sem exibir valores**: `MP_ENV` confere com `sandbox`; `SUPABASE_URL` confere com `https://ardpqimdllzbbdvwamkh.supabase.co`; `VITRINE_URL` confere com o worker de homologação; `MERCADOPAGO_WEBHOOK_SECRET`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `PAYMENT_TOKEN_ENCRYPTION_KEY` e `PAYMENT_STATE_SECRET` presentes.

**Classificação: APROVADO.**

---

## 2. Testes automatizados

- `npm test`: **486 testes / 486 aprovados / 0 falhas**.
- Baseline preservado: nenhum teste foi excluído, desabilitado ou enfraquecido.
- Novos testes de regressão criados nesta etapa: `tests/payment-correcoes-pendencias.test.ts` (15 testes: P4, P7, P8, P10, P11, P12, P13, P15.1, P15.2, P15.3).
- `git diff --check`: limpo.

Os testes cobrem funções puras, fetch simulado, leitura de arquivos e `env` local — sem rede, banco, cobrança ou Secrets reais.

**Classificação: APROVADO.**

---

## 3. Correções implementadas nesta etapa

| Item | Correção |
|---|---|
| **P4** | Chave de idempotência por **tentativa** de checkout, não por pedido. Hash de `orderId + provider + environment + checkout_token`; retry da mesma sessão mantém a chave, novo checkout gera outra. Fallback para `external_reference` preserva chamadores antigos. `attempt_id` e `idempotency_key` persistidos em `metadata`. |
| **P5** | `notification_url` validada no caminho real de criação da preferência; origem do `SUPABASE_URL` do runtime como única fonte de verdade; fail-fast se ausente. |
| **P6** | Coleta de todos os valores `v1`, aceitação de qualquer par `(ts, v1)` fresco e matematicamente válido, suporte a `ts` de 10 e 13 dígitos, omissão de pares ausentes no manifesto. |
| **P7** | `sellerAccountId` (`collector_id`) da API oficial propagado pela resolução; checagem de cruzamento entre lojas mesmo quando o payload não traz `user_id`. Função pura `isCrossCatalogEvent` mantida intacta. |
| **P8** | Fingerprint endurecido: `cf-connecting-ip` só com `cf-ray`; `x-forwarded-for` usa o **último** valor (proxy); sem confiar em `x-real-ip`. Ações mutantes (`create_order`, `create_payment`) falham fechado com 503 quando o limitador está indisponível; leituras permanecem fail-open. Helper puro extraído para `fingerprint.ts`. |
| **P10** | `supabase/fixes/20261118_restore_orders_anon_insert.sql` endurecido: nunca `with check (true)`; exige catálogo existente em `catalogs_public`, `status='novo'`, `payment_status` pendente, sem provider, nome e itens válidos. **Arquivo não aplicado em homologação.** |
| **P11** | Falha ao gravar o nonce OAuth agora aborta o `connect` com 503, em vez de deixar o callback morrer como `state_already_used`. |
| **P12** | Texto livre do provedor (`error`, exceções) não vai mais para logs cru — apenas rótulos estáveis via `stableError`. |
| **P13** | `panelBaseUrl()` (pode conter path) separado de `panelOrigin()` (origem estrita). `return_url` legítimo com path deixa de cair no fallback. |
| **P15.1** | Limite de requisições inválidas no caminho do webhook, sem travar reenvios legítimos do MP. |
| **P15.2** | Para MP, o id de pagamento notificado/assinado tem precedência sobre o id salvo na transação. |
| **P15.3** | `statement_descriptor` derivado do nome da loja, sanitizado para ASCII e limitado a 22 caracteres. |

**Classificação: APROVADO.**

---

## 4. RLS e isolamento de dados (homologação)

Auditado por link temporário da CLI:

- `catalogs`, `orders`, `order_checkout_sessions`, `payment_connections`, `payment_events`, `payment_oauth_states`, `payment_refunds`, `payment_transactions`: **RLS habilitado**.
- Única política anônima em tabelas públicas: `catalog_visits.visits_public_insert` (`with check (true)`) — escopo correto.
- **Não existe** `orders_anon_insert` em homologação; `anon` **não** tem grant de INSERT em `orders`. O fallback `insertOrderDirectly` do frontend está funcionalmente quebrado em homologação, mas **não é uma brecha aberta**.
- Decisão mantida: não criar política anônima de INSERT em `orders` em homologação. O endurecimento do arquivo de correção é documental; não foi aplicado.

Contagens finais: `payment_connections=0`, `order_checkout_sessions=0`, `payment_transactions=0`, `orders=2`, `payment_events=0` (duas linhas de teste residual removidas explicitamente por id).

**Classificação: APROVADO** para o estado atual de homologação; **PENDENTE** a decisão de como habilitar o fallback de pedidos em produção sem reintroduzir risco.

---

## 5. Webhook — validação em runtime

Executado com função temporária (`mp-webhook-selftest`, deployada e removida) contra o código real:

| Cenário | Resultado |
|---|---|
| Assinatura inválida | HTTP 401 `{"success":false,"error":"Assinatura inválida."}` |
| Assinatura válida gerada com o Secret injetado | HTTP 200 `{"success":true,"ignored":"transaction_not_found"}` |
| Evento já marcado como processado | HTTP 200 `{"success":true,"duplicate":true}` |
| Múltiplos `v1`, com valor válido no fim | HTTP 200 |
| `ts` antigo (replay) | HTTP 401 |
| Manifesto sem `x-request-id` | HTTP 200 |

O webhook real respondeu 401 sem assinatura. **Não houve notificação gerada pelo Mercado Pago** — apenas requisições sintéticas com assinatura matematicamente válida.

**Classificação: APROVADO (parcial).** Falta o ciclo real notificação → snapshot oficial → confirmação de pagamento.

---

## 6. Checkout Pro Sandbox — evidência obtida

Token de aplicação obtido via `client_credentials` dentro de função temporária, sem expor Secret nem access token (somente metadados: `scope` com `payments`/`preference`, `expires_in=21600`, `user_id=467889772`).

Preferência criada com o código real do provedor (`mercadopagoProvider.createPayment`, já com P4/P5/P6/P15.3):

- `id`: `467889772-aa07ee7a-23bb-443a-b43c-ff7536c867e6`
- Checkout: `https://sandbox.mercadopago.com.br/checkout/v1/redirect?pref_id=...` → **confirma Sandbox**
- `status`: `pending` / `providerStatus`: `preference_created`
- `external_reference`: `6fc484c7-b652-4358-9570-86182f1e5a95`

Consulta oficial `GET /checkout/preferences/{id}` confirmou:

- `notification_url = https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago` (**isolamento correto**)
- `external_reference` igual ao enviado
- `marketplace_fee = 0` → ausência de comissão, compatível com Split 1:1
- `statement_descriptor = "Vitrine Teste"` → P15.3 ativo
- item: quantidade 1, `unit_price = 10`

O Checkout Pro foi aberto no navegador: tela "Como você prefere pagar?" e formulário de cartão carregados. Foram informados os dados oficiais de teste (Visa `4235 6477 2802 5682`, CVV `123`, vencimento `11/30`, titular `APRO`, CPF `12345678909`), mas o envio automatizado do formulário não concluiu a compra (limitação de automação da UI).

Tentativas via API oficial com o token da aplicação:

- `POST /v1/card_tokens` → `403 The request could not be completed.`
- `POST /v1/payments` (`account_money`) → `403 At least one policy returned UNAUTHORIZED.`

Isso confirma que **um token de vendedor obtido por OAuth é obrigatório** para cobrar; o token da aplicação não autoriza pagamentos.

Função temporária `mp-sandbox-evidence` removida do disco e do projeto; aba do navegador fechada; nenhuma linha de teste restante no banco.

**Classificação: APROVADO** para criação de preferência e configuração da requisição; **PENDENTE** para pagamento propriamente dito.

---

## 7. Itens pendentes e não testáveis

### PENDENTE — dependem de configuração/ação externa

1. **Nenhum vendedor conectado:** `payment_connections = 0`. Fluxo OAuth `/painel/pagamentos` → `payments?action=connect` → `payments-callback` não pôde ser exercitado ponta a ponta.
2. **Pagamentos simulados oficiais:** aprovado, pendente, recusado, cancelado; redirecionamentos `back_urls`/`auto_return`.
3. **Split 1:1 financeiro:** `GET /v1/payments/{id}` com `collector_id` da conta do vendedor, `external_reference`, valor e moeda. O `marketplace_fee=0` da preferência comprova a intenção do código, **não a liquidação**.
4. **Reembolso Sandbox** (total/parcial) e reconciliação de saldo com evento real.
5. **Webhook real do MP** disparado por pagamento, com snapshot oficial e atualização de `orders`.

### NÃO TESTÁVEL — sem credenciais do painel

`webfetch` ao painel do Mercado Pago retornou tela de login. Não foi possível verificar:

- Redirect URL configurada;
- Webhook URL cadastrada;
- eventos inscritos `payment` e `topic_merchant_order_wh`;
- modelo Marketplace habilitado no aplicativo;
- KYC nível 6 / credenciamento do vendedor.

### Limitações de ferramenta

- CLI Supabase v2.109.1 não possui `supabase functions logs`.
- `supabase functions download` falha para algumas funções com `UnsafeFunctionDownloadPathError` em `src/lib/currency.ts`; a verificação do publicado foi feita por `ezbr_sha256`, lista de funções e upload de assets.

---

## 8. Checklist para converter a classificação em aprovação

1. No painel do Mercado Pago (ambiente de teste): confirmar Redirect URL, Webhook URL, eventos `payment` e `topic_merchant_order_wh`, modelo Marketplace e credenciamento/KYC do vendedor de teste.
2. Em `/painel/pagamentos` de homologação: conectar um vendedor de teste via OAuth e confirmar `payment_connections >= 1` com token criptografado.
3. Criar pedido → preferência → abrir Checkout Pro → pagar com cartão de teste oficial aprovado; confirmar `back_urls` e `auto_return`.
4. Confirmar `GET /v1/payments/{id}`: `status=approved`, `external_reference` do pedido, `collector_id` igual à conta conectada, valor/moeda corretos e sem comissão.
5. Verificar webhook real: assinatura válida, idempotência, snapshot oficial, `orders.payment_status` atualizado.
6. Repetir cenários pendente/recusado/cancelado e reembolso total/parcial.
7. Somente depois disso reconsiderar a promoção a produção — **sem reutilizar credenciais ou dados de homologação**.

---

## 9. Afirmações finais

- Nenhuma operação foi realizada em produção.
- Nenhum commit ou push foi feito.
- Nenhuma credencial real foi usada; nenhum valor de Secret foi exibido.
- Nenhum pagamento real foi efetuado; apenas Sandbox.
- Funções e dados temporários de teste foram removidos.
- **Aprovação financeira não é concedida neste documento.**
