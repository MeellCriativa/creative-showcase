# Mercado Pago — homologação final (auditoria, correção e comprovação)

**Data:** 20/11/2026
**Ambiente:** homologação — Supabase `ardpqimdllzbbdvwamkh` (`vitrine-criativa-homolog`), worker `https://vitrine-homolog.meellcriativa.workers.dev`
**Produção (`wdcufpvlbisnqtvmbyso`):** NÃO acessada, consultada, modificada, implantada nem testada. Nenhum comando sem `--project-ref ardpqimdllzbbdvwamkh` foi executado contra Supabase.
**Publicação:** nenhum commit, nenhum push, nenhum deploy. Worktree isolada `mp-correcoes-p0-p3`, HEAD `69b642e`.

## Veredito

**HOMOLOGAÇÃO NÃO APROVADA.**

O objetivo solicitado — comprovar que uma vendedora conecta sua própria conta e recebe diretamente os pagamentos — **não foi comprovado**. Não existe conta de vendedor conectada em homologação (`payment_connections = 0`), o painel do Mercado Pago exige login (sem credenciais fornecidas) e a etapa atual proíbe deploy. Consequentemente, OAuth ponta a ponta, pagamento Sandbox, liquidação Split 1:1, webhook real e reembolso não puderam ser executados.

A auditoria encontrou e corrigiu **localmente** um defeito crítico que impedia qualquer criação de pagamento: `createPaymentAction` usava `order.id` antes da declaração de `order` (zona morta temporal / TDZ). A correção e 4 testes de regressão estão no disco, **não publicados**.

---

## 1. Plano executado

1. Leitura de `mercadopago-aprovacao-final.md` e dos relatórios anteriores.
2. Inspeção do working tree (`git status`, `git log`) e mapeamento completo das funções OAuth/checkout/webhook/refund.
3. Auditoria remota somente leitura: funções publicadas, Secrets (nomes/hashes), contagens e RLS das tabelas financeiras, com `--project-ref ardpqimdllzbbdvwamkh`.
4. Tentativa de acesso ao painel do Mercado Pago para P7 — encontrou tela de login.
5. Correção do único defecto comprovável e relacionado às pendências (TDZ do checkout), com testes de regressão.
6. Suíte completa, `git diff --check` e este relatório.

---

## 2. Classificação dos requisitos

Legenda: **APROVADO** · **REPROVADO** · **PENDENTE** · **NÃO TESTÁVEL**. Cada requisito recebe uma única classificação; os detalhes seguem na evidência.

| Req. | Requisito | Classificação | Evidência / limite |
|---|---|---|---|
| **P1** | OAuth do vendedor ponta a ponta, persistência, isolamento, renovação e revogação | **PENDENTE** | Código revisado (state HMAC + nonce, troca `authorization_code`, refresh, AES-GCM) e testes locais aprovados. `payment_connections=0`, `payment_oauth_states=0`: nenhuma conta de teste foi autorizada. Sem login no painel não há como criar/authorizar vendedor de teste. Renovação existe em código; revogação remota **não existe na API MP documentada** — a desconexão é local e o vendedor deve remover o app na própria conta. |
| **P2** | Checkout Pro com token OAuth do vendedor conectado | **REPROVADO** | Defeito crítico comprovado no código revisado: `order.id` em `payments/index.ts:358` antes de `const order` (`:371`) — TDZ quebra a criação da preferência. Corrigido localmente para `orderId`, com teste de regressão, **sem deploy permitido**. O código publicado v8 não pôde ser baixado para confirmação (`UnsafeFunctionDownloadPathError` da CLI). Não há execução real com vendedor conectado. |
| **P3** | Pagamento Sandbox (aprovado/rejeitado/intermediário) e atualização do pedido | **PENDENTE** | Sem token OAuth de vendedor não há cobrança. Evidência anterior: `client_credentials` da aplicação foi recusado pelo MP (`403 The request could not be completed.` em `card_tokens`; `403 At least one policy returned UNAUTHORIZED.` em `payments`). Nenhum pagamento Sandbox foi concluído; `payment_transactions=0`. |
| **P4** | Split 1:1 com liquidação de 100% na conta da vendedora | **NÃO TESTÁVEL** | Configuração documentada e coerente: token do vendedor em `createPayment`, nenhum `marketplace_fee` enviado, resposta real da API Sandbox para a preferência `467889772-aa07ee7a-23bb-443a-b43c-ff7536c867e6` trouxe `marketplace_fee: 0`, `external_reference: 6fc484c7-b652-4358-9570-86182f1e5a95` e `notification_url` de homologação. Isso prova a **configuração**, não a liquidação. Sem pagamento aprovado não há `GET /v1/payments/{id}` com `collector_id`/valor/moeda/split. Conforme solicitado, não classificado como APROVADO. |
| **P5** | Webhooks reais de Sandbox, assinatura, idempotência, replay, associação e atualização financeira | **PENDENTE** | Validação sintética já executada e aprovada na etapa anterior (401 inválido, 200 válido/duplicata, replay 401). Nenhuma notificação **real** do MP foi recebida: a documentação oficial informa que pagamentos de teste não disparam `notification_url`, exigindo o botão “Simular notificação” do painel — inacessível sem login. `payment_events=0` após a limpeza da etapa anterior. |
| **P6** | Reembolso Sandbox e reconciliação com vendedor/pagamento | **NÃO TESTÁVEL** | Não existe pagamento Sandbox aprovado para reembolsar. Estrutura de ledger/idempotência por operação existe em código e testes, mas nenhuma operação real foi executada; `payment_refunds=0`. |
| **P7** | Configuração externa do painel MP (Redirect URI, Webhook, eventos, Marketplace, KYC, credenciais) | **NÃO TESTÁVEL** | `https://www.mercadopago.com.br/developers/panel/app` redirecionou para `/login/identification` nesta data. Nenhuma configuração foi presumida correta. Requisitos documentados na seção 5. |

Classificações complementares de segurança/qualidade:

| Área | Classificação | Evidência |
|---|---|---|
| Isolamento homologação × produção e Secrets | **APROVADO** | Todos os comandos remotos com `--project-ref ardpqimdllzbbdvwamkh`; nomes/hashes conferidos sem valores: `MP_ENV`=sandbox, `SUPABASE_URL`/`VITRINE_URL` de homologação, `MERCADOPAGO_WEBHOOK_SECRET`, `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `PAYMENT_TOKEN_ENCRYPTION_KEY`, `PAYMENT_STATE_SECRET`. |
| RLS das tabelas financeiras | **APROVADO** | `orders`, `payment_connections`, `payment_oauth_states`, `payment_refunds`, `payment_transactions`, `payment_events` com `RLS=true`; políticas owner-only. Nenhuma política anônima de INSERT em `orders` em homologação. |
| Suíte automatizada local | **APROVADO** | **490 testes / 490 aprovados / 0 falhas** (486 do baseline + 4 novos). Nenhum teste excluído ou enfraquecido. |
| `git diff --check` | **APROVADO** | Limpo, sem erros. |

---

## 3. Defeito encontrado e correção

**Defeito (comprovado por leitura do código):** em `supabase/functions/payments/index.ts`, a chave de idempotência da tentativa introduzida pela correção P4 usava `order.id` na linha 358, enquanto `order` só é declarado na linha 371. Em JavaScript isso é erro de zona morta temporal (`ReferenceError: Cannot access 'order' before initialization`) e em TypeScript erro de “used before declaration”. Resultado: **toda chamada `create_payment` falharia antes de criar a preferência**.

**Correção aplicada (somente no disco):**

```ts
const attemptDigest = await sha256Hex(
  `${orderId}|${provider}|${providerEnvironment(provider)}|${token}`,
);
```

`orderId` já é validado no início da função (linha 345), mantém a estabilidade da chave por tentativa e não altera o contrato da API.

**Teste de regressão criado:** `tests/payment-homologacao-final.test.ts` (4 testes):
1. nenhuma referência a `order.` antes da declaração e uso de `${orderId}` na chave;
2. `createPayment` recebe `loaded.credentials` (token OAuth do vendedor) e o provedor MP não usa `client_credentials`;
3. corpo da preferência sem `marketplace_fee`, com `external_reference`, `notification_url`, `back_urls`, `auto_return` e `metadata` corretos;
4. renovação via `refresh_token` e ausência de revogação programática fictícia (documentação oficial prevê revogação apenas na conta do vendedor).

**Não foram alterados:** PayPal, migrações, RLS, Secrets, dados existentes, funções publicadas. Nenhuma função temporária foi criada nesta etapa.

**Limitação crítica:** como a etapa proíbe deploy, o código publicado **não** contém a correção. A menos que uma etapa autorizada publique este diff, o checkout de homologação permanece quebrado. Tentativa de baixar o bundle publicado para confirmar a presença do bug falhou com `UnsafeFunctionDownloadPathError` (`source/src/lib/currency.ts`) na CLI v2.198.0.

---

## 4. Resultados consolidados

| Item | Resultado |
|---|---|
| Total de testes | **490 aprovados, 0 reprovados** (486 anteriores + 4 novos) |
| Testes de integração real (REST Sandbox) | **Nenhum executado nesta etapa**; os anteriormente executados (preferência/consulta) continuam documentados, sem pagamento |
| OAuth | **Não executado** — `payment_connections=0`, sem conta de vendedor de teste/sessão no painel |
| Checkout | **Não executado**; defeito TDZ encontrado e corrigido localmente, sem deploy |
| Pagamentos Sandbox | **Nenhum** — token de aplicação recusado pelo MP (403), sem token OAuth |
| Split 1:1 | Configuração evidenciada (`marketplace_fee:0`, preferência real); liquidação **não comprovada** |
| Webhooks | Somente validação sintética da etapa anterior; nenhuma notificação real |
| Reembolsos | **Nenhum** — sem pagamento aprovado |
| Funções publicadas | `payments`, `payments-callback`, `webhooks-mercadopago`, `webhooks-paypal` v8 ACTIVE; `melhor-envio*` v22 ACTIVE; todas `verify_jwt=false` |
| Dados de teste | Nenhuma linha criada/removida nesta etapa; contagens inalteradas: `orders=2`, demais tabelas financeiras `0` |

---

## 5. Requisitos de configuração externa (P7) — documentação, não verificação

Fonte: documentação oficial Mercado Pago Developers (OAuth, Split 1:1, Checkout Pro Preferences, notificações) e relatórios anteriores.

| Item | Valor/requisito para homologação |
|---|---|
| Redirect URI (OAuth) | `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/payments-callback` |
| Webhook URL | `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago` |
| Eventos | **Pagamentos** (`payment`) e **Ordens comerciais** (`topic_merchant_order_wh`) |
| Modelo da aplicação | **Marketplace**, não “Checkout Pro” simples; PKCE desabilitado enquanto não implementado |
| Segredo do webhook | Usar o já existente `MERCADOPAGO_WEBHOOK_SECRET`; **não renovar** sem atualizar o Supabase |
| Split | OAuth individual obrigatório; sem `marketplace_fee` = comissão zero (1:1). `1:N` é produto diferente |
| Vendedores | KYC nível 6 / credenciamento aprovado para receber |
| Contas e cartões de teste | Contas oficiais de teste por aplicação (API `users/test_user`) e cartões oficiais (ex.: Visa aprovado `4235 6477 2802 5682`); nunca cartões reais |
| Notificações | Pagamentos de teste **não** disparam `notification_url`; disparar pelo botão “Simular notificação” do painel |
| Restrição de credenciais | `MP_CLIENT_ID`/`MP_CLIENT_SECRET` apenas para OAuth/refresh; `client_credentials` **não** substitui token do vendedor para cobrar (403 confirmado) |

Nada disso foi verificado no painel: a URL exigiu login.

---

## 6. Pendências restantes (bloqueantes)

1. **Fornecer/disponibilizar uma conta de vendedor de teste** (ou login no painel MP) para executar OAuth real e confirmar `payment_connections ≥ 1`, `collector_id`, refresh e revogação pelo vendedor.
2. **Autorizar deploy** da correção do TDZ em homologação; sem isso o checkout não funciona.
3. Configurar/confirmar no painel MP: Redirect URI, Webhook URL, eventos, modelo Marketplace e KYC do vendedor.
4. Após (1)–(3): criar pedido → preferência com token do vendedor → pagamento Sandbox aprovado; conferir `back_urls`, `external_reference`, `notification_url`.
5. Consultar `GET /v1/payments/{id}` com o token do vendedor: `status`, `collector_id`, valor, moeda, ausência de comissão.
6. Disparar notificação simulada pelo painel; validar assinatura, idempotência, replay e atualização de `orders`.
7. Executar reembolso total/parcial Sandbox e reconciliação.
8. Somente após todas as evidências, reavaliar promoção — em etapa separada e explicitamente autorizada.

---

## 7. Reserva de segurança

- Nenhuma operação em produção; nenhum deploy, commit ou push.
- Nenhum pagamento real, cartão real ou cobrança de cliente.
- Nenhum token, Secret ou credencial revelado; CLI mostrou apenas nomes/hashes.
- Nenhum dado existente excluído; nenhuma migração executada; PayPal intacto.
- Nenhuma função temporária criada nesta etapa.
- `git diff --check`: limpo.

**Aprovação financeira não é concedida. Aguardando avaliação.**
