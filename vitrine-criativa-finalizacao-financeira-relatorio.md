# Vitrine Criativa — Relatório de Finalização Financeira

**Data:** 20 de novembro de 2026
**Tipo de execução:** auditoria somente de leitura + testes locais determinísticos + sondas HTTP read-only
**Ambiente auditado:** PRODUÇÃO (`wdcufpvlbisnqtvmbyso`) e homologação (`ardpqimdllzbbdvwamkh`) como referência
**HEAD examinado:** `cf9d241` — nenhum arquivo foi modificado, nenhum commit/deploy foi feito nesta execução

> **Ponto de parada respeitado:** não houve cobrança real, não houve alteração de credencial, não houve ativação de pagamento, não houve deploy e não houve modificação de dado financeiro.

---

## 1. Auditoria realizada — escopo e método

### 1.1 Fontes examinadas
- Relatório de publicação: `vitrine-criativa-publicacao-producao-relatorio.md` (lido integralmente).
- Funções: `supabase/functions/payments/index.ts`, `payments-callback/index.ts`, `webhooks-mercadopago/index.ts`, `webhooks-paypal/index.ts`.
- Camada compartilhada: `supabase/functions/_shared/payments/*.ts` (22 arquivos, incluindo `mercadopago.ts`, `paypal.ts`, `connections.ts`, `webhooks.ts`, `db.ts`, `crypto.ts`, `urls.ts`, `lifecycle.ts`, `resolution.ts`, `refund-flow.ts`, `refunds.ts`, `ratelimit.ts`).
- Frontend: `src/routes/painel.pagamentos.tsx`, `src/routes/c.$slug.tsx`, `src/lib/payments.ts`, `supabase/config.toml`.
- 20 arquivos `tests/payment-*.test.ts` (mapeados; 368 casos `test(` no código-fonte).
- Estado externo: `supabase secrets list` (somente nomes), `supabase functions list`, `supabase db query` (contagens), sondas HTTP `curl`/`Invoke-RestMethod`.

### 1.2 Evidências de estado externo (sem valores de segredos)

| Item | Produção `wdcufpvlbisnqtvmbyso` | Homologação `ardpqimdllzbbdvwamkh` |
| --- | --- | --- |
| Secrets financeiros | **0** | 6 (`MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_ENV`, `MERCADOPAGO_WEBHOOK_SECRET`, `PAYMENT_STATE_SECRET`, `PAYMENT_TOKEN_ENCRYPTION_KEY`) |
| `payments` | ACTIVE v1 | ACTIVE v8 |
| `payments-callback` | ACTIVE v1 | ACTIVE v8 |
| `webhooks-mercadopago` | ACTIVE v1 | ACTIVE v8 |
| `webhooks-paypal` | **AUSENTE** | ACTIVE v8 |
| `payment_connections` | 0 linhas | 0 linhas |
| `payment_transactions` / `payment_events` / `payment_refunds` / `payment_oauth_states` / `order_checkout_sessions` | 0 / 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 / 0 |
| Webhook MP sem assinatura | 503 `Provedor não configurado.` | **401** (segredo presente, assinatura ausente) |
| Webhook PayPal sem assinatura | função ausente | 503 |
| Callback `state=invalid` | 302 → `connected=0&error=invalid_state` | 302 → `connected=0&error=invalid_state` |

Nota: `supabase secrets list` retorna valores cifrados (64 caracteres, 16 caracteres únicos); nenhum valor foi lido, impresso ou registrado.

---

## 2. ETAPA A — Auditoria do Mercado Pago

### 2.1 OAuth existente
- URL de autorização montada em `supabase/functions/_shared/payments/mercadopago.ts:294`, com `client_id`, `response_type=code`, `platform_id=mp`, `state`, `redirect_uri`, `site_id` (`mercadopago.ts:297-305`).
- Base: `MP_AUTH_BASE`, padrão `https://auth.mercadopago.com.br` (`mercadopago.ts:110`); site padrão `MLB` (`mercadopago.ts:111`).
- Credenciais da plataforma: `MP_CLIENT_ID` / `MP_CLIENT_SECRET` (`mercadopago.ts:101-102`); `isConfigured()` exige ambas (`mercadopago.ts:281-284`).
- Troca do código: `POST /oauth/token` com `grant_type=authorization_code` e o mesmo `redirect_uri` (`mercadopago.ts:308-323`), seguida de `/users/me` com o token do vendedor (`mercadopago.ts:332-341`).
- **Não existe `client_credentials` no fluxo MP** (`tests/payment-homologacao-final.test.ts:40-41` afirma isso). O vendedor é sempre a conta autorizada.

### 2.2 Callback
- Entrypoint `payments-callback/index.ts:97`.
- `state` verificado por HMAC-SHA256 + expiração (`:107-113`); ambiente assinado precisa bater com o runtime (`:122-127` → `environment_mismatch`); `catalog_id`/`user_id` obrigatórios (`:129-131`).
- Nonce de uso único em `payment_oauth_states`: reutilização retorna `state_already_used` (`:133-140`).
- Posse do catálogo conferida (`:150-154`), criptografia exigida (`:155-157`), provedor configurado exigido (`:158-161`).
- Conta verificada antes de persistir (`:182-197`), rótulo mascarado (`:208`, `:232-234`).
- **Nunca habilita automaticamente:** `enabled: false` explícito (`:221-227`); o vendedor deve marcar “Exibir no checkout” (`painel.pagamentos.tsx:726-743`).

### 2.3 Persistência e renovação de token
- `payment_connections`, token AES-256-GCM com IV de 12 bytes (`_shared/payments/crypto.ts:68-80`), formato `v1:<iv>:<ciphertext>` (`:80`), chave `PAYMENT_TOKEN_ENCRYPTION_KEY` (`:63-65`); `state` usa `PAYMENT_STATE_SECRET` (`:119-145`).
- `connected` é derivado de `status`, nunca fixado em `true` (`db.ts:146-150`).
- Renovação automática com < 5 min para expirar (`connections.ts:24`, `:76-86`), `grant_type=refresh_token` (`mercadopago.ts:352-376`).
- Falha na renovação → `expired`, `connected=false`, `enabled=false` (**fail-closed**, `connections.ts:87-102`).

### 2.4 Função `payments`
- Roteador `payments/index.ts:174`. Públicas: `methods`, `create_order`, `create_payment`, `payment_status` (`:183`); dono (JWT): `status`, `connect`, `disconnect`, `verify`, `set_enabled`, `transactions`, `refund`, `refresh_payment` (`:249-269`).
- Rate limit por ação (`:113-118`); **fail-closed** apenas em `create_order`/`create_payment` (`:187-209`); leituras fail-open por decisão de produto.
- Gates de cobrança: pedido pago/reembolsado → 409 (`:384-392`); conexão ausente/desabilitada, ambiente divergente ou moeda incompatível bloqueiam (`:404-422`); segunda cobrança viva no mesmo pedido bloqueada inclusive em outro provedor (`:437-483`).
- Idempotência por **tentativa** (hash do `checkout_token`, `:353-361`) + sessão de checkout de uso único consumida antes de gravar transação (`:525-536`); preferência MP com `X-Idempotency-Key` (`mercadopago.ts:421-427`).

### 2.5 Webhook e idempotência
- HMAC-SHA256 do manifesto `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` (`mercadopago.ts:58-68`, `:688-710`), tolerância de replay de 10 min (`:32-33`, `:668-686`), comparação em tempo constante (`:49-56`, `:706-709`), rotação de chaves com múltiplos `v1` (`:635-655`).
- Idempotência por `x-request-id` (`:615-619`) em `payment_events` com `unique (provider, provider_event_id)`; assinatura inválida usa chave separada `invalid:` para não bloquear o evento legítimo (`webhooks.ts:353-405`, `lifecycle.ts:302-305`); evento falhado é reprocessado (`webhooks.ts:431-433`).
- Confirmação **sempre** pela API oficial `GET /v1/payments/{id}` (`mercadopago.ts:447-487`, `:538-579`), com gates de valor, moeda, pedido e vendedor (`webhooks.ts:171-215`); assinatura inválida → 401 (`:367-400`).

### 2.6 URL de notificação
- Derivada de `SUPABASE_URL` do runtime (`urls.ts:27-36`, `:41-44`): em produção resulta em `https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/webhooks-mercadopago`.
- Validação rígida em `urls.ts:55-78`: HTTPS, path exato, sem query/hash/credenciais e mesma origem do projeto; falha rápido se ausente (`:80-85`). Chamada antes da preferência (`mercadopago.ts:416-419`) e envio em `notification_url` (`:250`).

### 2.7 Consulta de métodos
- `listPublicPaymentMethods()` exige provedor configurado + conexão `connected` + `enabled` + mesmo ambiente + moeda suportada (`connections.ts:163-185`). Sem nada disso, retorna `[]` — comportamento confirmado em produção (`methods` → 200, `methods: []`, `currency: BRL`). Moedas MP aceitas: BRL, ARS, CLP, COP, MXN, PEN, UYU (`currencies.ts:33-36`).

### 2.8 Lacunas do Mercado Pago
| # | Achado | Evidência | Impacto |
| --- | --- | --- | --- |
| M1 | PKCE não implementado (sem `code_challenge`/`code_verifier`) | `mercadopago.ts:294-305`, `:308-323` | Se o app MP tiver PKCE obrigatório, a troca falha. Decisão anterior foi manter desligado até implementação. |
| M2 | Escopos não solicitados explicitamente; lidos do token (`offline_access read write`) | `mercadopago.ts:339` | Permissões menores concedidas podem quebrar captura/reembolso sem aviso. |
| M3 | `revoke()` é no-op; desconectar apaga só o token local | `mercadopago.ts:378-382`, `payments/index.ts:746-757` | A autorização continua ativa no MP até remoção manual pelo vendedor. |
| M4 | `MP_SITE_ID` ausente assume `MLB` | `mercadopago.ts:111`, `connections.ts:176-182` | Lojas de outros sites podem ter método ocultado. |
| M5 | Split 1:1 e destino do dinheiro não são comprováveis por código | `mercadopago.ts:264-266`, `:447-487` | Depende de pagamento aprovado e reconciliação via API oficial. |
| M6 | Nome do segredo do webhook tem compatibilidade legada | `mercadopago.ts:103-109` | Produção deve usar `MERCADOPAGO_WEBHOOK_SECRET` (precedência) ou `MP_WEBHOOK_SECRET`. |

**O que falta exatamente para conectar a conta real:** 6 Secrets em produção + app MP de produção com Redirect URI e Webhook URL cadastrados + OAuth realizado pela vendedora + toggle manual. Detalhado na seção 8.

---

## 3. ETAPA B — Procedimento de conexão do Mercado Pago (PREPARADO, NÃO EXECUTADO)

### 3.1 Gate técnico atual
O botão “Conectar” em `/painel/pagamentos` está **desabilitado** porque `connection.configured === false` e `status.encryption_configured === false` (`painel.pagamentos.tsx:713`, `:447-452`). O backend recusa `connect` com 503 se não houver criptografia/provedor (`payments/index.ts:697-712`). Isso é correto e impede conexão incompleta.

### 3.2 Procedimento (depende de ação manual — PARE AQUI)
1. **No Supabase de produção**, configurar os Secrets (somente nomes; valores devem ser fornecidos pelo usuário, nunca por mim):
   - `MP_CLIENT_ID`
   - `MP_CLIENT_SECRET`
   - `MP_ENV` = **`production`** (qualquer outro valor cai em sandbox — `mercadopago.ts:95-97`)
   - `MERCADOPAGO_WEBHOOK_SECRET`
   - `PAYMENT_STATE_SECRET`
   - `PAYMENT_TOKEN_ENCRYPTION_KEY`
2. **No aplicativo Mercado Pago de produção**, cadastrar:
   - Redirect/OAuth URI: `https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/payments-callback`
   - URL de notificação: `https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/webhooks-mercadopago`
   - Eventos: `payment` e `merchant_order`
   - Obter o segredo do webhook gerado pelo MP e usá-lo no Secret acima.
   - Conferir se PKCE está desabilitado (ou autorizar implementar PKCE antes).
3. **No painel** `https://vitrine.meellcriativa.workers.dev/painel/pagamentos`, com login da vendedora:
   - Conectar Mercado Pago → login na **conta real da vendedora**, não na principal → autorizar.
   - Conferir rótulo/ID mascarados exibidos e o selo “Produção”.
   - Clicar em “Verificar conexão”.
   - Marcar manualmente “Exibir no checkout” (nunca é automático).
4. **Validação pós-conexão:** `payments?action=methods&slug=<slug>` deve passar a retornar os métodos do provedor; `payment_connections` deve ter 1 linha com `connected=true`, `enabled=true`, `environment='production'` e `external_account_id` correspondente à vendedora.

**Não é seguro pular o item 4 nem habilitar antes de comprovar o destino do dinheiro.**

---

## 4. ETAPA C — Testes do Mercado Pago (executados)

### 4.1 Suíte local determinística
- `npm test`: **490 testes, 490 aprovados, 0 falhas** (7,5 s). Nenhum teste faz chamada de rede real: os que citam URLs usam `globalThis.fetch` stubado (`payment-mp-shipping.test.ts:181`, `payment-correcoes-p5-p6.test.ts:120,180`, `payment-correcoes-pendencias.test.ts:278,304`) ou `deps` injetadas (`payment-refund-flow.test.ts:236`, `payment-isolation.test.ts:45-83`).

| Arquivo | Testes | Pass | Fail |
| --- | ---: | ---: | ---: |
| `payment-webhooks-mp.test.ts` | 12 | 12 | 0 |
| `payment-paypal-capture.test.ts` | 21 | 21 | 0 |
| `payment-homologacao-final.test.ts` | 4 | 4 | 0 |
| `payment-idempotency.test.ts` | 20 | 20 | 0 |
| `payment-refund-flow.test.ts` | 20 | 20 | 0 |
| `payment-refunds.test.ts` | 39 | 39 | 0 |
| `payment-env-isolation.test.ts` | 14 | 14 | 0 |
| `payment-isolation.test.ts` | 8 | 8 | 0 |
| `payment-checkout-guard.test.ts` | 14 | 14 | 0 |
| `payment-mp-shipping.test.ts` | 9 | 9 | 0 |
| `payment-providers.test.ts` | 28 | 28 | 0 |
| `payment-crypto.test.ts` | 27 | 27 | 0 |
| `payment-data-minimization.test.ts` | 4 | 4 | 0 |

### 4.2 Cobertura dos cenários exigidos
| Cenário | Evidência | Resultado |
| --- | --- | --- |
| Pagamento aprovado | `payment-webhooks-mp.test.ts:111`; `payment-providers.test.ts:306`; `payment-correcoes-p0-p3.test.ts:265` | ✅ simulado |
| Pagamento recusado | Mapa `rejected→failed` em `payment-providers.test.ts:237`; **sem teste de handler que atualize o pedido** | ⚠️ parcial |
| Pagamento cancelado | Mapa `cancelled→cancelled` (`payment-providers.test.ts:238`); **sem teste de handler de cancelamento do pedido** | ⚠️ parcial |
| Notificação duplicada | `payment-webhooks-mp.test.ts:321`; `payment-idempotency.test.ts:32` | ✅ |
| Assinatura inválida | `payment-webhooks-mp.test.ts:125,139,292`; `payment-correcoes-p5-p6.test.ts:231,260,278` | ✅ |
| Webhook sem assinatura | `payment-webhooks-mp.test.ts:147`; `payment-correcoes-p0-p3.test.ts:125` | ✅ |
| Callback com estado inválido | Primitivas em `payment-crypto.test.ts:122,128,134,149,154`; **nenhum teste executa o handler do callback** | ⚠️ parcial |
| Idempotência | `payment-idempotency.test.ts` (20 casos) + `payment-refund-flow.test.ts:330-517` | ✅ |
| Atualização do pedido | Apenas estrutural (`payment-correcoes-p0-p3.test.ts:278`); **sem asserção de campos gravados** | ⚠️ parcial |

### 4.3 Sondas em homologação (Sandbox)
- Webhook MP sem assinatura → **401** (recusa correta com segredo configurado).
- Callback com `state=invalid` → **302** `connected=0&error=invalid_state`.
- `payment_connections` e demais tabelas financeiras: **0 linhas** — não existe conexão OAuth sandbox.

### 4.4 Limite real dos testes Sandbox
**Não foi possível executar um pagamento Sandbox de ponta a ponta.** Motivos objetivos:
1. não há conexão OAuth de vendedora em homologação (0 linhas);
2. não há catálogo utilizável em homologação para originar um pedido;
3. o CLI da Supabase devolve Secrets cifrados, então não é possível construir localmente uma assinatura HMAC válida contra o endpoint de homologação;
4. não existe harness versionado de Sandbox (nenhum `*.sh`; o único `scripts/deploy-melhor-envio.ps1` é de deploy e mira produção).

Cobertura adicional exigiria: criar conta de teste MP, realizar OAuth sandbox, cadastrar webhook sandbox e gerar pagamento de teste — tudo com intervenção humana. **Nenhuma cobrança real foi simulada.**

---

## 5. ETAPA D — Auditoria independente do PayPal

### 5.1 Credenciais e ambiente
- Secrets exigidos (nomes apenas): `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_PARTNER_ID`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV`, opcional `PAYPAL_PARTNER_ATTRIBUTION_ID` (`paypal.ts:66-70`, `:56-57`).
- Bases por ambiente em `paypal.ts:30-33`, resolvidas em `:60-62`. `isConfigured()` exige Client ID + Secret + Partner ID + Webhook ID (`paypal.ts:336-341`).
- Infraestrutura compartilhada: `PAYMENT_TOKEN_ENCRYPTION_KEY`, `PAYMENT_STATE_SECRET`, `VITRINE_URL` (auto-injetado).
- Token da plataforma via `client_credentials` (`paypal.ts:105-123`) — **modelo marketplace com `merchant_id`, não token por vendedor** (`paypal.ts:443-454`).

### 5.2 Onboarding / conexão
- Seller Onboarding (Partner Referrals `POST /v1/customer/partner-referrals`), não troca de código (`paypal.ts:357-400`); retorno com `merchantIdInPayPal` e `permissionsGranted=true` obrigatório (`paypal.ts:402-411`); consulta de `payments_receivable` e capabilities (`paypal.ts:420-440`).
- Mesmo callback seguro do MP (state HMAC, env, nonce, posse, criptografia) em `payments-callback/index.ts:107-161`.

### 5.3 Pedido, captura e webhook
- `intent: "CAPTURE"`, `reference_id=orderId`, `invoice_id`, `payee.merchant_id` (`paypal.ts:198-206`); criação com `PayPal-Request-Id: order-<id>` (`:526-566`); captura com `PayPal-Request-Id: capture-<id>` e tratamento de `ORDER_ALREADY_CAPTURED` (`:609-655`).
- Lease de captura de 60 s com UPDATE condicional (`webhooks.ts:74-75`, `db.ts:559-580`, aplicado em `webhooks.ts:226`).
- Webhook validado pela API oficial `/v1/notifications/verify-webhook-signature` com todos os headers `paypal-*` (`paypal.ts:730-798`), só aceito com `verification_status === "SUCCESS"` (`:784`). Pipeline de idempotência compartilhado com MP (`webhooks.ts:345-433`).

### 5.4 Reembolsos
- `POST /v2/payments/captures/{id}/refunds` com `PayPal-Request-Id` da operação (`paypal.ts:657-683`); `operation_id` persistido antes da chamada (`refund-flow.ts:10-18`); ledger recalculado em unidades mínimas (`refunds.ts:13-20`).

### 5.5 Lacunas do PayPal
| # | Achado | Evidência | Impacto |
| --- | --- | --- | --- |
| P1 | `webhooks-paypal` **não publicada em produção** | `functions list`; `relatorio.md:47,136`; `config.toml:15-16` a declara | Fluxo de captura automática via notificação inalcançável em produção. |
| P2 | Nenhum Secret PayPal em produção | `secrets list` | `isConfigured()=false`; `connect`/`create_payment` fail-closed. |
| P3 | Webhook menos rígido que o MP: `requireOrderReference=false`, `requireSellerAccount=false` | `webhooks.ts:186-187` | Ausência de referência de pedido/conta não bloqueia confirmação (divergência quando presente **ainda bloqueia** — `lifecycle.ts:412-440`). |
| P4 | Isolamento cross-catalog incompleto no webhook PayPal | `webhooks.ts:120`, `:550-586` (fallback P7 é MP-only) | Checagem por `catalogId` só atua se o evento trouxer o campo. |
| P5 | Conta de destino não revalidada no evento | `paypal.ts:206,403,533-536` vs. `webhooks.ts:186-187` | `payee` é definido na criação, mas não comparado com a conta do evento. |
| P6 | Sem token por vendedor; `client_credentials` + `merchant_id` | `paypal.ts:443-454` | Modelo marketplace legítimo, mas exige comprovação de que o `merchant_id` é a conta da vendedora. |
| P7 | Cobertura de teste apenas unitária/simulada | `payment-paypal-capture.test.ts:17-23` | Sem evidência de ponta a ponta com PayPal real. |

---

## 6. ETAPA E — Testes do PayPal (executados)

- `payment-paypal-capture.test.ts`: **21/21** aprovados — `buildOrderBody`, `mapPayPalStatus`, `paypalSnapshotFromOrder`, `shouldCapture`, `canClaimCapture`, `mergeRefundState`, captura duplicada, `422` genérico **não** tratado como capturado, captura sem credenciais não simula pagamento, lease concorrente.
- `payment-providers.test.ts`: **28/28** — PayPal sem Partner ID / sem Webhook ID não fica configurado; `PAYPAL_ENV`; evento recusado sem `PAYPAL_WEBHOOK_ID` (`:267-276`); mapas `VOIDED→cancelled`, `DECLINED/REJECTED→failed` (`:204-250`).
- `payment-refunds.test.ts` (39/39) e `payment-refund-flow.test.ts` (20/20) — ledger, precisão por moeda, F-01/F-03/F-06A/F-06B.
- Sonda em homologação: webhook PayPal sem assinatura → **503** (função existe, mas sem credenciais de plataforma configuradas no sentido verificável; comportamento fail-closed).
- **Não foi possível testar em Sandbox** criação/aprovação/captura/recusa/cancelamento/webhook válido/reembolso: não há credenciais PayPal em homologação, nem conta de teste, nem `webhooks-paypal` em produção. Nenhuma cobrança real foi feita.

---

## 7. Problemas encontrados — consolidação

1. **Bloqueios externos (não são defeitos de código):** zero Secrets financeiros em produção, nenhum OAuth de vendedora, app MP de produção não configurado, nenhuma conta PayPal conectada.
2. **`webhooks-paypal` ausente em produção** enquanto `config.toml:15-16` a declara — divergência entre config versionada e deploy.
3. **PKCE não implementado no MP** (decisão anterior explícita) e escopos não solicitados na URL.
4. **Desconexão MP não revoga o lado provedor.**
5. **PayPal com validações de posse mais fracas no webhook** (itens P3–P5), além de depender de `merchant_id` não revalidado no evento.
6. **Lacunas de teste:** handler do callback com `state` inválido, handler de webhook com recusa/cancelamento, e asserção dos campos realmente gravados no pedido não são exercitados; assinatura PayPal com headers `paypal-*` não tem teste criptográfico local.
7. **Nenhum harness de Sandbox versionado.**

Nenhum desses pontos foi alterado nesta execução.

---

## 8. Configurações externas pendentes (dependem de você)

### Mercado Pago — ação manual obrigatória
1. Inserir os 6 Secrets no projeto `wdcufpvlbisnqtvmbyso` (seção 3.2), com `MP_ENV=production`.
2. Criar/configurar o aplicativo MP de produção com Redirect URI, Webhook URL, eventos `payment`/`merchant_order`, Webhook Secret e PKCE desabilitado (ou autorizar implementar PKCE).
3. Fazer login como **vendedora real** em `/painel/pagamentos` e concluir OAuth; conferir conta mascarada; marcar “Exibir no checkout”.
4. **Autorizar expressamente** um pagamento real de valor mínimo e a reconciliação: confirmar no painel MP que o `collector_id`/conta creditada é da vendedora, valor e moeda conferem, e que não há comissão (Split 1:1).

### PayPal
5. Fornecer/validar credenciais de produção e ambiente (`PAYPAL_ENV`), Partner ID, Webhook ID e confirmar a conta de destino (`merchant_id`) da vendedora.
6. Autorizar publicar `webhooks-paypal` e cadastrar o webhook no painel PayPal apontando para `https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/webhooks-paypal`.
7. Autorizar o teste financeiro de recebimento na conta correta.

### Decisões de código (requerem sua autorização para implementar/publicar)
8. Corrigir P3–P5 do PayPal (tornar `requireOrderReference`/`requireSellerAccount` obrigatórios também para PayPal e revalidar `merchant_id` no evento).
9. Implementar PKCE e escopos explícitos no MP, se o app exigir.
10. Adicionar os testes faltantes (callback inválido, recusa/cancelamento, escrita do pedido, assinatura PayPal).
11. Criar um harness de Sandbox versionado (se desejar automação).

---

## 9. ETAPA F — Auditoria final (tabela de status)

Legenda: **Implementado** = existe no código; **Configurado** = Secret/app/endpoint presentes no ambiente; **Testado em Sandbox** = executado em homologação; **Testado em produção** = executado com dinheiro/contas reais; **Aguardando ação manual** = depende de você; **Bloqueado por credenciais externas** = não há como avançar sem acesso externo.

| Item | Status | Evidência resumida |
| --- | --- | --- |
| Mercado Pago OAuth | **Implementado**; **Aguardando ação manual** (app + OAuth da vendedora) | `mercadopago.ts:294-341`; 0 conexões em produção |
| Mercado Pago pagamentos | **Implementado**; **Testado localmente** (490/490, stubs); **Bloqueado por credenciais externas** para produção | gates `payments/index.ts:384-483`; 0 transações |
| Mercado Pago webhook | **Implementado**; **Testado em Sandbox** apenas assinatura inválida (401 em homologação); **Aguardando ação manual** (URL/Secret no app MP) | `webhooks.ts:332-472`; `urls.ts:55-85` |
| Mercado Pago recebimento | **Bloqueado por credenciais externas** — nenhuma liquidação/Split comprovado | `relatorio.md:140-148`; 0 transações |
| PayPal credenciais | **Implementado** no código; **Bloqueado por credenciais externas** (0 Secrets em produção) | `paypal.ts:66-70`; `secrets list` |
| PayPal pagamentos | **Implementado**; **Testado localmente** (21/21 captura); **Bloqueado por credenciais externas** | `paypal.ts:198-206,526-655` |
| PayPal webhook | **Implementado**; **Aguardando ação manual** — função ausente em produção (presente em homologação, 503 sem creds) | `webhooks-paypal/index.ts:1-45`; `functions list` |
| PayPal recebimento | **Bloqueado por credenciais externas** — nenhuma conta `merchant_id` comprovada | `paypal.ts:403,443-454` |
| Segurança | **Implementado** (HMAC, AES-GCM, nonce, env-match, idempotência, RLS, fail-closed); ** lacunas P3–P5/M1–M4 identificadas** | seções 2.5, 5.5 |
| Testes | **Testado localmente**: 490/490; **parcial em Sandbox** (sondas read-only); **não testado em produção** | seção 4 |
| Produção | **Publicado e funcionando** para catálogo/pedidos WhatsApp; **pagamentos reais desativados** | worker `40b89b3d`; HEAD `cf9d241` |

---

## 10. Resultados e riscos identificados

### Resultados
- Auditoria completa dos dois provedores com evidências `arquivo:linha`; nenhum segredo exposto.
- 490/490 testes aprovados, incluindo os cenários de assinatura inválida, ausente, replay, duplicata, idempotência, captura e reembolsos.
- Estado real confirmado: produção sem credenciais, sem conexões, sem transações — **nenhuma cobrança real ou de teste ocorreu**.
- Procedimento manual exato para MP foi preparado (seção 3.2).

### Riscos
1. **Risco financeiro principal:** configurar `MP_ENV` diferente de `production` faria a vendedora autorizar em Sandbox e o sistema recusar a cobrança em produção (environment mismatch) — ou, pior, gerar expectativa de recebimento sem liquidação real.
2. **Risco de destino:** OAuth feito com a conta principal em vez da conta da vendedora direcionaria recursos para o destinatário errado. A conferência do identificador mascarado no painel é obrigatória.
3. **Risco PayPal P3–P5:** webhook com validações mais fracas pode confirmar um evento sem referência de pedido/conta; corrigir antes de habilitar.
4. **Risco de duplicação:** idempotência depende de `x-request-id`/`operation_id`; incidentes de retry foram extensivamente testados, mas nunca exercitados com dinheiro real.
5. **Risco operacional:** ausência de harness Sandbox torna a validação manual e sujeita a erro humano.

---

## 11. Arquivos modificados nesta execução

**Nenhum.** Git permanece limpo em `cf9d241`; nenhum commit, push, deploy ou migração foi realizado. O único arquivo criado é este relatório (documentação local, sem impacto financeiro).

---

## 12. Próximas autorizações necessárias

1. Autorização para você configurar os Secrets e o aplicativo Mercado Pago de produção (ação sua no Supabase/MP).
2. Autorização expressa para eu implementar e publicar as correções M1–M4 e P3–P5, se desejar o endurecimento antes da habilitação.
3. Autorização expressa para publicar `webhooks-paypal` em produção.
4. Autorização expressa — com valor, moeda e conta definidos por você — para executar **um** pagamento real de validação e conferir a liquidação na conta da vendedora.
5. Autorização expressa para habilitar os métodos no checkout após a comprovação financeira.

**Até que os itens 1 e 4–5 sejam concluídos, a afirmação correta é: pagamentos estão implementados e testados localmente, mas não habilitados nem financeiramente comprovados em produção.**
