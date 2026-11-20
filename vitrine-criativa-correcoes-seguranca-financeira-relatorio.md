# Vitrine Criativa — Correções de Segurança Financeira (M1–M4, P3–P5)

**Data:** 20 de novembro de 2026
**Repositório:** `C:\Users\USER\Documents\Default Project`, branch `main`
**HEAD de partida:** `0ba5485`
**Base lida integralmente:** `vitrine-criativa-finalizacao-financeira-relatorio.md`
**Homologação confirmada:** `ardpqimdllzbbdvwamkh` (`vitrine-criativa-homolog`, `ACTIVE_HEALTHY`)
**Produção:** `wdcufpvlbisnqtvmbyso` (`vitrine-criativa`, `ACTIVE_HEALTHY`) — **não alterada**

> **Ponto de parada respeitado:** sem deploy, sem publicação de função, sem alteração de Secrets, sem migração executada, sem OAuth realizado, sem cobrança, sem reembolso real, sem acesso a dado financeiro real e sem liquidação. `webhooks-paypal` continua **sem publicação em produção**.

---

## 1. Escopo, premissas e método

Foram tratadas as lacunas M1–M4 (Mercado Pago) e P3–P5 (PayPal) do relatório base, com código, testes determinísticos e documentação. As premissas registradas antes da implementação foram mantidas:

- M1: **PKCE permanece fora desta etapa**. O fluxo é `authorization_code` com `state` HMAC + nonce; o aplicativo MP deve continuar com PKCE desabilitado. Implementar apenas `code_challenge` sem o ciclo completo do `code_verifier` quebraria a troca do código.
- M2: `scope` **não é enviado na URL**; apenas os escopos efetivamente devolvidos por `/oauth/token` são persistidos.
- M3: não existe endpoint público de revogação do MP confirmado na documentação consultada; a desconexão local sempre acontece e o vendedor é avisado da revogação manual.
- M4: `MLB` continua apenas como padrão da URL de autorização; `site_id` de `/users/me` é a fonte da verdade. Leitura permanece tolerante; escrita falha fechado quando o país não é conhecido.
- PayPal: modelo `client_credentials` + `merchant_id` preservado; isolamento ancorado na transação/catálogo e na conta persistida, não no corpo do webhook.
- Banco: **nenhuma migration foi adicionada, alterada ou executada**. As colunas necessárias (`payment_transactions.catalog_id`, `payment_connections.merchant_id`, `payment_connections.external_account_id`) já existem. RLS e privilégios não foram tocados.

Método: leitura direta do código e das migrações, implementação local, suíte completa `npm test`, suíte específica nova, `git diff --check` e revisão manual do diff. Nenhuma evidência de provedor foi obtida nesta etapa.

---

## 2. M1 — PKCE fora do escopo; CSRF preservado

**Status: decisão registrada cumprida (não implementado).**

- `mercadopago.ts` continua gerando `authorization code` sem `code_challenge` e sem `code_verifier`.
- `payments/index.ts` assina o `state` com `catalog_id`, `user_id`, `provider`, `env`, `nonce` e expiração; não há PKCE nem flags relacionadas.
- `payments-callback/index.ts` continua consumindo o nonce de uso único via `consumeOAuthState()` antes da troca do código.
- Nenhuma coluna/arquivo de migration foi criado para PKCE (a tentativa intermediária foi removida antes do commit).
- Testes: state válido/expirado/adulterado, nonce reutilizado e assinatura MP válida/inválida.

**Risco remanescente aceito:** se o aplicativo MP estiver configurado para exigir PKCE, a conexão falhará. A ação correta é manter PKCE desabilitado no app ou autorizar, em etapa própria, a implementação completa do par challenge/verifier.

---

## 3. M2 — Escopos reais do token

**Status: corrigido.**

- Removido o default sintético `offline_access read write`.
- `mpScopesFromToken()` normaliza `scope` separado por espaço/vírgula, derruba caixa e calcula faltantes contra `offline_access`, `read`, `write`.
- `/oauth/token`: `scope` ausente, vazio ou parcial recusa a conexão com `permissions_not_granted` (traduzido pelo callback para um código estável na URL).
- `refresh`: se o provedor devolver `scope`, ele é revalidado; se não devolver, os escopos conhecidos são preservados e sinalizados em `capabilities.scopes_known`, evitando expiração em massa de conexões legadas.
- Nenhum `scope` é injetado na URL de autorização.

**Arquivos:** `supabase/functions/_shared/payments/mercadopago.ts`, `tests/payment-correcoes-m1-m4-p3-p5.test.ts`.

---

## 4. M3 — Revogação honesta e desconexão confiável

**Status: corrigido.**

- Novo contrato `RevokeResult { remoteRevoked, manualRequired, reason? }` em `types.ts`.
- `revoke()` do MP e do PayPal retorna `remoteRevoked: false` e `manualRequired: true`; nenhum endpoint inventado (`/oauth/credentials` não existe no código).
- `disconnectAction` sempre chama `deleteConnection()`, mesmo se a revogação remota falhar; erro é logado com mensagem controlada e o contrato estável é devolvido.
- Frontend: `disconnectProvider` passou a tipar `{ revocation? }`; o painel exibe aviso traduzível em pt/en/es orientando a revogação manual na conta do provedor.

**Arquivos:** `types.ts`, `mercadopago.ts`, `paypal.ts`, `supabase/functions/payments/index.ts`, `src/lib/payments.ts`, `src/routes/painel.pagamentos.tsx`, `src/i18n/namespaces/payments.ts`, `tests/payment-homologacao-final.test.ts`.

---

## 5. M4 — Site da conta e moeda de liquidação

**Status: corrigido.**

- `connectAction` aceita `site_id` opcional e valida contra `MERCADOPAGO_SITE_CURRENCIES`; valor inválido é recusado com 400. O site informado entra no `state` assinado e na URL.
- Sem `site_id` informado, a URL mantém o padrão `MLB`.
- `verifyConnection()` passou a preservar `site_id`/`country_id` já persistidos quando `/users/me` omite esses campos — antes isso apagava a capacidade e tornava a checagem de moeda permissiva.
- `checkCurrencySupport()` ganhou `requireKnownSite`: habilitar método e criar cobrança falham fechado com `account_site_unknown` se o país de liquidação não for conhecido. Leituras do painel/checkout continuam fail-open para não apagar conexões legadas.
- Divergência entre site solicitado e site oficial sinaliza `site_mismatch=1` no callback e exibe aviso no painel (pt/en/es).

**Arquivos:** `currencies.ts`, `mercadopago.ts`, `payments/index.ts`, `payments-callback/index.ts`, frontend i18n/painel.

---

## 6. P3 — PayPal: origem da referência e da conta

**Status: corrigido.**

- `paypalSnapshotFromOrder()` passou a extrair da **ordem oficial**:
  - `externalReference` de `custom_id` (com fallback para `reference_id`);
  - `sellerAccountId` de `purchase_units[0].payee.merchant_id` (com fallback para a captura).
- `resolveNotification()` também devolve `sellerAccountId` quando a consulta oficial o informa.
- `requireOrderReference` e `requireSellerAccount` deixaram de ser MP-only: valem para os dois provedores antes de qualquer captura/confirmação.

O corpo do webhook continua sem valor probatório; ele apenas dispara a consulta oficial.

---

## 7. P4 — Isolamento por loja/vendedor

**Status: corrigido.**

- Nova primitive `paypalAccountMatchesConnection()` compara `payee.merchant_id` da ordem oficial com `merchant_id`/`external_account_id` da conexão **da loja da transação**. A comparação é exata (apenas `trim`), sem derrubar caixa.
- `applyOfficialSnapshot()` recusa com `paypal_merchant_mismatch` antes de capturar/confirmar se a conta oficial não pertence à conexão carregada.
- `processVerifiedEvent()` faz defesa em profundidade: se a notificação resolvida traz conta, ela é comparada com `getConnection(transaction.catalog_id, "paypal")`; divergência vira `cross_seller_event` com HTTP 200 e nenhum efeito.
- O fallback de conta (`credentialsForNotification`, MP-only) não foi aplicado ao PayPal.

**Testes:** merchant correto, merchant diferente, merchant ausente, merchant diferente apenas em caixa, conexão ausente e cenários de catálogo cruzado da suíte existente.

---

## 8. P5 — Duplicidade, valores, moeda, status e reembolso

**Status: corrigido.**

- Gate de confirmação executa antes de `syncOrderPayment()`: divergência de valor/moeda ou propriedade bloqueia a atualização do pedido. A ordem foi verificada por leitura de código no teste (`gateAt < syncAt`).
- Webhook duplicado: `eventDecision()` → `duplicate` com 200 e sem reprocessamento; evento falho → `reprocess`; assinatura inválida → `reject`.
- Assinatura PayPal: apenas `POST /v1/notifications/verify-webhook-signature` com `auth_algo`, `cert_url`, `transmission_id`, `transmission_sig`, `transmission_time` e `webhook_id` decide validade; `FAILURE` recusa.
- Captura duplicada reutiliza `PayPal-Request-Id: capture-<orderId>` e reconhece `ORDER_ALREADY_CAPTURED` sem criar segunda captura.
- Reembolso duplicado reutiliza a chave `operation_id`; confirmação e ledger monotônicos permanecem da suíte anterior (F/R-01/R-02).
- Tolerância de valor permanece em 1 unidade mínima; divergência maior e moeda errada são recusadas.

---

## 9. Banco, RLS, Secrets e publicação

**Status: nenhuma alteração.**

- Nenhuma migration nova: a coluna PKCE cogitada foi descartada; nenhum `ALTER`, `DROP`, `GRANT` ou mudança de RLS foi introduzido.
- Nenhum dado financeiro, conexão, transação, evento ou reembolso foi lido ou escrito em produção/homologação.
- Nenhum Secret foi lido, impresso, alterado ou criado. A CLI continua devolvendo valores cifrados, o que impede assinaturas locais válidas contra endpoints reais.
- Nenhuma Edge Function foi publicada ou redeployada. `webhooks-paypal` permanece ausente em produção.
- Nenhuma cobrança, reembolso ou liquidação foi executada.

---

## 10. Testes, diffs e estados de aprovação

### 10.1 Execução

| Comando | Resultado |
| --- | --- |
| `node --test tests/payment-correcoes-m1-m4-p3-p5.test.ts` | 21/21 aprovados |
| `npm test` | **511/511 aprovados** (490 anteriores preservados + 21 novos) |
| `git diff --check` | limpo |
| Revisão manual do `git diff` | concluída; sem segredos, IDs reais ou conteúdo financeiro |

Novo arquivo: `tests/payment-correcoes-m1-m4-p3-p5.test.ts`. Todos os testes usam `fetch` stubado, HMAC local e contadores em memória; **mock não é apresentado como aprovação do provedor**.

### 10.2 Cenários obrigatórios cobertos

- state válido, expirado e adulterado; nonce reutilizado; assinatura MP válida/inválida.
- Token inválido/expirado e refresh sem permissões.
- Vendedores/merchants diferentes e merchant ausente/diferente em caixa.
- Webhook duplicado; assinatura PayPal válida/inválida via API oficial.
- Valor divergente, moeda errada e conta divergente bloqueando confirmação.
- Captura duplicada e reembolso duplicado com a mesma chave de idempotência.
- Isolamento entre catálogos e gate antes da alteração de status do pedido.

### 10.3 Distinção explícita dos estados

| Estado | Status nesta entrega | Base/consequência |
| --- | --- | --- |
| **Segurança corrigida** | **SIM — no código** | M2, M3, M4, P3, P4 e P5 implementados e cobertos por testes; M1 mantido fora por decisão, com risco documentado. |
| **Testes locais aprovados** | **SIM** | 511/511 com mocks determinísticos. Não provam comportamento de produção. |
| **Sandbox aprovado** | **NÃO** | Sem OAuth de vendedora, catálogo utilizável em homologação, contas PayPal e webhook publicado. Nenhum fluxo sandbox ponta a ponta foi executado. |
| **OAuth conectado** | **NÃO** | Nenhuma conta de vendedor foi autorizada; `payment_connections` não foi populada por esta entrega. |
| **Pagamento ponta a ponta comprovado** | **NÃO** | Nenhuma preferência/ordem foi paga; nenhuma captura real foi confirmada. |
| **Liquidação financeira comprovada** | **NÃO** | Nenhum valor foi recebido, capturado, reembolsado ou conciliado em conta real. |

### 10.4 Conclusão

A entrega é um **endurecimento de código com validação local**, não uma habilitação financeira. Antes de qualquer cobrança real ainda é necessário: configurar Secrets/aplicativo MP, realizar OAuth da vendedora, verificar a conexão, manter PKCE desabilitado (ou autorizar implementação futura), publicar `webhooks-paypal` se usado, executar fluxo sandbox ponta a ponta e somente então autorizar um pagamento real de validação com valor, moeda e conta definidos pelo usuário.

**Afirmação correta até aqui:** segurança corrigida no código e testes locais aprovados; nada além disso está comprovado.
