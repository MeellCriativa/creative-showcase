# Etapa 3 — Testes Completos Mercado Pago Sandbox

Data: 20/11/2026
Projeto: **`ardpqimdllzbbdvwamkh`** (`vitrine-criativa-homolog`) — funções de pagamento em **v6**
Produção `wdcufpvlbisnqtvmbyso`: **não acessada, não modificada**.

> **Escopo executado nesta etapa:** apenas verificações de leitura e testes automatizados locais.
> **Nenhuma preferência foi criada, nenhum checkout iniciado, nenhum pagamento simulado, nenhum
> reembolso executado e nenhuma configuração externa alterada.** Todas essas ações dependem de
> autorização expressa e estão descritas na seção 5.

---

## 1. O que foi executado

| Ação | Resultado |
|---|---|
| `npm test` — suíte completa | **453 testes, 453 pass, 0 fail** |
| 9 arquivos de teste direcionados (correções P0–P3, webhook, idempotência, isolamento, checkout guard, providers, crypto, ambientes, frete/preferência) | **151 testes, 151 pass, 0 fail** |
| Verificação estática do código publicado na v6 | Código local idêntico ao baixado do projeto de homologação (confirmado na Etapa 2) |
| Consulta a Secrets (somente nomes/hashes) | `MP_ENV=sandbox`; `MERCADOPAGO_WEBHOOK_SECRET` presente; URLs de homologação |
| Chamadas à API do Mercado Pago | **NENHUMA** |
| Escritas em banco / RLS / migrations / Secrets | **NENHUMA** |

---

## 2. Tabela de resultados

Legenda: **APROVADO** (evidência local determinística) · **REPROVADO** · **PENDENTE** (depende de autorização) · **NÃO TESTÁVEL** (sem acesso/credencial externa).

### FASE 1 — Configuração dos webhooks

| Teste | Resultado | Evidência | Problemas encontrados | Correção necessária | Classificação |
|---|---|---|---|---|---|
| URL de notificação cadastrada no app MP | — | Não há credencial de acesso ao painel do desenvolvedor MP neste ambiente | Sem acesso externo | Conferir/cadastrar no painel MP (seção 5.1) | **NÃO TESTÁVEL** |
| Eventos "Pagamentos" e "Pedidos comerciais" | — | Não verificável localmente | Sem acesso externo | Habilitar `payment` e `merchant_order` no painel MP | **NÃO TESTÁVEL** |
| Recebimento de notificação de teste | — | Não disparado (depende de autorização) | — | Disparar botão de teste do app MP após autorização | **PENDENTE** |
| Validação de assinatura (HMAC) | 6/6 e testes de webhook | `P1: assinatura válida/inválida/ausente/segredo ausente`; `payment-webhooks-mp.test.ts` — HMAC, replay, `x-request-id` | Nenhum | — | **APROVADO** |
| Leitura de `MERCADOPAGO_WEBHOOK_SECRET` | Presente + código confere | `config()` lê `MERCADOPAGO_WEBHOOK_SECRET`; Secret presente no projeto; 6/6 testes P1 | Mensagem de erro residual ainda diz `MP_WEBHOOK_SECRET não configurado.` (`mercadopago.ts:562`) — cosmético, não bloqueia | Trocar texto do erro (seção 4) | **APROVADO** (com ressalva) |
| Notificações duplicadas | 200 `{duplicate:true}` | `payment-idempotency.test.ts`; `eventKeyFor`/`eventDecision`; `webhooks.ts:379-402` | Nenhum | — | **APROVADO** |
| Resposta HTTP correta | 401 inválida / 200 duplicada / 200 teste | `webhooks.ts:345, 376, 381, 402`; testes de webhook | Comportamento verificado em código e testes, não em runtime | Validação runtime após autorização | **APROVADO** (lógica) / **PENDENTE** (runtime) |

### FASE 2 — Checkout Pro

| Teste | Resultado | Evidência | Problemas | Correção | Classificação |
|---|---|---|---|---|---|
| Identificação do vendedor | OAuth individual preservado | `verifyConnection` → `externalAccountId`; token do vendedor usado na Preference; P3 impede ambiente divergente | — | — | **APROVADO** (código) / **PENDENTE** (runtime) |
| Identificação do comprador | — | `customer_name`/`back_urls` no corpo da Preference | Sem comprovação de runtime | — | **PENDENTE** |
| Valor e moeda | Conferidos | `computeChargeSplit` recusa total ≠ itens+frete; `currencyDecimals`; testes `payment-mp-shipping.test.ts` | — | — | **APROVADO** |
| External Reference | Confirmado | Teste: `body["external_reference"] === ORDER_ID` (`payment-mp-shipping.test.ts:84`) | — | — | **APROVADO** |
| URLs de retorno | Confirmadas | `back_urls.success/pending = returnUrl`, `failure = cancelUrl`, `auto_return:"approved"` — `mercadopago.ts:187-192` | — | — | **APROVADO** |
| Notification URL | Confirmada | Teste: `.../functions/v1/webhooks-mercadopago` derivado de `SUPABASE_URL`; hash de homologação conferido | Não usa helper fail-fast (P5, fora do escopo) | — | **APROVADO** (com ressalva) |
| Credenciais Sandbox individuais | Sandbox confirmado | `MP_ENV` hash = `sandbox`; OAuth por vendedor; nenhum token global de plataforma | — | — | **APROVADO** |
| Redirecionamento para Checkout Pro | — | Requer criação de Preference | — | Executar procedimento 5.2 | **PENDENTE** |
| Criação de preferência de teste | — | Não executada (aguardando autorização) | — | Executar procedimento 5.2 | **PENDENTE** |

### FASE 3 — Pagamento simulado

| Teste | Resultado | Evidência | Problemas | Correção | Classificação |
|---|---|---|---|---|---|
| Pagamento aprovado | — | Requer conta/meios de teste oficiais MP | — | Procedimento 5.3 | **PENDENTE** |
| Pagamento pendente | — | Idem | — | Procedimento 5.3 | **PENDENTE** |
| Pagamento recusado | — | Idem | — | Procedimento 5.3 | **PENDENTE** |
| Cancelamento | — | Idem | — | Procedimento 5.3 | **PENDENTE** |
| Reembolso | — | Sem procedimento Sandbox seguro autorizado | — | Não executar sem autorização específica | **PENDENTE** |

> Nenhum cartão real, dado financeiro real ou credencial de produção foi usado. Nenhuma cobrança foi gerada.

### FASE 4 — Webhook e confirmação (10 itens)

| Teste | Resultado | Evidência | Problemas encontrados | Correção necessária | Classificação |
|---|---|---|---|---|---|
| 1. MP envia a notificação | — | Requer disparo controlado no app Sandbox | Sem disparo autorizado | Procedimento 5.1/5.2 | **PENDENTE** |
| 2. Assinatura validada | 6/6 + webhook tests | HMAC-SHA256, manifesto, janela de 10 min | Nenhum | — | **APROVADO** |
| 3. Consulta à API oficial | Código + testes de resolução | `getPayment`, `resolveNotification` (`merchant_order`), `payment-isolation.test.ts` | Sem execução em runtime | Validar com notificação real | **APROVADO** (lógica) / **PENDENTE** (runtime) |
| 4. Valor conferido | Gate fail-closed | `P2: valores divergentes impedem a confirmação` | Nenhum | — | **APROVADO** |
| 5. Moeda conferida | Gate fail-closed | `P2: moeda divergente impede a confirmação` | Nenhum | — | **APROVADO** |
| 6. Pedido conferido | Gate fail-closed | `P2: pedido incorreto impede a confirmação` (`external_reference`) | Nenhum | — | **APROVADO** |
| 7. Vendedor conferido | Gate fail-closed | `P2: vendedor incorreto impede a confirmação` (`collector_id`) | Nenhum | — | **APROVADO** |
| 8. Status correto no pedido | — | Requer pagamento Sandbox real | Sem pagamento de teste | Procedimento 5.3 | **PENDENTE** |
| 9. Duplicatas não duplicam operações | Chave de evento estável | `eventKeyFor`, `eventDecision`, testes de idempotência | Nenhum | — | **APROVADO** |
| 10. Pagamento inválido nunca aprovado | Gate antes de qualquer escrita | `webhooks.ts`: validação antes de `updateTransaction`/`syncOrderPayment` | Nenhum | — | **APROVADO** |

### FASE 5 — Split 1:1

| Teste | Resultado | Evidência | Problemas | Correção | Classificação |
|---|---|---|---|---|---|
| Vendedor correto recebe / destinatário | — | Código: Preference criada com `credentials.accessToken` do vendedor | **Sem evidência da API Sandbox** — requisito do solicitante não atendido | Obter comprovante da API Sandbox (seção 5.4) | **PENDENTE** |
| Divisão 1:1 sem comissão | Código sem `marketplace_fee` | `buildPreferenceBody`: nenhum `marketplace_fee`; `payment-mp-shipping.test.ts` valida corpo da Preference | Evidência é estática, não da API | Confirmar na resposta da API Sandbox | **PENDENTE** |
| Impossibilidade de direcionar a outro vendedor | Gate P2 + token do vendedor | `P2: vendedor incorreto`; `collector_id` conferido | Validação runtime pendente | Procedimento 5.4 | **PENDENTE** |

> **Não considerado aprovado**: conforme solicitado, a existência do código não basta. É necessária
> evidência da API Sandbox (consulta ao pagamento com `collector_id` e `split`/`marketplace_fee`).

### FASE 6 — Segurança

| Teste | Resultado | Evidência | Problemas encontrados | Correção necessária | Classificação |
|---|---|---|---|---|---|
| Assinatura inválida | Recusada (401) | `P1: assinatura inválida`, `payment-webhooks-mp.test.ts` | Nenhum | — | **APROVADO** |
| Valor divergente | Bloqueado | `P2: valores divergentes impedem a confirmação` | Nenhum | — | **APROVADO** |
| Moeda divergente | Bloqueada | `P2: moeda divergente impede a confirmação` | Nenhum | — | **APROVADO** |
| External Reference incorreta | Bloqueada | `P2: pedido incorreto impede a confirmação` | Nenhum | — | **APROVADO** |
| Collector ID incorreto | Bloqueado | `P2: vendedor incorreto impede a confirmação` | Nenhum | — | **APROVADO** |
| Pagamento duplicado | Bloqueado | `P2: pagamento duplicado`; `payment-idempotency.test.ts` | Nenhum | — | **APROVADO** |
| Token de vendedor inválido | Bloqueado | `payment-checkout-guard.test.ts: token inválido nunca cria cobrança` | Nenhum | — | **APROVADO** |
| Mistura Sandbox/Produção | Bloqueada | `P3: conexão só é válida no mesmo ambiente`; 14 testes de isolamento de URLs | Nenhum | — | **APROVADO** |

---

## 3. Problemas encontrados e correções necessárias

| # | Problema | Impacto | Correção necessária | Prioridade |
|---|---|---|---|---|
| 1 | `mercadopago.ts:562` ainda retorna `reason: "MP_WEBHOOK_SECRET não configurado."` embora a leitura use `MERCADOPAGO_WEBHOOK_SECRET` | Apenas diagnóstico/log; o Secret existe e o fluxo funciona | Alterar o texto para o nome correto | Baixa — **requer autorização** (mudança de código) |
| 2 | P6 da auditoria: parsing de `x-signature` com `Map` (último `v1` vence) | Durante rotação de chave do MP, notificação legítima pode ser recusada | Aceitar qualquer `v1` válido | Fora do escopo P0–P3 |
| 3 | P5 da auditoria: `notification_url` usa `readEnv("SUPABASE_URL") ?? ""` | Sem fail-fast; com `SUPABASE_URL` presente a URL está correta | Usar `paymentsWebhookUrl()` | Fora do escopo P0–P3 |
| 4 | Configuração externa do app MP não verificável por CLI | Impede afirmar que webhook/OAuth estão cadastrados | Conferência manual no painel MP (seção 5.1) | Alta para FASE 1 |
| 5 | Nenhuma evidência de API Sandbox para Split 1:1 | Impede aprovar FASE 5 | Consulta controlada à API Sandbox (seção 5.4) | Alta para FASE 5 |

Nenhum desses problemas foi corrigido nesta etapa — não houve alteração de código, configuração ou ambiente.

---

## 4. Reserva de segurança

- Nenhuma operação financeira foi realizada: **0 preferências criadas, 0 cobranças, 0 pagamentos,
  0 reembolsos, 0 webhooks disparados**.
- Nenhum cartão real ou dado financeiro foi utilizado; nenhuma credencial de produção foi lida.
- Nenhuma chamada foi feita à API do Mercado Pago.
- Nenhuma Secret, variável de ambiente, migration, tabela, política RLS ou configuração externa foi alterada.
- Nenhum commit, push ou modificação de código foi feito. Worktree original intacta.

---

## 5. Procedimentos que aguardam autorização expressa

### 5.1 Configuração externa (FASE 1) — onde você precisa acessar

1. Acesse o **painel do desenvolvedor Mercado Pago**:
   `https://www.mercadopago.com.br/developers/panel/app`
2. Selecione o **aplicativo de homologação** (o mesmo cujas credenciais estão em `MP_CLIENT_ID`/`MP_CLIENT_SECRET` no projeto `ardpqimdllzbbdvwamkh`).
3. Em **Webhooks**, cadastre/confirme:
   - URL: `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago`
   - Eventos: **Pagamentos** (`payment`) e **Pedidos comerciais** (`merchant_order`)
4. Em **Credenciais → OAuth Redirect URL**, cadastre/confirme:
   - `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/payments-callback`
5. Mantenha **PKCE desabilitado** (P14 fora do escopo).
6. O segredo do webhook já está no projeto como `MERCADOPAGO_WEBHOOK_SECRET` — **não crie outro**.
7. Após salvar, use o botão **"Testar" / "Enviar notificação de teste"** do próprio painel MP.
   O código responde `200 {success:true, ignored:"test_event"}` para eventos de teste sem efeitos.

### 5.2 Preferência de teste (FASE 2)

Após autorização: conectar uma conta de vendedor **de teste** em `/painel/pagamentos` (OAuth não cria
cobrança), criar um pedido de teste no frontend de homologação e iniciar o checkout. Antes de gerar a
preferência, confirmar no log que `notification_url`, `external_reference`, `back_urls`, valor e moeda
correspondem ao pedido e que o token usado é o do vendedor de teste (Sandbox).

### 5.3 Pagamentos simulados (FASE 3)

Somente com contas e meios de pagamento **oficiais de teste** do Mercado Pago. Cobertura desejada:
aprovado, pendente, recusado e cancelado. Reembolso somente se houver procedimento Sandbox seguro e
autorização específica.

### 5.4 Evidência de Split 1:1 (FASE 5)

Após um pagamento aprovado em Sandbox, consultar a API oficial com o token do vendedor de teste:
- `GET /v1/payments/{id}` → conferir `collector_id` (deve ser a conta do vendedor conectado),
  `external_reference` (UUID do pedido), `transaction_amount` e `currency_id`.
- Confirmar ausência de `marketplace_fee` / comissão.
- Guardar a evidência (sem expor tokens) no relatório de validação.

---

**Etapa 3 — parte permitida concluída. PARADO, aguardando autorização expressa para qualquer
preferência, checkout, pagamento simulado, reembolso, teste de webhook ao vivo ou configuração externa.**
