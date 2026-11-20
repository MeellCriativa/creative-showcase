# Auditoria Mercado Pago — Vitrine Criativa (somente leitura)

**Data:** 20/11/2026
**Projeto obrigatório confirmado:** `ardpqimdllzbbdvwamkh` — `vitrine-criativa-homolog` (`us-east-1`, `ACTIVE_HEALTHY`)
**Escopo:** somente leitura. Nenhum arquivo de código, Secret, banco, política RLS, configuração, deploy ou operação financeira foi alterado. O único arquivo criado nesta etapa é este relatório.

> **Nota sobre o worktree:** já existiam alterações da etapa anterior de isolamento (`payments/index.ts`, `payments-callback/index.ts`, `_shared/payments/urls.ts`, `tests/payment-env-isolation.test.ts`). Elas são pré-existentes a esta auditoria e **não** foram tocadas aqui.

---

## 1. Status dos quatro Secrets solicitados

A CLI do Supabase devolve valores como hash SHA-256; a verificação foi feita por **presença de nome** e, quando necessário, por **comparação de hash**, sem exibir valores.

| Secret solicitado | Status no projeto | Utilização real pelo código | Conclusão |
|---|---|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | **AUSENTE** | Nenhuma referência no repositório. O código usa tokens **individuais por vendedor**, obtidos via OAuth e guardados criptografados em `payment_connections.access_token_enc`. | **Correto/esperado.** Não existe token de acesso global da plataforma; criá-lo seria anti-padrão e risco de confusão com o token do vendedor. |
| `MERCADOPAGO_PUBLIC_KEY` | **AUSENTE** | Nenhuma referência. O checkout é por redirecionamento (Preference), sem SDK `MP.js` no frontend. | **Correto/esperado.** Public key só seria necessária com SDK de cartão no browser. |
| `MERCADOPAGO_CLIENT_SECRET` | **AUSENTE** | O código lê **`MP_CLIENT_SECRET`** (`_shared/payments/mercadopago.ts:67`) — este está **presente**. | **Nome incorreto.** O segredo da plataforma existe, porém sob outro nome. Não criar um novo. |
| `MERCADOPAGO_WEBHOOK_SECRET` | **PRESENTE** (`updated_at=2026-11-20T03:45:14Z`) | **Nenhuma referência no código.** O código lê **`MP_WEBHOOK_SECRET`** (`mercadopago.ts:67`), que está **AUSENTE**. | **BLOQUEADOR CRÍTICO.** O segredo correto foi criado sob nome que a aplicação não consome; toda notificação será recusada com `401 "MP_WEBHOOK_SECRET não configurado."` |

### Nomes realmente consumidos (estado atual)

| Nome usado pelo código | Presença | Observação |
|---|---|---|
| `MP_CLIENT_ID` | Presente | App OAuth da plataforma |
| `MP_CLIENT_SECRET` | Presente | Troca de código/refresh — **não confundir** com token de vendedor |
| `MP_WEBHOOK_SECRET` | **Ausente** | Necessário para validar `x-signature` |
| `MP_ENV` | Presente | Valor confirmado por hash: **`sandbox`** (`updated_at=2026-11-20T03:40:45Z`) |
| `PAYMENT_TOKEN_ENCRYPTION_KEY` | Presente | AES-256-GCM dos tokens dos vendedores |
| `PAYMENT_STATE_SECRET` | Presente | HMAC do `state` OAuth |
| `SUPABASE_URL` / `VITRINE_URL` | Presentes | URLs derivadas por ambiente, sem fallback cross-env |

**Funções deployadas no projeto:** `payments`, `payments-callback`, `webhooks-mercadopago` — todas `ACTIVE`, `verify_jwt=false`, versão `v5` (a versão observada no início desta etapa era `v3`; houve deploy externo entre verificações — apenas registrado, não executado por esta auditoria).

---

## 2. Arquivos e funções responsáveis pela integração

| Área | Arquivo / função |
|---|---|
| Config MP, OAuth, Preference, status, assinatura | `supabase/functions/_shared/payments/mercadopago.ts` — `config()`, `mpEnvironment()`, `buildAuthorizeUrl()`, `completeAuthorization()`, `refreshCredentials()`, `buildPreferenceBody()`, `createPayment()`, `mapMercadoPagoStatus()`, `verifyWebhook()`, `mpNotificationUrl()` |
| Router público/dono | `supabase/functions/payments/index.ts` — `create_payment`, `create_order`, `payment_status`, `connect`, `verify`, `disconnect`, `set_enabled`, `safeReturnUrl()` |
| Retorno OAuth | `supabase/functions/payments-callback/index.ts` — `redirect()`, `redirectError()` |
| Webhook | `supabase/functions/webhooks-mercadopago/index.ts`; `_shared/payments/webhooks.ts` — `handleWebhook()`, `applyOfficialSnapshot()` |
| Derivação de URLs/isolamento | `_shared/payments/urls.ts` — `supabaseBaseUrl()`, `paymentsCallbackUrl()`, `paymentsWebhookUrl()`, `panelOrigin()` |
| Criptografia/state | `_shared/payments/crypto.ts` — `encryptSecret()`, `decryptSecret()`, `signState()`, `verifyState()`, `maskEmail()` |
| Persistência/autorização | `_shared/payments/db.ts`, `connections.ts`, `orders.ts`, `lifecycle.ts`, `resolution.ts`, `ratelimit.ts`, `money.ts` |
| Banco/RLS | `supabase/migrations/20261115090000_add_payment_providers.sql`; `20261116090000_payment_integrity_fixes.sql`; `20261119130000_payment_data_minimization.sql`; `supabase/fixes/20261118_restore_orders_anon_insert.sql` |
| Frontend | `src/routes/painel.pagamentos.tsx`; `src/routes/c.$slug.tsx`; `src/lib/payments.ts` |
| Testes | `tests/payment-webhooks-mp.test.ts`, `payment-mp-shipping.test.ts`, `payment-idempotency.test.ts`, `payment-isolation.test.ts`, `payment-checkout-guard.test.ts`, `payment-crypto.test.ts`, `payment-providers.test.ts`, `payment-env-isolation.test.ts` |

---

## 3. Problemas encontrados

### P0 — CRÍTICO: `resolveMpPaymentId` fora de escopo quebra `refresh_payment`

- **Arquivo/função:** `supabase/functions/payments/index.ts:533` (`paymentStatusAction`), `:559` (declaração aninhada), `:601` (uso válido) e `:1084`/`:1109` (`refreshPaymentAction`).
- **Evidência:** `async function resolveMpPaymentId(...)` está declarada **dentro** de `paymentStatusAction` (recuo de 2 espaços, linha 559). A busca textual no repositório encontra exatamente 3 ocorrências: a declaração na linha 559, o uso na linha 601 (mesmo escopo, correto) e a chamada na linha 1109, dentro de `refreshPaymentAction` — função de nível superior distinta, iniciada na linha 1084:
  ```ts
  // linha 1108-1109 (refreshPaymentAction)
  if (provider === "mercadopago" && !transaction.provider_payment_id) {
    paymentId = (await resolveMpPaymentId(transaction, loaded.credentials)) ?? paymentId;
  }
  ```
- **Impacto:** erro de compilação TypeScript (`Cannot find name 'resolveMpPaymentId'`) ou `ReferenceError` em runtime no caminho de atualização/refresh do vendedor, sempre que `provider === "mercadopago"` e `transaction.provider_payment_id` estiver vazio (caso típico: Preference criada, webhook ainda não chegou). A ação `refresh_payment` fica inutilizável nesse cenário.
- **Precedência:** o mesmo defeito existe no código commitado em `HEAD` (`git show HEAD:...`: declaração aninhada na linha 554, chamada fora de escopo na linha 1104). Portanto **não** foi introduzido pelas alterações não commitadas da etapa de isolamento e muito provavelmente já está na versão deployada `v5`.
- **Correção recomendada:** elevar `resolveMpPaymentId` ao escopo de módulo (ela só depende de `getProvider`, `updateTransaction` e dos tipos, todos disponíveis no nível superior) e chamá-la tanto de `paymentStatusAction` quanto de `refreshPaymentAction`. Alternativamente, extrair para `_shared/payments/resolution.ts`. Adicionar teste de regressão cobrindo `refresh_payment` com pagamento MP sem `provider_payment_id`. (Não executado.)

### P1 — CRÍTICO: nome de Secret do webhook incompatível

- **Arquivo/função:** `supabase/functions/_shared/payments/mercadopago.ts:67`, `:533-544`.
- **Evidência:** `webhookSecret: readEnv("MP_WEBHOOK_SECRET")`; se ausente, retorna `valid:false, reason:"MP_WEBHOOK_SECRET não configurado."`. O projeto possui `MERCADOPAGO_WEBHOOK_SECRET`, que não é lido em nenhum ponto do repositório (busca textual: 0 ocorrências).
- **Impacto:** 100% das notificações rejeitadas com 401; pedidos aprovados não são confirmados via webhook.
- **Correção recomendada:** configurar `MP_WEBHOOK_SECRET` no projeto `ardpqimdllzbbdvwamkh` com o mesmo segredo do app MP de homologação — **ou** alterar o código para ler `MERCADOPAGO_WEBHOOK_SECRET`. Não criar um segredo novo e não duplicar valores entre ambientes. (Não executado.)

### P2 — ALTO: divergência de valor/moeda não bloqueia atualização do pedido

- **Arquivo/função:** `_shared/payments/webhooks.ts:177-200` (`flagDivergence`), `:231-267` (`updateTransaction`/`syncOrderPayment`); `_shared/payments/lifecycle.ts:363-387`.
- **Evidência:** após consulta oficial à API, `detectDivergence()` apenas registra o problema; o fluxo continua e grava `captured`/`orders.payment_status` mesmo com valor ou moeda diferentes do pedido.
- **Impacto:** pagamento de valor menor ou em outra moeda pode marcar o pedido como pago.
- **Correção recomendada:** em `divergence.hasDivergence`, falhar fechado — não sincronizar `orders`, marcar transação para revisão/disputa e acionar alerta.

### P3 — ALTO: checkout não verifica o ambiente da conexão do vendedor

- **Arquivo/função:** `supabase/functions/payments/index.ts:355-358` (`create_payment`); `connections.ts:37-91` (`loadCredentials`).
- **Evidência:** o checkout exige `connected`, `status==="connected"` e `enabled`, mas não compara `connection.environment` com `providerEnvironment(provider)`; essa comparação existe apenas nas views (`connections.ts:118`, `:160`). `mpEnvironment()` cai em `sandbox` se `MP_ENV` não for literalmente `production`.
- **Impacto:** conexão sandbox pode ser usada em runtime de produção e vice-versa.
- **Correção recomendada:** exigir `connection.environment === providerEnvironment(provider)` em `create_payment` e falhar no deploy/startup se `MP_ENV` estiver ausente em produção.

### P4 — MÉDIO: chave de idempotência da Preference é por pedido, não por tentativa

- **Arquivo/função:** `_shared/payments/mercadopago.ts:352`; `payments/index.ts:458`.
- **Evidência:** `X-Idempotency-Key: input.externalReference`, onde `externalReference = order.id` (UUID do pedido), reutilizado em todas as tentativas.
- **Impacto:** após preferência recusada/abandonada/expirada, novas tentativas podem receber a mesma preferência antiga.
- **Correção recomendada:** derivar a chave de `orderId + checkoutSessionId`, mantendo estabilidade por tentativa.

### P5 — MÉDIO: `notification_url` bypassa o fail-fast de configuração

- **Arquivo/função:** `_shared/payments/mercadopago.ts:346-347`, `:137-139`.
- **Evidência:** `readEnv("SUPABASE_URL") ?? ""` gera `"/functions/v1/webhooks-mercadopago"` (relativa) se a variável faltar, enquanto `urls.ts:27-31` corretamente lança erro.
- **Correção recomendada:** usar `paymentsWebhookUrl()` de `urls.ts` no `createPayment`.

### P6 — MÉDIO: validação de `x-signature` não aceita múltiplos `v1`

- **Arquivo/função:** `mercadopago.ts:546-553`, `:594-598`.
- **Evidência:** `Map` de `ts=`/`v1=` com last-wins; durante rotação de chave o MP envia duas assinaturas. Não há teste para esse caso.
- **Correção recomendada:** iterar todos os `v1=` e aceitar se qualquer um casar com o HMAC do manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`.

### P7 — MÉDIO: isolamento entre lojas depende de `payload.user_id`

- **Arquivo/função:** `webhooks.ts:103-122`, `:479-490`; `lifecycle.ts:267`; `resolution.ts:160-171`.
- **Evidência:** se o payload não traz `user_id`, `notificationCatalogId` fica nulo e a checagem de outra loja é pulada; um `external_reference` no corpo pode resolver a transação antes da consulta oficial.
- **Correção recomendada:** exigir consulta oficial bem-sucedida e conferir que a conta do API response corresponde à conexão da transação.

### P8 — MÉDIO: rate limit dos endpoints públicos é fail-open e spoofable

- **Arquivo/função:** `_shared/payments/ratelimit.ts:8-11`, `:33-47`, `:52-59`; `payments/index.ts:111-116`.
- **Evidência:** falha de DB permite todas as requisições; IP vem de `cf-connecting-ip`/`x-real-ip`/`x-forwarded-for`, controláveis pelo cliente se não houver proxy confiável.
- **Correção recomendada:** usar IP fornecido pela plataforma, aceitar header apenas do edge confiável e falhar fechado para `create_order`/`create_payment`.

### P9 — MÉDIO: ciphertext AES-GCM sem AAD

- **Arquivo/função:** `_shared/payments/crypto.ts:68-81`; `db.ts:137-140`.
- **Evidência:** `encryptSecret`/`decryptSecret` não recebem Additional Authenticated Data; um blob copiado entre linhas/colunas continua descriptografável.
- **Correção recomendada:** usar AAD `` `${catalog_id}:${provider}:${tokenKind}` ``.

### P10 — MÉDIO: política anônima de INSERT em `orders`

- **Arquivo/função:** `supabase/fixes/20261118_restore_orders_anon_insert.sql:17-23`; `20260826200000_full_setup_new_project.sql:191-192`; fallback `src/routes/c.$slug.tsx:594-633`.
- **Evidência:** `for insert to anon with check (true)` permite gravar pedido em qualquer `catalog_id`. A migration `20261115090000:263-264` remove essa política, mas o código de fallback depende dela.
- **Correção recomendada:** confirmar o estado atual da política em cada ambiente; preferir manter removida quando `payments` estiver ativo; se necessária, restringir `WITH CHECK` a catálogo existente e ativo.

### P11 — BAIXO: `state` OAuth insert não é fatal no `connect`

- **Arquivo/função:** `db.ts:366-382`; `payments/index.ts:686-692`; `payments-callback/index.ts:126-128`.
- **Evidência:** falha ao gravar `payment_oauth_states` só gera log; a URL de autorização é retornada, e o callback falha depois com `state_already_used`.
- **Correção recomendada:** retornar booleano de `saveOAuthState` e abortar antes de devolver a URL.

### P12 — BAIXO: parâmetro `error` público é logado cru

- **Arquivo/função:** `payments-callback/index.ts:134`.
- **Evidência:** `console.warn("[payments-callback] provedor retornou erro:", provider, providerError)` — valor controlado pelo visitante. O redirect usa `stableError()`, então não há reflexão na UI.
- **Correção recomendada:** logar `stableError(providerError)`.

### P13 — BAIXO: `origin` validado pode conter path

- **Arquivo/função:** `_shared/payments/urls.ts:44-50`; `payments/index.ts:126-139`, `:429-432`.
- **Evidência:** `panelOrigin()` devolve `VITRINE_URL` completo (com eventual path), mas `safeReturnUrl()` compara com `new URL(candidate).origin`.
- **Correção recomendada:** separar `panelBaseUrl()` (construção) de `panelOrigin()` (origem estrita via `new URL(base).origin`).

### P14 — BAIXO: sem PKCE no OAuth do Mercado Pago

- **Arquivo/função:** `mercadopago.ts:224-236`.
- **Evidência:** não há `code_challenge`/`code_verifier`. Há `state` HMAC + nonce, então CSRF está coberto.
- **Correção recomendada:** manter PKCE desabilitado no app MP ou implementá-lo em etapa própria.

### P15 — BAIXO: demais achados

- `mercadopago.ts:187` — `statement_descriptor` fixo `"VITRINE CRIATIVA"`, não reflete a loja.
- `mercadopago.ts:68-69` — defaults BR (`auth.mercadopago.com.br`, `MLB`); vendedores de outros países exigem `MP_AUTH_BASE`/`MP_SITE_ID`.
- `payments/index.ts:627-630` — `disputed` conta como `settled` mas não como `failed`, deixando o status ambíguo ao comprador.
- `payments/index.ts:448-477` — Preference é criada no MP antes de consumir a sessão local; falha de DB deixa preferência órfã (agrava P4).
- `webhooks.ts:315-329` + `db.ts:698-729` — assinaturas inválidas geram linhas em `payment_events` sem rate limit no endpoint do webhook.
- `tests/payment-providers.test.ts:390-406` — comentário afirma que `merchant_order` é ignorado, mas `mercadopago.ts:531` o processa.
- `lifecycle.ts:251` — para `merchant_order`, prefere `provider_payment_id` já salvo ao pagamento recém-selecionado (risco de confirmar pagamento obsoleto).
- `mercadopago.ts:554-564` — notificação assinada sem `data.id` é recusada (401) em vez de tratada como teste.

---

## 4. Riscos de segurança

1. **`refresh_payment` quebrado (P0)** — risco operacional imediato: a ação de atualização do vendedor falha em compilação/runtime no cenário MP sem `provider_payment_id`, justamente o intervalo entre a criação da Preference e a chegada do webhook. Combinado com P1, o vendedor perde a única via manual de reconciliação.
2. **Webhook inoperante (P1)** — maior risco operacional: pagamentos aprovados não chegam ao pedido; confiança excessiva no polling do navegador.
3. **Confirmação financeira divergente (P2)** — risco de fraude contábil se valor/moeda divergentes ainda fecharem o pedido.
4. **Mistura de ambientes (P3)** — seller sandbox em produção (ou vice-versa) pode gerar expectativa errada de liquidação.
5. **Tokens de vendedor (P9)** — AES-GCM sem AAD reduz defesa em profundidade se houver cópia de ciphertext entre registros.
6. **Anon INSERT irrestrito em `orders` (P10)** — poluição de pedidos e possível abuso se a política de restore estiver ativa.
7. **Rate limiting (P8)** — abuso de `create_order`/`create_payment` e custo/volume de chamadas ao MP.
8. **Log de parâmetro externo (P12)** — baixo risco de log injection; sem vazamento de segredo.
9. **Frontend:** nenhum segredo do MP é exposto. Apenas JWT do Supabase e chave publicável são enviados (`src/lib/payments.ts:77-99`). Tokens são mascarados antes de chegar ao painel. Logs de erro do MP são redigidos (`mercadopago.ts:38-50`). Exceção: P12.
10. **Isolamento homologação/produção:** URLs de callback/webhook/painel derivadas de `SUPABASE_URL`/`VITRINE_URL` com fail-fast; sem literais de produção nos módulos de pagamento. Atenção: funções adjacentes (Melhor Envio/Meta) ainda possuem fallbacks hardcoded — fora do escopo MP.

---

## 5. O que já está funcionando

- **OAuth por vendedor:** `state` assinado (HMAC-SHA256, segredo dedicado), expiração de 15 min, nonce de uso único, verificação de posse do catálogo, `redirect_uri` igual na idulação e na troca de código.
- **Tokens:** AES-256-GCM com IV aleatório, colunas `*_enc`, grant de leitura removido do navegador pela migration de minimização; refresh de token do vendedor implementado (5 min antes do vencimento), com marcação de conexão expirada na falha.
- **Separação de credenciais:**平台 `MP_CLIENT_ID`/`MP_CLIENT_SECRET` apenas para OAuth/refresh/assinatura; token do vendedor para Preference, consulta de pagamento e reembolso.
- **Split 1:1:** nenhum `marketplace_fee`, nenhuma comissão da plataforma, pagamento criado com token do vendedor — destinatário correto. Nenhuma comissão é cobrada (decisão de arquitetura, não defeito).
- **Checkout Pro:** `POST /checkout/preferences`, `back_urls` com `success`/`pending` = retorno do comprador e `failure` = cancelamento, `auto_return:"approved"`, `external_reference` = UUID do pedido, `metadata` com `order_id`/`catalog_id`/totais, frete em `shipments.cost`.
- **Validação de retorno:** comparação exata de origem (não `startsWith`), fallback derivado de `VITRINE_URL`.
- **Idempotência:** sessão de checkout de uso único (SHA-256 no banco), índice único parcial para transação ativa por pedido, chave de idempotência no MP, evento de webhook único por `(provider, provider_event_id)`, `x-request-id` no event id, nonce OAuth.
- **Status:** mapeamento completo (`approved`, `authorized`, `in_process`, `pending`, `rejected`, `cancelled`, `refunded`, `charged_back`), refund monotonicamente calculado.
- **Webhook:** recebe GET e POST, usa corpo cru, manifesto `id:...;request-id:...;ts:...;`, HMAC-SHA256, janela de 10 min, consulta obrigatória à API oficial com token do vendedor, redirecionamento de eventos de outra loja, test events respondidos sem efeito.
- **RLS/autorização:** tabelas financeiras com RLS, leitura owner-only via `catalogs.user_id`, ações de dono com `verifyUser` + `getOwnedCatalog`, `verify_jwt=false` apenas nos endpoints públicos esperados.
- **Testes:** suíte local de 434 testes, 0 falhas (baseline 420 + 14 de isolamento), cobrindo criptografia, state, webhook, idempotência, moeda, frete, RLS e isolamento de ambientes.

---

## 6. O que ainda precisa ser implementado / corrigido

1. **Corrigir P0 (bloqueador de build)** — elevar `resolveMpPaymentId` ao escopo de módulo para que `refresh_payment` compile e funcione; adicionar teste de regressão.
2. **Corrigir P1** — alinhar o nome do segredo do webhook (`MP_WEBHOOK_SECRET` × `MERCADOPAGO_WEBHOOK_SECRET`) sem criar novo valor.
3. **Corrigir P2** — divergência de valor/moeda deve impedir a confirmação do pedido.
4. **Corrigir P3** — validar ambiente da conexão no checkout.
5. **Corrigir P4/P5** — chave de idempotência por tentativa e `notification_url` via helper fail-fast.
6. **Corrigir P6/P7** — múltiplas assinaturas `v1` e isolamento baseado na conta confirmada pela API.
7. **Endurecer P8/P9/P10** — rate limit, AAD e política de INSERT anônimo.
8. **Cadastro no app MP de homologação:** Redirect URL `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/payments-callback`; Webhook URL `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago` (eventos `payment` e `merchant_order`); PKCE desabilitado enquanto P14 não for resolvido.
9. **Validação manual em homologação** (com autorização separada): conectar vendedor de teste, disparar evento de teste do webhook, conferir tabelas financeiras somente leitura — sem cobrança.
10. **Produção:** nada foi preparado nesta auditoria. Requer app MP próprio, Secrets próprios, `MP_ENV=production`, Redirect/Webhook de produção e deploy validado.

---

## 7. Testes que podem ser executados com segurança em Sandbox

**Sem qualquer efeito financeiro ou escrita no banco:**

| Teste | Comando / ação | Objetivo |
|---|---|---|
| Suíte completa local | `npm test` | 434 testes com mocks; nenhuma chamada de rede ou escrita |
| Webhook e assinatura | `node --test tests/payment-webhooks-mp.test.ts` | HMAC válido/inválido, ausência de assinatura, replay, `x-request-id` |
| Idempotência | `node --test tests/payment-idempotency.test.ts` | eventos repetidos, reembolso monotônico, token de uso único, rate limit |
| Isolamento entre lojas | `node --test tests/payment-isolation.test.ts` | evento da loja B não atinge a loja A, `external_reference` |
| Checkout guard | `node --test tests/payment-checkout-guard.test.ts` | dupla cobrança bloqueada, sessão consumida |
| Preferência/frete | `node --test tests/payment-mp-shipping.test.ts` | `shipments.cost`, total fechado, idempotência da Preference |
| Crypto/state | `node --test tests/payment-crypto.test.ts` | AES-GCM, HMAC, expiração, mascaramento |
| Provedores | `node --test tests/payment-providers.test.ts` | configuração, ausência de `MP_WEBHOOK_SECRET`, IPN por query |
| Isolamento de ambientes | `node --test tests/payment-env-isolation.test.ts` | nenhuma URL de homologação aponta para produção |
| Regressão P0 (após correção) | teste novo para `refresh_payment` com MP sem `provider_payment_id` | garante que `resolveMpPaymentId` esteja acessível e resolva o id via `merchant_order` |

**Sandbox com efeito controlado (somente após autorização explícita):**

- Conectar uma conta de vendedor **de teste** via `/painel/pagamentos` (OAuth não cria cobrança); conferir `payment_connections` e `payment_oauth_states` em leitura.
- Usar o botão de **notificação de teste** do app MP; o código responde `200 {ignored:"test_event"}` sem gravar efeitos financeiros (`webhooks.ts:296-298`).
- Criar uma Preference em sandbox **sem concluir o pagamento** apenas para inspecionar `back_urls`, `external_reference` e `notification_url` — não gera cobrança, mas depende de autorização por envolver chamada à API do MP.

**Não executar:** pagamentos reais, cobranças, reembolsos, transações de produção, migrations, limpeza de tabelas ou rotação de chaves.

---

## 8. Veredito geral

# REPROVADO

**Justificativa:** existem dois bloqueadores críticos — **P0** (`resolveMpPaymentId` declarada dentro de `paymentStatusAction` mas chamada em `refreshPaymentAction`, tornando a ação de refresh inválida) e **P1** (o segredo de webhook configurado não é o segredo lido pelo código, tornando a validação de assinatura impossível e todas as notificações inválidas) — somados a um risco alto confirmado (P2 — divergência de valor/moeda da API oficial não impede a atualização do pedido) e a um risco de isolamento (P3 — ambiente da conexão não validado no checkout).

O núcleo da integração OAuth, criptografia, idempotência, RLS, mascaramento e derivação de URLs está bem implementado e coberto por testes. A aprovação depende da correção de P0, P1, P2 e P3 e de nova validação em homologação, sem cobranças reais. Nenhuma dessas correções foi aplicada nesta etapa.

---

**Fim do relatório. Aguardando autorização para qualquer alteração.**
