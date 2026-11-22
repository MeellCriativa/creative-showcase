# Auditoria e teste do PayPal — Homologação

Data: 21/11/2026  
Escopo: exclusivamente o projeto Supabase de homologação `ardpqimdllzbbdvwamkh`.

---

## 1. Identificação do ambiente

| Item | Resultado |
|---|---|
| Projeto-alvo confirmado antes de cada operação | `ardpqimdllzbbdvwamkh` |
| Nome / status | `vitrine-criativa-homolog` / `ACTIVE_HEALTHY` |
| Produção (`wdcufpvlbisnqtvmbyso`) | **não acessada nesta auditoria** |
| Operações de escrita | nenhuma |
| Deploy / migração / mudança de Secrets / código | nenhuma |
| Cobranças reais | nenhuma |

Todas as consultas usaram `--project-ref` explícito ou helper com `project_ref` explícito. `db query --linked` não foi usado.

---

## 2. Credenciais encontradas (somente nomes)

Valores **não** foram lidos, impressos, registrados nem incluídos neste relatório.

| Secret | Situação em homologação |
|---|---|
| `PAYPAL_CLIENT_ID` | **PRESENTE** |
| `PAYPAL_CLIENT_SECRET` | **PRESENTE** |
| `PAYPAL_PARTNER_ID` | **AUSENTE** |
| `PAYPAL_WEBHOOK_ID` | **AUSENTE** |
| `PAYPAL_ENV` | **AUSENTE** (runtime cai em `sandbox`) |
| `PAYPAL_PARTNER_ATTRIBUTION_ID` | AUSENTE (opcional; o código usa o Partner ID) |

Não há chaves `PAYPAL_*` no `.env` local.

---

## 3. Funcionalidades implementadas (auditoria de código)

| Requisito | Evidência | Situação |
|---|---|---|
| Base Sandbox | `paypal.ts:31-34` — `sandbox → https://api-m.sandbox.paypal.com`, `production → https://api-m.paypal.com` | OK |
| Seleção de ambiente | `paypal.ts:57-62` — `PAYPAL_ENV=production` é o único modo produção; ausente → sandbox | OK (implícito) |
| Isolamento de ambiente | `_shared/payments/index.ts:25-27` (`providerEnvironment`) e `connections.ts:130-175` (connection só vale se `environment` bater com o runtime) | OK |
| Token OAuth | `paypal.ts:106-125` — `POST /v1/oauth2/token`, `client_credentials`, Basic do Client ID/Secret, base derivada do ambiente | Implementado; não executado ao vivo nesta auditoria |
| Criação de pedido | `paypal.ts:547-587` — `POST /v2/checkout/orders`, `PayPal-Request-Id: order-<pedido>`, link `approve`/`payer-action` | Implementado |
| Consulta da ordem | `paypal.ts:589-601` — `GET /v2/checkout/orders/{id}` | Implementado |
| Captura | `paypal.ts:628-679` — `POST .../capture`, `PayPal-Request-Id` fixo, `ORDER_ALREADY_CAPTURED` confirmado por reconsulta | Implementado |
| Reembolso | `paypal.ts:681-719` — chave de idempotência por operação | Implementado |
| Retorno do comprador | `c.$slug.tsx:330-397, 712-754` — `payment=return`, polling de `getPaymentStatus(refresh=1)`; `payments/index.ts:637-684` aplica snapshot oficial com `captureIfAuthorized: true` e devolve `settled`/`failed` | Implementado |
| Retorno do vendedor | `payments-callback/index.ts:86, 170-194` — erro/cancelamento mapeado para rótulo estável; valida state, posse do catálogo e `isConfigured()` | Implementado |
| Webhook | `webhooks-paypal/index.ts` (v12, `ACTIVE`, `verify_jwt=false`) + `paypal.ts:754-822` — validação pela API oficial `/v1/notifications/verify-webhook-signature` com `PAYPAL_WEBHOOK_ID`; **fail-closed** | Implementado, mas inoperante sem o Secret |
| Idempotência de evento | `webhooks.ts:360-425` — chave `(provider, event_id)`; chave separada para assinatura inválida; rate limit no caminho inválido; `payment_events` + `associateEvent`/`finishEvent` | Implementado |
| Registro de estado | `db.ts:483-523` (`createTransaction`), `:678-711` (`updateTransaction`), `:713-734` (`syncOrderPayment` espelha `orders.payment_status`) | Implementado; falha de gravação é propagada |
| Sem mistura Sandbox/Live | Nenhuma URL Live fixa no código; apenas `paypal.ts:33`. `PAYPAL_ENV` ausente → sandbox | Código OK; **natureza das credenciais não comprovada** (ver §5) |

---

## 4. Testes executados e resultados

### 4.1 Suíte local determinística (sem rede real, sem dinheiro real)

`npm test` → **535/535 aprovados, 0 falhas**, 8,3 s. Inclui, entre outros:

- `payment-paypal-capture.test.ts` — criação de ordem com breakdown/frete, captura, estados.
- `payment-providers.test.ts` — `PAYPAL_ENV`, PayPal sem Partner ID / Webhook ID não fica configurado.
- `payment-correcoes-m1-m4-p3-p5.test.ts` — P3/P4/P5: snapshot, merchant, P5 assinatura **somente** pela API oficial, idempotência de captura/reembolso.
- `payment-isolation.test.ts`, `payment-idempotency.test.ts`, `payment-crypto.test.ts`, `payment-currencies.test.ts`.

### 4.2 Verificações ao vivo em homologação (somente leitura)

| Teste | Resultado |
|---|---|
| Confirmação do projeto | `CONFIRMADO ref=ardpqimdllzbbdvwamkh name=vitrine-criativa-homolog status=ACTIVE_HEALTHY` |
| Banco antes do teste | `conn_paypal=0`, `tx_paypal=0`, `eventos_paypal=0`, `estados_paypal=0`, `sessoes=0` |
| Métodos públicos no checkout (loja `pkce-homolog-73ff28d6e9`) | `success=true`, lista vazia → PayPal **não** é oferecido (esperado: provedor não configurado) |
| Webhook com evento forjado (assinatura inválida) | **HTTP 503**, `success=false`, `error="Provedor não configurado."` → **fail-closed confirmado** |
| Banco depois do teste | contagens idênticas → **nenhuma escrita** |
| Funções publicadas | `payments v14`, `payments-callback v14`, `webhooks-mercadopago v14`, `webhooks-paypal v12` — todas `ACTIVE`, `verify_jwt=false` |

### 4.3 Testes SOLICITADOS que NÃO puderam ser executados

| Teste | Motivo |
|---|---|
| Autenticação OAuth com as credenciais configuradas | A Management API expõe apenas nomes dos Secrets; não há valores no `.env` local. Sem sessão de vendedor válida, não há como fazer o backend usar o Client ID/Secret armazenados. |
| Criação de pedido de teste na Sandbox | Depende de provedor configurado (`PAYPAL_PARTNER_ID` + `PAYPAL_WEBHOOK_ID`) e de conexão de vendedor com `merchantIdInPayPal`. |
| Aprovação com conta compradora Sandbox / captura / confirmação no backend | Não foi fornecida conta compradora Sandbox, nem há conexão PayPal (`conn_paypal=0`). |
| Recebimento e validação de webhook assinado | Falta `PAYPAL_WEBHOOK_ID` e a assinatura no Dashboard do PayPal; o teste com evento forjado confirmou apenas o fail-closed. |
| Cancelamento/falha reais | Dependem de checkout Sandbox real. |

Nenhum desses testes foi simulado como "aprovado". Os testes locais com `fetch` mockado **não** substituem validação do provedor.

---

## 5. Problemas encontrados

| # | Severidade | Diagnóstico | Correção recomendada (NÃO aplicada) |
|---|---|---|---|
| P1 | **Bloqueante** | `PAYPAL_PARTNER_ID` ausente → `isConfigured()=false`; `connect` responde 503 e o botão "Conectar PayPal" não habilita o método | Configurar o Partner ID (em Sandbox: account ID da conta sandbox; em produção: Merchant ID da conta parceira aprovada) |
| P2 | **Bloqueante** | `PAYPAL_WEBHOOK_ID` ausente → assinatura não pode ser verificada; endpoint recusa 503 e confirmações ficam só no polling do retorno | Criar webhook no App Sandbox apontando para `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-paypal` com os 5 eventos e salvar o ID como Secret |
| P3 | Médio | `PAYPAL_ENV` ausente → sandbox por padrão, mas sem explicitação | Definir `PAYPAL_ENV='sandbox'` em homologação (e `production` no futuro) |
| P4 | Médio | Não é possível comprovar, sem ler os valores, se o Client ID/Secret presentes pertencem à Sandbox ou à Live. O código usa a base Sandbox; se as credenciais forem Live, o OAuth falhará | Confirmar no Developer Dashboard que o App é **Sandbox** e conferir o resultado do primeiro `connect` |
| P5 | Baixo | Sucesso e cancelamento usam a mesma `returnUrl`; não há mensagem explícita de "cancelado" — o status real vem da consulta oficial no polling | Opcional: distinguir `cancel=1` na URL e exibir mensagem específica (mudança de código — requer autorização) |

---

## 6. O que falta para concluir a integração

**Homologação:**

1. Configurar `PAYPAL_PARTNER_ID` e `PAYPAL_WEBHOOK_ID` (e, idealmente, `PAYPAL_ENV='sandbox'`).
2. Confirmar que as credenciais presentes são do App Sandbox.
3. Conectar a loja pelo painel (`/painel/pagamentos` → Conectar PayPal), conferindo `merchantIdInPayPal`, `permissionsGranted=true` e `payments_receivable`.
4. Habilitar o método no checkout.
5. Executar teste ponta a ponta com conta compradora Sandbox: criar pedido → aprovar → capturar → confirmar status → webhook assinado → cancelamento/falha.

**Produção (fora do escopo desta auditoria):**

6. Aprovação commercial como parceiro PayPal, credenciais Live, `PAYPAL_ENV='production'`.
7. Publicar `webhooks-paypal` em produção (hoje existe apenas em homologação) com `verify_jwt=false`, sem `--prune`, e cadastrar o webhook com a URL de produção.
8. Repetir a validação antes de qualquer cobrança real.

---

## 7. Parecer final

- **Aprovado para avançar?** **Não** para produção nem para cobranças.
- **Homologação:** aprovado apenas para **continuar a configuração**; o teste financeiro ponta a ponta continua bloqueado pelos itens P1/P2.
- O backend PayPal está **implementado e coerente com o ambiente Sandbox**, com token OAuth, criação/captura de ordem, retornos, webhook validado pela API oficial, idempotência e persistência de status.
- Nenhuma alteração foi aplicada nesta auditoria: **sem deploy, sem Secrets alterados, sem migração, sem escrita no banco, sem mudança de código e sem acesso à produção**.
