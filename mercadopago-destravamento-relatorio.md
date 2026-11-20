# Mercado Pago Vitrine Criativa — relatório de destravamento

**Data:** 20/11/2026
**Ambiente:** homologação — Supabase `ardpqimdllzbbdvwamkh`, worker `https://vitrine-homolog.meellcriativa.workers.dev`
**Produção (`wdcufpvlbisnqtvmbyso`):** NÃO acessada, consultada, modificada, implantada nem testada.
**Comandos remotos:** todos com `--project-ref ardpqimdllzbbdvwamkh` ou com `--linked` no diretório cujo `project-ref` é `ardpqimdllzbbdvwamkh`.
**Publicação:** nenhum commit, nenhum push, nenhum deploy, nenhuma alteração de Secret.
**Resultado:** **HOMOLOGAÇÃO AINDA NÃO APROVADA**. Os bloqueios externos continuam impedindo a comprovação financeira ponta a ponta.

---

## 1. Preservação do estado anterior

Antes de qualquer ação, o relatório `mercadopago-homologacao-final.md` foi lido integralmente e o repositório foi inspecionado.

| Verificação | Resultado |
|---|---|
| HEAD | `69b642e` — inalterado |
| Correções P0–P15 presentes | **APROVADO** — 14 arquivos modificados + arquivos novos de testes/helpers preservados |
| Correção TDZ de `orderId` preservada | **APROVADO** — `payments/index.ts` usa `orderId` na chave de idempotência |
| Working tree | Suja, exatamente como no relatório anterior; nada foi revertido ou sobrescrito |
| Suíte anterior | **APROVADO** — 490 testes continuam passando |
| PayPal | Não modificado nesta etapa |
| Migrações/RLS/Secrets | Não executados, não alterados |

Nenhuma tarefa já concluída foi refeita.

---

## 2. Bloqueios resolvidos nesta etapa

### 2.1 Correção TDZ do checkout — **APROVADO localmente / PENDENTE em homologação**

A correção anterior foi revisada e confirmada:

```ts
// supabase/functions/payments/index.ts (createPaymentAction)
const orderId = String(ctx.body.order_id ?? "").trim();
// ...
const attemptDigest = await sha256Hex(
  `${orderId}|${provider}|${providerEnvironment(provider)}|${token}`,
);
 // ...
const order = orderData as { /* ... */ }; // declarado depois
```

- `orderId` é validado antes do uso;
- nenhuma referência a `order.` aparece antes da declaração de `order`;
- o escopo e o ciclo de vida da chave permanecem estáveis por tentativa de checkout;
- o teste `tests/payment-homologacao-final.test.ts` falharia se a variável voltasse a ser usada antes da declaração.

**Situação do runtime:** a correção **não está publicada**. O deploy da função `payments` depende de autorização explícita. A tentativa anterior de baixar o bundle publicado falhou com `UnsafeFunctionDownloadPathError` na CLI, portanto não é possível afirmar que o v8 publicado contém ou não o defeito — mas o código publicado não pode conter a correção local feita depois daquele deploy.

### 2.2 Endpoint de checkout em homologação — **APROVADO (sonda somente leitura)**

```
GET /functions/v1/payments?action=methods&slug=vitrine-homolog-4aa6cdba
→ 200 {"success":true,"catalog_id":"...","currency":"BRL","methods":[]}
```

O endpoint está vivo, responde e retorna `methods: []`, coerente com `payment_connections = 0`. A resposta 404 vista antes para `action=methods` ocorreu sem `slug`/`catalog_id`; não é um defeito do runtime.

### 2.3 Callback OAuth em homologação — **APROVADO (sonda com state inválido)**

```
GET /functions/v1/payments-callback?state=invalid&provider=mercadopago
→ 302 Location: https://vitrine-homolog.meellcriativa.workers.dev/painel/pagamentos?provider=mercadopago&connected=0&error=invalid_state
```

Isso confirma:

- a função está publicada e ativa;
- um `state` inválido é recusado antes de consumir nonce ou gravar conexão;
- o redirecionamento aponta para o painel de **homologação**, sem misturar com produção;
- nenhuma linha foi criada em `payment_connections` ou `payment_oauth_states`.

### 2.4 Validação de assinatura do webhook em homologação — **APROVADO (sonda com assinatura ausente)**

```
POST /functions/v1/webhooks-mercadopago
{"type":"payment","data":{"id":"000000000"}}
→ 401
```

A função rejeitou a notificação sem assinatura. Como efeito colateral da sonda, **1 linha sintética de auditoria** foi registrada em `payment_events` (`provider_event_id = invalid:payment:000000000:notification`, `signature_valid = false`, `processed = false`, erro `Assinatura ausente.`). A linha **não foi excluída** para preservar o histórico; ela não é transação financeira, não alterou `orders` nem `payment_transactions`.

### 2.5 Procedimento de publicação preparado — **APROVADO (não executado)**

O comando exato, seguro e exclusivo para homologação é:

```powershell
supabase functions deploy payments payments-callback webhooks-mercadopago --project-ref ardpqimdllzbbdvwamkh --use-api --no-verify-jwt --workdir 'C:\Users\USER\AppData\Local\Temp\opencode\mp-correcoes-p0-p3'
```

Regras obrigatórias:

- **não omitir** `--project-ref ardpqimdllzbbdvwamkh`;
- **não usar** `--prune` (evita excluir funções existentes);
- **não usar** `supabase link` nem `supabase functions deploy` sem `--project-ref`; o `config.toml` local aponta para produção;
- **não incluir** `webhooks-paypal` nesta etapa; PayPal está fora do escopo;
- `--use-api` é necessário porque o Docker não está disponível neste ambiente;
- `--no-verify-jwt` preserva a configuração atual das funções públicas/de callback/webhook;
- antes de executar: rodar `npm test` e `git diff --check`;
- depois de executar: conferir `supabase functions list --project-ref ardpqimdllzbbdvwamkh`, repetir as sondas de `methods`, callback e webhook e confirmar que o contador de versão das funções subiu.

**Não executado.** Aguardando autorização específica.

---

## 3. Estado do OAuth (P1) — **PENDENTE**

### 3.1 Por que `payment_connections = 0` e `payment_oauth_states = 0`

O código grava em `payment_oauth_states` no início da ação `connect` (owner autenticado) e só grava em `payment_connections` depois que o callback valida `state`, troca o código por token, verifica a conta e criptografa as credenciais. As contagens atuais, conferidas antes e depois das sondas, permanecem:

| Tabela | Contagem |
|---|---:|
| `payment_connections` | 0 |
| `payment_oauth_states` | 0 |
| `payment_transactions` | 0 |
| `payment_refunds` | 0 |
| `payment_events` | 1 (linha sintética da sonda de assinatura inválida) |
| `orders` | 2 |

Não há evidência de que uma tentativa de conexão tenha chegado ao callback. Não há base para atribuir isso a defeito de código: a ação `connect` é owner-only, exige sessão do painel e seleção de catálogo, e nenhuma autorização de vendedor foi executada.

### 3.2 Código revisado

| Etapa | Evidência no código | Classificação da implementação |
|---|---|---|
| URL de autorização | `mercadopago.ts:294-305`: `auth.mercadopago.com.br/authorization?client_id=...&response_type=code&platform_id=mp&state=...&redirect_uri=...&site_id=MLB` | Compatível com a documentação oficial. PKCE não implementado; a documentação diz que é opcional e só obrigatório se habilitado no aplicativo |
| State | `payments/index.ts:715-735`: HMAC + expiração de 15 min + nonce em `payment_oauth_states` | **APROVADO** em código/testes |
| Callback | `payments-callback/index.ts`: valida assinatura, ambiente, posse do catálogo, nonce de uso único, erro do provedor, configuração de criptografia e provedor | **APROVADO** em código/testes |
| Troca de código | `mercadopago.ts:308-350`: `POST /oauth/token` com `grant_type=authorization_code`, mesmo `redirect_uri`, depois `/users/me` | **APROVADO** em código; não executado com code real |
| Persistência | `db.ts:127-174`: tokens criptografados (AES-GCM), `connected` derivado do status, `enabled=false` até o vendedor habilitar | **APROVADO** em código/testes |
| Identificação do vendedor | `user_id` da resposta OAuth e `/users/me` viram `external_account_id`/`merchantId`; a documentação oficial confirma que `user_id` é o `collector_id` de pagamento | **APROVADO** em código; não validado em runtime |
| Renovação | `mercadopago.ts:352-376`: `grant_type=refresh_token`, chamada automática em `connections.ts` | **APROVADO** em código/testes; renovação real não executada |
| Revogação | `revoke()` no provedor é intencionalmente no-op: a API MP documenta revogação por autorização do vendedor, troca de senha, limpeza de sessão ou exclusão do app — não uma chamada programática genérica. O botão “Desconectar” apaga os tokens locais | **PENDENTE** de validação real; comportamento documentado, não simulado |

**Classificação P1: PENDENTE.** Não se deve afirmar OAuth aprovado sem `payment_connections ≥ 1` e `collector_id` real.

---

## 4. Painel do Mercado Pago (P7) — **NÃO TESTÁVEL**

A URL oficial `https://www.mercadopago.com.br/developers/panel/app` redirecionou para `https://www.mercadopago.com.br/login/identification...` nesta data. Não houve tentativa de burlar autenticação nem de usar conta de terceiros.

### 4.1 Configurações que precisam ser conferidas manualmente

| # | Página / opção | O que cadastrar ou conferir | Resultado esperado |
|---|---|---|---|
| 1 | `https://www.mercadopago.com.br/developers/panel/app` → selecionar a aplicação usada por `MP_CLIENT_ID` | Tipo da aplicação: **Pagamentos online** + modelo **Marketplace**, produto **Checkout Pro**. Se não for Marketplace, criar/ajustar aplicação | Aplicação exibida com modelo Marketplace; a documentação oficial exige Marketplace para Split 1:1 |
| 2 | Detalhes da aplicação → **Editar** / Redirect URL | `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/payments-callback` | URL salva exatamente, sem barra extra, sem parâmetros e sem domínio de produção |
| 3 | Menu lateral → **Webhooks > Configurar notificações** → ambiente **Teste** | URL: `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago`; eventos **Pagamentos** (`payment`) e **Ordens comerciais** (`merchant_order` / `topic_merchant_order_wh`) | Salvar gera/exibe a assinatura secreta. Se ela for renovada, o novo valor precisa ser atualizado no Secret `MERCADOPAGO_WEBHOOK_SECRET` de homologação; sem isso o webhook passa a rejeitar notificações reais |
| 4 | **Credenciais** → ambiente **Teste** | Conferir Public Key / Access Token de teste (`APP_USR`), sem expor valores. Credenciais de produção não devem ser usadas em homologação | Seletor “Teste” ativo; `MP_ENV` do projeto é sandbox |
| 5 | **Contas de teste** | Criar contas **Vendedor** e **Comprador** do mesmo país (MLB); em Marketplace, opcionalmente **Integrador** | Lista com User ID, usuário, senha e código de verificação de 6 dígitos |
| 6 | **Início > Webhooks** (após simular) | Abrir aba Teste, conferir entrega/status da notificação simulada | Status entregue, corpo com `data.id`, `type`, `application_id`, `live_mode=false` |

Nada foi presumido como já configurado. Os valores brutos de `MP_CLIENT_ID`, `MP_CLIENT_SECRET` e demais Secrets não foram lidos nem exibidos; a CLI listou apenas nomes e hashes.

---

## 5. Conta de vendedor de teste (P1/P3) — **NÃO TESTÁVEL**

Procedimento oficial, extraído da documentação Mercado Pago Developers:

1. Acessar **Integrações** → aplicação → **Contas de teste** (também em Início > Recursos > Contas de teste ou Credenciais > Conta de teste > Gerenciar contas de teste).
2. Clicar em **Criar conta de teste**.
3. Selecionar país de operação — **MLB (Brasil)**. O país não pode ser alterado depois.
4. Informar uma descrição identificável, por exemplo `Vendedor Homologacao Vitrine`.
5. Selecionar tipo **Vendedor**. Criar também um **Comprador** do mesmo país; para Marketplace, um **Integrador** é opcional.
6. Informar saldo fictício se solicitado; aceitar Declaração de Privacidade e Termos e Condições; clicar em **Criar conta de teste**.
7. Em Credenciais > Teste > Conta de teste, copiar **User ID**, **Usuário de teste**, **Senha** e **Código de verificação** (usado se houver verificação adicional no login).

Também existe a API oficial `POST https://api.mercadopago.com/users/test` com `site_id`/`description` e um Access Token obtido no painel. **Não foi executada**: exigiria credencialreal do painel, que não foi fornecida. O limite é de 15 contas de teste simultâneas e, segundo a documentação, não é possível excluí-las.

Restrições aplicáveis: vendedor e comprador do mesmo país; contas de teste pertencem à aplicação; o vendedor precisa ter KYC nível 6 em produção — em Sandbox segue-se o fluxo de teste da aplicação. Nenhuma conta foi criada com dados de pessoa real.

**Classificação: NÃO TESTÁVEL** sem login no painel.

---

## 6. Checkout, pagamento e liquidação (P2/P3/P4) — **PENDENTE / NÃO TESTÁVEL**

### 6.1 Checkout

- Código: a preferência é criada com `credentials.accessToken` carregado de `payment_connections` (`loadCredentials(catalog.id, provider)`), nunca com `client_credentials` da aplicação.
- Corpo da preferência (teste local): sem `marketplace_fee`, com `external_reference`, `notification_url` de homologação, `back_urls`, `auto_return`, `statement_descriptor`, `metadata.order_id` e `metadata.catalog_id`.
- Uma preferência Sandbox real da etapa anterior trouxe `marketplace_fee: 0` e `external_reference` do pedido de teste — isso prova configuração da preferência, não liquidação.
- O checkout real não pôde ser exercitado: não há vendedor conectado, e a correção TDZ não está publicada.

**Classificação P2: PENDENTE** (com defeito local corrigido, mas ausente no runtime).

### 6.2 Pagamento Sandbox

- Não há conexão OAuth, logo não há token de vendedor para criar pagamento.
- Evidência anterior: `client_credentials` da aplicação foi recusado pela API Mercado Pago com `403` — reforçando que ele não substitui o token do vendedor.
- Cartões oficiais de teste documentados: Visa `4235 6477 2802 5682` (aprovado com titular `APRO`, CPF `12345678909`), CVV `123`, validade `11/30`; cenários `OTHE` (recusado), `CONT` (pendente) etc. Nenhum cartão real foi usado.

**Classificação P3: PENDENTE.**

### 6.3 Split 1:1 e recebimento direto

O que já está demonstrado:

- documento oficial: a resposta OAuth contém `user_id`, igual ao `collector_id` usado para capturar pagamentos;
- o código usa token por vendedor e não envia comissão;
- o webhook exige que `collector_id`/`sellerAccountId` da API oficial corresponda à conta da conexão (`webhooks.ts:179-188`), com fail-closed;
- preferência real anterior retornou `marketplace_fee: 0`.

O que **ainda não** foi demonstrado:

- `GET /v1/payments/{id}` com token do vendedor mostrando `collector_id`, `external_reference`, `transaction_amount`, `currency_id`, `status` e ausência de comissão;
- pagamento aprovado em Sandbox e sua liquidação;
- que a Vitrine Criativa não recebe valores para repasse manual. Isso é intenção de arquitetura, não evidência financeira.

**Classificação P4: NÃO TESTÁVEL.** Não se deve classificar como APROVADO apenas com `marketplace_fee=0`.

---

## 7. Webhooks reais (P5) — **PENDENTE**

- Runtime: endpoint ativo e rejeitou sonda sem assinatura com `401`, registrando 1 linha sintética de auditoria.
- Testes sintéticos anteriores: assinatura inválida → 401; assinatura válida → 200/duplicata; replay → 401; idempotência e conciliação aprovadas.
- Notificação **real** do Mercado Pago: nenhuma recebida. A documentação oficial indica que pagamentos de teste não enviam `notification_url`; é necessário usar **Simular notificação** no painel da aplicação.
- Eventos necessários: `payment` e `merchant_order` (nomes no painel: **Pagamentos** e **Ordens comerciais**). O tópico opcional `mp-connect` pode avisar sobre autorização/desautorização OAuth, mas não foi configurado/verificado.

**Classificação P5: PENDENTE.**

---

## 8. Reembolsos (P6) — **NÃO TESTÁVEL**

Não existe pagamento Sandbox aprovado para estornar; `payment_refunds = 0`. A estrutura de ledger, idempotência por operação e reconciliação existe em código e testes, mas nenhuma operação real foi executada.

**Classificação P6: NÃO TESTÁVEL.**

---

## 9. Segurança e isolamento — **APROVADO**

| Item | Evidência |
|---|---|
| Project ref | Todas as consultas remotas usaram `ardpqimdllzbbdvwamkh` ou o diretório linkado a ele; produção não foi consultada |
| Secrets | Listados por nome/hash; valores brutos não exibidos; nenhum `secrets set` executado |
| RLS | `orders`, `payment_connections`, `payment_oauth_states`, `payment_refunds`, `payment_transactions`, `payment_events` com `rowsecurity = true`; políticas owner-only/authenticated; nenhuma política anônima de INSERT em `orders` em homologação |
| Dados | Nenhum dado financeiro existente foi excluído; nenhuma migração executada; nenhuma ordem criada ou alterada nesta etapa |
| Credenciais | Nenhum `client_credentials` usado como substituto do vendedor; nenhuma credencial inventada; nenhuma autorização simulada |
| Cobranças | Nenhuma cobrança real; nenhum cartão real |
| PayPal | Intacto |
| Funções temporárias | Nenhuma criada nesta etapa |
| Commit/push/deploy | Nenhum executado |

---

## 10. Testes executados nesta etapa

| Comando / verificação | Resultado |
|---|---|
| `npm test` | **490 testes, 490 aprovados, 0 falhas** |
| `node --test tests/payment-homologacao-final.test.ts` | **4 testes, 4 aprovados, 0 falhas** |
| `git diff --check` | Limpo |
| `supabase functions list --project-ref ardpqimdllzbbdvwamkh` | 6 funções ativas; MP: `payments`, `payments-callback`, `webhooks-mercadopago`, `webhooks-paypal` v8; `melhor-envio*` v22; todas `verify_jwt=false` |
| `supabase secrets list --project-ref ardpqimdllzbbdvwamkh` | Nomes/hashes conferidos; sem valores brutos |
| Consultas SQL somente leitura | Contagens e RLS conferidas antes e depois das sondas |
| Sonda `payments?action=methods&slug=...` | HTTP 200, `methods: []` |
| Sonda `payments-callback?state=invalid` | HTTP 302 para painel de homologação com `connected=0&error=invalid_state` |
| Sonda `webhooks-mercadopago` sem assinatura | HTTP 401; 1 linha de auditoria sintética registrada e preservada |
| Acesso ao painel do desenvolvedor MP | Redirecionou para login; nenhuma configuração confirmada |

---

## 11. Classificação consolidada

| Req. | Item | Classificação | Motivo |
|---|---|---|---|
| — | Preservação P0–P15 + TDZ local + 490 testes | **APROVADO** | Nada revertido; suíte verde |
| TDZ | Correção no código local | **APROVADO** | `orderId` declarado e usado antes de `order`; teste de regressão |
| TDZ | Correção publicada em homologação | **PENDENTE** | Deploy não autorizado |
| P1 | OAuth real do vendedor | **PENDENTE** | Sem conta conectada; painel exige login; callbacks e persistência não exercitados |
| P1 | Renovação/revogação documentadas em código | **APROVADO (código)** / **PENDENTE (runtime)** | Refresh implementado; revogação remota é feita pelo vendedor/MP, não por chamada da plataforma |
| P2 | Checkout com token OAuth do vendedor | **PENDENTE** | Sem vendedor conectado; runtime ainda sem a correção TDZ |
| P3 | Pagamento Sandbox | **PENDENTE** | Nenhum pagamento executado; `client_credentials` recusado anteriormente |
| P4 | Split 1:1 / recebimento direto | **NÃO TESTÁVEL** | Configuração compatível; sem liquidação real nem `GET /v1/payments/{id}` |
| P5 | Webhooks reais | **PENDENTE** | Endpoint valida assinatura, mas nenhuma notificação real/simulada do MP |
| P6 | Reembolso Sandbox | **NÃO TESTÁVEL** | Sem pagamento aprovado |
| P7 | Configuração do painel MP | **NÃO TESTÁVEL** | Login obrigatório; nada presumido |
| — | Isolamento/segurança/RLS | **APROVADO** | Conforme seção 9 |
| — | Procedimento de deploy preparado | **APROVADO** | Comando exato na seção 2.5; não executado |

---

## 12. Próximas ações manuais necessárias (nesta ordem)

1. **Autorizar o deploy** da correção TDZ e, preferencialmente, das três funções MP em homologação com o comando da seção 2.5. Sem isso, o checkout permanece quebrado.
2. **Fazer login no painel do Mercado Pago** com a conta integradora autorizada e executar os itens 1–3 da seção 4. Conferir especialmente Redirect URI e eventos de webhook no ambiente **Teste**.
3. **Criar contas de teste Vendedor e Comprador (MLB)** conforme seção 5; guardar User ID, usuário, senha e código de verificação sem compartilhar em canais inseguros.
4. No painel de homologação da Vitrine, como dono de um catálogo, abrir `/painel/pagamentos` e clicar em **Conectar** no Mercado Pago; fazer login com a conta **Vendedor de teste** e aprovar. Resultado esperado: `connected=1`, `payment_connections ≥ 1`, `payment_oauth_states ≥ 1`, `external_account_id` igual ao `user_id`/`collector_id` da conta de teste.
5. Habilitar o método no painel da loja e conferir aviso de moeda/capacidades.
6. Criar pedido de teste → preferência com token do vendedor → pagamento com cartão oficial aprovado → consultar `GET /v1/payments/{id}` com o token do vendedor e registrar `collector_id`, `external_reference`, valor, moeda, `status` e ausência de comissão.
7. Usar **Simular notificação** no painel MP para `payment` e `merchant_order`; confirmar idempotência, replay e atualização do pedido.
8. Executar reembolso total/parcial Sandbox e conferir reconciliação.
9. Somente com todas as evidências acima, avaliar promoção em etapa separada e explicitamente autorizada.

---

## 13. Fontes oficiais consultadas

- OAuth — Obter Access Token: https://www.mercadopago.com.br/developers/pt/docs/security/oauth/creation
- OAuth — Gerenciar Access Token: https://www.mercadopago.com.br/developers/pt/docs/security/oauth/management
- Split 1:1 — Criar configuração: https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/create-configuration
- Split 1:1 — Integrar o checkout em marketplace: https://www.mercadopago.com.br/developers/pt/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace
- Contas de teste: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/test/accounts
- API — Criar usuário de teste: https://www.mercadopago.com.br/developers/pt/reference/test_user/_users_test/post
- Cartões de teste: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/test/cards
- Checkout Pro — Webhooks: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/additional-content/notifications/webhooks
- Painel do desenvolvedor: https://www.mercadopago.com.br/developers/panel/app

---

## 14. Encerramento

- Não foi criada nova etapa artificial.
- A integração **não está aprovada** apenas porque os testes automatizados passaram.
- Produção não foi autorizada nem tocada.
- Nenhum commit, push ou deploy foi realizado.
- O bloqueio fundamental permanece externo: acesso ao painel do Mercado Pago e uma conta de vendedor de teste autorizável, mais a autorização de deploy da correção TDZ.

**Aguardando avaliação.**
