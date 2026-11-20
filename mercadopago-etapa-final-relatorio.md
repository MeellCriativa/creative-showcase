# Etapa Final — Conclusão da Integração Mercado Pago (Vitrine Criativa)

Data: 20/11/2026
Projeto de homologação: **`ardpqimdllzbbdvwamkh`** (`vitrine-criativa-homolog`)
Produção `wdcufpvlbisnqtvmbyso`: **não acessada, não modificada, não usada em nenhum teste**.

> **Veredito resumido:** as correções autorizadas (P5, P6 e a mensagem cosmética) foram aplicadas e
> cobertas por testes. **A integração NÃO está pronta para produção.** Os fluxos financeiros reais
> em Sandbox não foram executados (exigem sua autorização expressa), as configurações externas do
> app Mercado Pago não foram verificadas, e **as correções P5/P6 ainda não estão deployadas** — o
> ambiente remoto continua na v6, que contém os bugs P5/P6.

---

## 0. Escopo executado e limites respeitados

| Item | Situação |
|---|---|
| Worktree de trabalho | `C:\Users\USER\AppData\Local\Temp\opencode\mp-correcoes-p0-p3` (isolada, HEAD `69b642e`, alterações locais não commitadas) |
| Worktree original | `C:\Users\USER\.local\share\opencode\worktree\3033d4\mp-oauth-isolamento` — **intacta** |
| Commit / push | **Nenhum** |
| Deploy (qualquer ambiente) | **Nenhum** |
| Chamadas à API do Mercado Pago | **Nenhuma** |
| Preferência / checkout / pagamento / reembolso / webhook ao vivo | **Nenhum** |
| Alteração de Secrets, migrations, banco, RLS, variáveis de ambiente ou painel MP | **Nenhuma** |
| Valores de Secrets exibidos | **Nenhum** — somente nomes e hashes SHA-256 |

Foram autorizados e executados: correções P5/P6, mensagem cosmética, auditoria de código, testes
automatizados e verificações somente leitura. Tudo o mais permanece bloqueado até nova autorização.

---

## 1. Correções P5 e P6 realizadas

### 1.1 P5 — Notification URL com fail-fast

**Arquivos:** `supabase/functions/_shared/payments/urls.ts` e
`supabase/functions/_shared/payments/mercadopago.ts`.

- `urls.ts:39` — constante `MP_WEBHOOK_PATH` com o caminho exato
  `/functions/v1/webhooks-mercadopago`.
- `urls.ts:55-79` — `assertNotificationUrlForCurrentEnvironment()` recusa:
  - URL não absoluta ou HTTP (somente HTTPS);
  - caminho diferente da Edge Function (inclusive com sufixo extra);
  - query string, fragmento ou credenciais embutidas;
  - **qualquer URL cuja origem não seja exatamente o `SUPABASE_URL` do runtime** — é assim que uma
    URL de produção é impedida durante um teste Sandbox, sem literal de projeto no código.
- `urls.ts:81-85` — `validatedPaymentsWebhookUrl()` falha rápido (`EnvironmentConfigError`) se
  `SUPABASE_URL` estiver ausente.
- `mercadopago.ts:397-400` — `createPayment()` não usa mais `readEnv("SUPABASE_URL") ?? ""`;
  passa a chamar `validatedPaymentsWebhookUrl()` **antes** de montar a preferência.
- `mercadopago.ts:181-186` — `mpNotificationUrl()` continua como formatador puro (usado por
  testes); a validação agora vive no caminho real de criação.
- `mercadopago.ts:200-202` — `buildPreferenceBody()` recusa Notification URL vazia.

**Resultado:** com `SUPABASE_URL=https://ardpqimdllzbbdvwamkh.supabase.co`, a preferência recebe
`notification_url=https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago`.
Sem essa variável, nenhuma chamada `POST /checkout/preferences` chega a ser feita.

### 1.2 P6 — `x-signature` com múltiplos `v1`

**Arquivo:** `supabase/functions/_shared/payments/mercadopago.ts`.

- `mercadopago.ts:614-640` — o cabeçalho deixa de ser parseado num `Map` (último `v1` vencia).
  Todos os valores `v1` são coletados em lista; **nenhum sobrescreve o anterior**.
- `mercadopago.ts:40-48` — `webhookTimestampMs()` normaliza `ts` em **segundos (10 dígitos)** e
  **milissegundos (13 dígitos)** — as duas formas aparecem na documentação oficial.
- `mercadopago.ts:62-69` — `webhookManifest()` omite os pares ausentes, conforme a documentação.
- `mercadopago.ts:50-56` — `constantTimeEquals()` mantém a comparação em tempo constante.
- `mercadopago.ts:647-691` — cada `ts` dentro da janela de 10 min é combinado com **todos** os
  `v1`; a notificação é aceita se qualquer par casar. Não há `break`, para não vazar qual assinatura
  casou. Um `ts` antigo continua recusado mesmo com HMAC matematicamente correto (replay).
- O `eventId` continua derivado de `x-request-id`, preservando idempotência e a regra de que um
  evento inválido não queima a chave do evento legítimo.

**Observação documental:** a documentação oficial descreve a rotação de chave pelo botão
“Redefinir” do painel e **não exige explicitamente** múltiplos `v1`. A mudança é endurecimento
defensivo solicitado por você, mantendo HMAC + janela de frescor + idempotência.

### 1.3 Correção cosmética

- `mercadopago.ts:609` — a mensagem passou de `MP_WEBHOOK_SECRET não configurado.` para
  `MERCADOPAGO_WEBHOOK_SECRET não configurado.` (o fallback legado continua funcionando).
- `supabase/functions/webhooks-mercadopago/index.ts:4-5` — comentário atualizado.
- Duas asserções de testes existentes foram atualizadas para o nome canônico
  (`tests/payment-webhooks-mp.test.ts`, `tests/payment-providers.test.ts`). **Nenhum teste foi
  removido ou enfraquecido**; a finalidade de cada um permanece a mesma.

### 1.4 Diff desta etapa

| Arquivo | Alteração |
|---|---|
| `supabase/functions/_shared/payments/urls.ts` | validação P5 |
| `supabase/functions/_shared/payments/mercadopago.ts` | P5 + P6 + mensagem |
| `supabase/functions/webhooks-mercadopago/index.ts` | comentário cosmético |
| `tests/payment-correcoes-p5-p6.test.ts` | **novo** — 18 testes |
| `tests/payment-webhooks-mp.test.ts` | 1 asserção atualizada |
| `tests/payment-providers.test.ts` | 1 asserção atualizada |

---

## 2. Resultado dos testes

| Execução | Resultado | Classificação |
|---|---|---|
| `npm test` — suíte completa | **471 testes, 471 pass, 0 fail** | **APROVADO** |
| Suíte anterior preservada | **453 testes** (nenhum removido) + 18 novos | **APROVADO** |
| `node --test tests/payment-correcoes-p5-p6.test.ts` | **18/18** (P5: 7 · P6: 11) | **APROVADO** |
| Testes direcionados P0–P3 + webhook + idempotência + isolamento + checkout guard + providers + crypto + frete | **151/151** (execução anterior; segue verde na suíte completa) | **APROVADO** |
| `npx tsc --noEmit` | Não executável: TypeScript não está instalado no `node_modules` desta worktree (não é erro de código). Nenhuma dependência foi alterada | **NÃO TESTÁVEL** |
| Testes com rede, banco ou API MP | Não executados (sem autorização) | **PENDENTE** |

Cobertura nova: URL derivada do runtime; ausência de `SUPABASE_URL` sem chamada à API; URL de
produção recusada em Sandbox; caminho/HTTP/query/fragmento/credenciais recusados; `notification_url`
correta no corpo da preferência; `v1` válido no início e no fim da lista; todos `v1` inválidos;
`ts` em ms válido e antigo; rotação com dois `ts`; separador `:`; manifesto sem `x-request-id`;
idempotência preservada; nome canônico do Secret.

---

## 3. Estado do Checkout Pro

| Verificação | Evidência local | Classificação |
|---|---|---|
| Criação de preferência (`POST /checkout/preferences`, token do vendedor) | `mercadopago.ts:393-418` | **APROVADO** (código) / **PENDENTE** (runtime) |
| Identificação do vendedor | `accessToken` do vendedor na Preference; `externalAccountId` validado no OAuth | **APROVADO** (código) / **PENDENTE** (runtime) |
| Identificação do comprador | `buyerEmail` recebido no input; pagador conferido na API oficial no webhook | **APROVADO** (código) / **PENDENTE** (runtime) |
| Valor e moeda | `computeChargeSplit` recusa `itens+frete ≠ total`; `currencyDecimals` | **APROVADO** |
| External Reference | `external_reference = order.id` (teste dedicado) | **APROVADO** |
| URLs de retorno | `back_urls.success/pending/failure` com origem validada; `auto_return:"approved"` | **APROVADO** |
| Notification URL | fail-fast validado nesta etapa (P5) | **APROVADO** (código) / **PENDENTE** (deploy) |
| Redirecionamento para Checkout Pro | `sandbox_init_point` em Sandbox; `init_point` em produção | **APROVADO** (código) / **PENDENTE** (runtime) |
| Persistência do pedido | pedido gravado no backend com total/frete recalculados; transação espelhada | **APROVADO** (código) / **PENDENTE** (runtime) |
| Atualização automática do status | `payment_status` e `orders.status` atualizados só após confirmação via API oficial | **APROVADO** (código) / **PENDENTE** (runtime) |
| Status aprovado/pendente/recusado/cancelado | mapeamento completo em `mapMercadoPagoStatus` | **APROVADO** (código) / **PENDENTE** (runtime) |
| Prevenção de pagamento duplicado | transação ativa única + token de checkout de uso único + `blocksNewCharge` | **APROVADO** (código) / **PENDENTE** (runtime) |
| Reembolsos | `operation_id` + chave de idempotência persistidos; ledger monotônico; total oficial | **APROVADO** (código) / **PENDENTE** (runtime) |
| Consulta na API oficial | `GET /v1/payments/{id}` no webhook, no retorno e no refresh | **APROVADO** (código) / **PENDENTE** (runtime) |

> **Não consideramos o checkout aprovado apenas porque a preferência foi criada.** Após a criação o
> registro permanece `pending`; a confirmação depende de webhook válido + consulta oficial + gates
> de valor, moeda, pedido e vendedor.

---

## 4. Estado do OAuth dos vendedores

| Verificação | Evidência | Classificação |
|---|---|---|
| Autorização individual | `state` HMAC-SHA256 com `PAYMENT_STATE_SECRET`, expiração 15 min | **APROVADO** (código) |
| State + nonce | nonce gravado em `payment_oauth_states` no `connect`, consumido uma vez no callback | **APROVADO** (código) |
| Callback OAuth | exige `catalog.user_id === userId`; `redirect_uri` idêntico na idulação e na troca de código | **APROVADO** (código) |
| Tokens criptografados | AES-256-GCM `v1:iv:ct`; colunas criptografadas fora do SELECT do navegador | **APROVADO** (código) |
| Renovação dos tokens | refresh 5 min antes do vencimento; falha marca `expired`/`enabled=false` | **APROVADO** (código) |
| Separação entre contas | token por `catalog_id`/conexão; `loadCredentials` usa a conexão da transação | **APROVADO** (código) |
| Identificação correta do vendedor | `externalAccountId`/`merchantId` derivados de `/users/me` e do token | **APROVADO** (código) |
| Isolamento Sandbox/Produção | verificação de ambiente em connect, callback, checkout e `loadCredentials` | **APROVADO** (código) |
| Compatibilidade Sandbox | `MP_ENV=sandbox` confirmado por hash do Secret | **APROVADO** |
| Fluxo real de autorização com conta de teste | não executado | **PENDENTE** |
| Redirect URL cadastrada no app MP | sem acesso ao painel | **NÃO TESTÁVEL** |
| PKCE | desabilitado por decisão anterior; documentação diz ser recomendado, não obrigatório | **PENDENTE** (risco aceito) |

---

## 5. Estado dos Webhooks

| Verificação | Evidência | Classificação |
|---|---|---|
| URL de recebimento | derivada do runtime; conferida na Etapa 2 e agora validada no P5 | **APROVADO** (código) / **PENDENTE** (deploy) |
| Eventos `payment` e ordens comerciais | código trata `payment` e `merchant_order`; configuração externa não verificada | **APROVADO** (código) / **NÃO TESTÁVEL** (painel) |
| Assinatura digital / `x-signature` | HMAC-SHA256 do manifesto oficial, tempo constante, múltiplos `v1` (P6) | **APROVADO** (código) / **PENDENTE** (deploy) |
| `x-request-id` | usado no `eventId`; chave única `(provider, event_id)` | **APROVADO** |
| `MERCADOPAGO_WEBHOOK_SECRET` | Secret presente (hash conferido); nome canônico na leitura e na mensagem | **APROVADO** |
| Consulta na API oficial | `/v1/payments/{id}` ou `/v1/merchant_orders/{id}` antes de qualquer efeito | **APROVADO** (código) / **PENDENTE** (runtime) |
| Valor, moeda, pedido, vendedor | gates fail-closed com `external_reference` e `collector_id` da API oficial | **APROVADO** (código) / **PENDENTE** (runtime) |
| Idempotência / notificações repetidas | 200 `{duplicate:true}`; evento falho é reprocessado; inválido não queima a chave | **APROVADO** |
| Atualização do pedido | só após validação; reembolso como snapshot monotônico | **APROVADO** (código) / **PENDENTE** (runtime) |
| Resposta HTTP | 401 inválido, 200 duplicada/teste | **APROVADO** (lógica) / **PENDENTE** (runtime) |

**Funções remotas (consulta somente leitura, `--project-ref ardpqimdllzbbdvwamkh`):**
`payments`, `payments-callback`, `webhooks-mercadopago`, `webhooks-paypal` — todas `ACTIVE`, **v6**,
`verify_jwt=false`; `melhor-envio` e `melhor-envio-callback` permanecem v22.
**Consequência:** P5/P6 e a mensagem cosmética **não estão no ambiente**. Deploy adicional não foi
autorizado.

---

## 6. Split 1:1 — marketplace (evidências)

### 6.1 O que o código demonstra

- A Preference é criada com o `access_token` do vendedor (`mercadopago.ts:402-405`);
- nenhum `marketplace_fee` é enviado (`mercadopago.ts:230-245`);
- o webhook exige que o `collector_id` devolvido pela API oficial seja a conta da conexão da
  transação (`lifecycle.ts` + `webhooks.ts`);
- o `external_reference` conferido é o UUID do pedido.

Isso é **compatível** com o modelo oficial de marketplace 1:1, no qual cada vendedor recebe 100% da
própria venda e a plataforma não cobra comissão.

### 6.2 O que a documentação oficial exige

Fonte: https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/overview
https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace.md
https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/how-tos/integrate-marketplace.md

- “necessarily using an access token for each seller, obtained through OAuth”;
- “If it's Checkout Pro, fill the `marketplace_fee` parameter with the amount to be charged”;
  → **sem comissão, omitir o parâmetro está correto**; a omissão não é um “modo alternativo” nem um
  hack, é simplesmente 1:1 sem taxa.
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/prerequisites.md
  → vendedor com **KYC 6**; vendedores precisam autorizar via OAuth.
- https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration
  → app com modelo de integração **Marketplace**; código de autorização válido por 10 min;
  credenciais por 6 meses.

**Diferença importante:** Split **1:N** (vários vendedores na mesma ordem, `splits`/`receiver_id`) é
outro produto, do Checkout Transparente via Orders API, sujeito a contato comercial. **Não é o caso
desta integração** e não deve ser improvisado.

### 6.3 Classificação

| Item | Classificação |
|---|---|
| Arquitetura 1:1 com OAuth por vendedor e sem comissão | **APROVADO** (documentação + código) |
| Ausência de direcionamento para outra conta (gate `collector_id`) | **APROVADO** (código) / **PENDENTE** (runtime) |
| Evidência técnica da API Sandbox (`collector_id`, `external_reference`, valor, moeda) | **PENDENTE** — nenhuma API foi consultada; requisito do solicitante **não atendido** |
| App cadastrado no modelo Marketplace e vendedores com KYC 6 | **NÃO TESTÁVEL** (painel MP) |
| Resultado financeiro efetivo (100% na conta do vendedor) | **NÃO TESTÁVEL** sem pagamento Sandbox |

> **Não declaramos o Split aprovado.** A existência de código sem `marketplace_fee` não é evidência
> suficiente, conforme critério expresso do solicitante.

---

## 7. Pendências externas no painel do Mercado Pago (você precisa conferir)

Acesse **Suas integrações** → https://www.mercadopago.com.br/developers/panel/app → selecione o
**aplicativo de homologação** cujas credenciais estão no projeto `ardpqimdllzbbdvwamkh`.

1. **Redirect URL (OAuth):**
   `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/payments-callback`
2. **Webhooks → Configurar notificações:**
   URL: `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago`
3. **Eventos:** marque **Pagamentos** (`payment`, eventos no corpo com `type: "payment"`) e
   **Ordens comerciais** (`topic_merchant_order_wh`, evento no corpo com `type: "merchant_order"`).
   Atenção ao nome: no painel o evento se chama *Ordens comerciais* / `topic_merchant_order_wh`,
   não literalmente `merchant_order`. `payment` é o tópico primário do Checkout Pro Preferences;
   ordens comerciais é complementar.
4. **Modelo da aplicação:** confirmar **Marketplace** (não “Checkout Pro” simples) para o fluxo
   OAuth por vendedor.
5. **PKCE:** manter desabilitado enquanto P14 não for tratado.
6. **Chave do webhook:** usar a chave já existente (`MERCADOPAGO_WEBHOOK_SECRET` no Supabase).
   **Não criar outra** — se você usar “Redefinir”, o Secret no Supabase precisa ser atualizado
   (o que exigiria autorização específica).
7. Conforme a documentação, **pagamentos de teste não disparam notificações para a
   `notification_url`**; use o botão **Simular notificação** do painel para testar o webhook.

Nada disso foi alterado por mim.

---

## 8. Problemas encontrados e riscos restantes

Todos abaixo **permanecem** e não foram corrigidos nesta etapa (fora da autorização P5/P6/cosmético):

| ID | Severidade | Problema | Impacto |
|---|---|---|---|
| P4 | MÉDIO | `X-Idempotency-Key` da Preference é o UUID do pedido, não da tentativa | Após expiração/abandono, um retry pode receber a Preference antiga |
| P7 | BAIXO/MÉDIO | Isolamento entre lojas no webhook depende de `payload.user_id`; se ausente, a checagem é pulada | Parcialmente mitigado pelo gate de `collector_id` da API oficial |
| P8 | MÉDIO | Rate limit dos endpoints públicos fail-open e spoofable (IP vem de headers) | Permite volume artificial de requisições |
| P9 | BAIXO | AES-GCM sem AAD | Defesa em profundidade reduzida se ciphertext for copiado entre linhas |
| P10 | MÉDIO | Fallback de gravação anônima de pedidos depende da política `orders_anon_insert ... with check (true)` | Anônimo poderia inserir pedido em qualquer catálogo se a política estiver ativa |
| P11 | BAIXO | INSERT do nonce OAuth não é fatal no `connect` | Se falhar, callback termina em `state_already_used` |
| P12 | BAIXO | Parâmetro `error` do provedor logado cru | Ruído em logs; sem reflexão na UI |
| P13 | BAIXO | `safeReturnUrl` compara com `panelOrigin()` que pode conter path | Quebra `return_url` se `VITRINE_URL` tiver path (cai no fallback seguro) |
| P14 | BAIXO | PKCE desabilitado | Documentação recomenda; risco aceito anteriormente |
| P15/INFO | INFO | Webhook sem rate limit (linhas `invalid:` em `payment_events`); `paymentIdForLookup` prefere id salvo; `statement_descriptor` fixo BR | Riscos operacionais/escopo geográfico |
| RLS real | — | Não foi possível reconferir o estado do banco: não há link local e `supabase/config.toml` aponta para **produção**; `db query --linked` poderia acessar produção | **NÃO TESTÁVEL** por decisão de segurança |
| Deploy P5/P6 | CRÍTICO | Correções são locais; remoto segue v6 | até deploy autorizado, P5/P6 continuam presentes no ambiente |

**Nenhuma proteção foi enfraquecida para fazer testes passarem.** As duas asserções ajustadas foram
apenas a atualização do nome do Secret na mensagem.

---

## 9. Segurança e isolamento (reverificação)

| Item | Resultado | Classificação |
|---|---|---|
| Edge Functions públicas | `verify_jwt=false` apenas em `payments`, `payments-callback`, `webhooks-mercadopago`, `webhooks-paypal`; ações de dono validam JWT em código | **APROVADO** |
| Secrets | nomes e hashes conferidos: `MERCADOPAGO_WEBHOOK_SECRET`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_ENV=sandbox`, `PAYMENT_TOKEN_ENCRYPTION_KEY`, `PAYMENT_STATE_SECRET`, `SUPABASE_URL` e `VITRINE_URL` de homologação | **APROVADO** |
| Tokens individuais | criptografados, por conexão, nunca devolvidos ao navegador | **APROVADO** (código) |
| Isolamento Sandbox/Produção | URLs derivadas do runtime com fail-fast; nenhum literal de produção no código de pagamentos | **APROVADO** (código) |
| Logs sem dados sensíveis | erros da API MP redigidos (e-mail/documento, máx. 200 chars) | **APROVADO** |
| Exposição no frontend | `src/lib/payments.ts` usa apenas `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY`; service-role apenas no servidor | **APROVADO** |
| Proteção contra fraude | assinatura HMAC, janela de 10 min, idempotência, gates fail-closed | **APROVADO** (código) |
| RLS no banco remoto | verificação omitida para não risco de acessar produção | **NÃO TESTÁVEL** |

---

## 10. Procedimento para concluir os testes Sandbox (aguarda autorização)

**Nada abaixo foi executado.** Cada etapa depende de autorização expressa.

1. **Pré-requisito:** autorizar o **deploy** das correções P5/P6 em homologação. Sem isso, os testes
   validarão código antigo.
2. Conferir/painel MP os itens da seção 7 (Redirect URL, Webhook URL, eventos, modelo Marketplace).
3. Conectar uma **conta de vendedor de teste** em `/painel/pagamentos` (OAuth não cria cobrança).
   Confirmar `state`/nonce, `collector_id` retornado e ambiente Sandbox.
4. Criar pedido de teste no frontend de homologação e abrir o checkout. Antes da preferência,
   conferir: `notification_url` de homologação, `external_reference`, `back_urls`, valor/moeda.
5. Simular pagamentos com **cartões e contas oficiais de teste** (documentação:
   https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/integration-test/test-purchases
   e https://www.mercadopago.com.br/developers/pt/docs/your-integrations/test/cards):
   aprovado, pendente, recusado e cancelado.
6. Usar **Simular notificação** no painel MP para disparar o webhook; conferir assinatura,
   `x-request-id`, consulta à API oficial, gates e atualização automática do pedido.
7. Repetir a notificação para validar idempotência; enviar assinatura inválida para validar 401.
8. Consultar `GET /v1/payments/{id}` com o token do vendedor de teste e registrar (sem expor tokens):
   `collector_id`, `external_reference`, `transaction_amount`, `currency_id` e ausência de
   comissão — **é esta a evidência que falta para aprovar o Split 1:1**.
9. Reembolso somente se houver procedimento Sandbox seguro e autorização específica.
10. Ao final, atualizar `mercadopago-etapa3-testes-sandbox.md` com os resultados reais.

---

## 11. Preparação para produção (sem execução)

| Item | Necessário |
|---|---|
| Credenciais | novas `MP_CLIENT_ID`/`MP_CLIENT_SECRET` do app de produção; `MP_ENV=production` |
| Webhook | `MERCADOPAGO_WEBHOOK_SECRET` da configuração de webhook **de produção**; URL HTTPS definitiva; eventos Pagamentos + Ordens comerciais |
| OAuth de produção | Redirect URL definitiva; modelo Marketplace ativo; cada vendedor precisa **reautorizar** (tokens são por projeto, não são copiados) |
| URLs | `VITRINE_URL` definitiva; `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` do projeto de produção (auto-injetadas/injetadas pelo Supabase, nunca literais no código) |
| Functions | deploy de `payments`, `payments-callback`, `webhooks-mercadopago`, `webhooks-paypal` com `--project-ref wdcufpvlbisnqtvmbyso` **somente após autorização explícita** |
| Migration/segurança | conferir RLS, grants, política de pedidos anônimos e corrigir P4/P7/P8/P10 antes do go-live |
| Marketplace | vendedores com KYC 6; app com modelo Marketplace; sem `marketplace_fee` (sem comissão) |
| Verificações | repetir toda a suíte; executar compra de teste em produção com valor mínimo **somente se autorizado** |
| Go-live docs | https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-preferences/go-to-production |

**Plano de reversão:** como não há commit, **não reverta para o HEAD `69b642e`** — ele não contém
as correções P0–P3. Antes de qualquer deploy, salvar cópia do bundle v6 atualmente publicado (via
`supabase functions download` para diretório temporário) e do diff local; a reversão consiste em
republicar esse bundle salvo, nunca em apagar alterações.

---

## 12. Classificação consolidada

| Item | Classificação |
|---|---|
| Correção P5 (código + testes) | **APROVADO** |
| Correção P6 (código + testes) | **APROVADO** |
| Mensagem canônico do Secret | **APROVADO** |
| Suíte automatizada (471/471; 453 preservados) | **APROVADO** |
| Checkout Pro — código | **APROVADO** |
| Checkout Pro — execução real | **PENDENTE** |
| OAuth — código (state, nonce, crypto, refresh, isolamento) | **APROVADO** |
| OAuth — fluxo real com conta de teste | **PENDENTE** |
| Redirect URL no painel MP | **NÃO TESTÁVEL** |
| Webhooks — código (inclusive P6) | **APROVADO** |
| Webhooks — runtime e notificação real | **PENDENTE** |
| Eventos cadastrados no painel MP | **NÃO TESTÁVEL** |
| Split 1:1 — arquitetura/documentação | **APROVADO** |
| Split 1:1 — evidência da API Sandbox | **PENDENTE** |
| Split 1:1 — credenciamento/KYC/modelo Marketplace | **NÃO TESTÁVEL** |
| Segurança/isolamento em código | **APROVADO** |
| RLS no banco remoto | **NÃO TESTÁVEL** |
| P4, P7, P8, P9, P10, P11, P12, P13, P14, P15 | **PENDENTE** (não autorizados) |
| Deploy das correções em homologação | **PENDENTE** (não autorizado) |
| Deploy/tests em produção | **PENDENTE** (não autorizado) |
| **Liberação comercial** | **REPROVADO** — há pendências críticas e validações financeiras sem evidência |

---

## 13. Veredito final

A parte autorizada desta etapa está **concluída**: P5, P6 e a mensagem cosmética foram corrigidos,
com 18 novos testes e suíte completa em **471/471**. A arquitetura de Checkout Pro, OAuth e
webhooks está tecnicamente coerente com a documentação oficial e não foi enfraquecida.

**Não declare a integração pronta para produção.** A liberação comercial continua bloqueada por:

1. correções P5/P6 ainda não deployadas (ambiente segue v6);
2. nenhuma preferência/checkout/pagamento/webhook real testado em Sandbox;
3. nenhuma evidência de API Sandbox para o Split 1:1 (`collector_id`, `external_reference`);
4. configuração externa do app MP (Redirect URL, Webhook URL, eventos, modelo Marketplace) não
   verificada;
5. pendências P4/P7/P8/P10 e a dúvida sobre a política `orders_anon_insert`;
6. RLS remota não reconferida por restrição de segurança;
7. deploy de produção e credenciais reais fora de escopo.

**PARADO, aguardando sua autorização expressa** para deploy homologação e, posteriormente, testes
financeiros em Sandbox. Produção não foi iniciada.
