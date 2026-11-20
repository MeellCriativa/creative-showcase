# Vitrine Criativa — Relatório: Ativação Financeira em Produção

**Data:** 20 de novembro de 2026
**Repositório:** `C:\Users\USER\Documents\Default Project`, branch `main`
**Produção:** Supabase `wdcufpvlbisnqtvmbyso` · frontend `https://vitrine.meellcriativa.workers.dev`
**Homologação:** Supabase `ardpqimdllzbbdvwamkh`
**Resultado:** **NÃO HÁ ATIVAÇÃO FINANCEIRA.** Integrações implementadas e testadas localmente, mas **desativadas e sem comprovação financeira em produção**. Pontos de parada por credenciais, conta da vendedora, painéis dos provedores, configuração manual e cobrança real foram respeitados.

> Não é correto afirmar que Mercado Pago ou PayPal estão funcionando em produção. Não houve OAuth de vendedora, nenhuma cobrança real ou de Sandbox, nenhum webhook válido recebido, nenhum pedido marcado como pago pelo provedor e nenhuma liquidação comprovada.

---

## 1. Estado inicial (auditoria)

### 1.1 Git e escopo

- HEAD no início: `b000496` — “Avisa sobre nova geração do QR Code ao alterar o link da loja”.
- `git status --short`: limpo.
- `git diff --stat 65c8a87..HEAD`: **somente QR Code** (`qr-code`, i18n, testes, atalho no painel, dependências e relatório). Nenhuma alteração financeira desde `65c8a87`.
- QR Code preservado: rota `/painel/qr-code` responde no frontend publicado; último deploy do worker nesta sessão: **Versão `a1915429-86ff-4f5d-a80b-77daeff65b1a`**. O aviso sobre troca de link está incluído nessa versão.
- Relatórios obrigatórios lidos integralmente:
  - `vitrine-criativa-publicacao-producao-relatorio.md`
  - `vitrine-criativa-finalizacao-financeira-relatorio.md`
  - `vitrine-criativa-correcoes-seguranca-financeira-relatorio.md`
  - Complementar: `vitrine-criativa-qr-code-relatorio.md` (para confirmar a preservação).

### 1.2 Edge Functions em produção (`supabase functions list`)

| Função | Status | Versão | `verify_jwt` |
|---|---:|---:|---|
| `payments` | ACTIVE | 1 | `false` |
| `payments-callback` | ACTIVE | 1 | `false` |
| `webhooks-mercadopago` | ACTIVE | 1 | `false` |
| `melhor-envio` | ACTIVE | 10 | `false` |
| `melhor-envio-callback` | ACTIVE | 5 | `false` |
| **`webhooks-paypal`** | **AUSENTE** | — | — |

Homologação: `payments`, `payments-callback`, `webhooks-mercadopago` e `webhooks-paypal` ativas na versão 8; `melhor-envio*` na 22. **Versões de homologação não foram promovidas** (critério: não publicar versão incompleta nem não validada).

### 1.3 Secrets — somente nomes (valores nunca lidos, impressos ou registrados)

**Produção `wdcufpvlbisnqtvmbyso`:** somente `ME_CLIENT_ID`, `ME_CLIENT_SECRET`, `ME_ENV`, `VITRINE_URL` e os gerenciados pelo Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWKS`, `SUPABASE_DB_URL`).

**Faltando em produção:** `MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_ENV`, `MERCADOPAGO_WEBHOOK_SECRET`, `PAYMENT_STATE_SECRET`, `PAYMENT_TOKEN_ENCRYPTION_KEY`; `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_PARTNER_ID`, `PAYPAL_PARTNER_ATTRIBUTION_ID` (opcional), `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV`.

**Homologação `ardpqimdllzbbdvwamkh`:** possui os 6 secrets de Mercado Pago acima e `ME_*`; **nenhum secret PayPal**. Credenciais de homologação **não** devem ser reaproveitadas em produção.

### 1.4 Tabelas financeiras e dados (produção)

7 tabelas existem, todas com RLS habilitado: `payment_connections`, `payment_transactions`, `payment_events`, `payment_refunds`, `payment_oauth_states`, `payment_rate_limits`, `order_checkout_sessions`. Políticas de leitura são owner-only (`*_owner_select`); conexões só permitem ao dono alterar `enabled`; tabelas de sessão/estado/rate-limit são somente backend.

| Tabela | Linhas |
|---|---:|
| `payment_connections` | **0** |
| `payment_transactions` | **0** |
| `payment_events` | **0** |
| `payment_refunds` | **0** |
| `order_checkout_sessions` | **0** |
| `payment_oauth_states` | **0** |
| `payment_rate_limits` | 10 |

`orders`: 17 pedidos, todos com `payment_status = pending` e `payment_provider = null`. Nenhum pedido foi marcado como pago.

### 1.5 Sondas HTTP em produção (somente leitura)

| Endpoint | Resultado |
|---|---|
| `GET /functions/v1/payments?action=methods&slug=meell-criativa` | `200` — `currency: BRL`, `methods: []` (fail-closed) |
| `GET /functions/v1/webhooks-mercadopago` | `503` (provedor não configurado) |
| `GET /functions/v1/webhooks-paypal` | `404` (função inexistente) |
| `GET /functions/v1/payments-callback?state=invalid&code=invalid` | redireciona para o painel com `connected=0&error=invalid_state` |
| `GET /painel/qr-code` (worker) | `200` — “QR Code da Minha Loja — Vitrine Criativa” |

### 1.6 Código — controles já presentes (não reimplementar)

- AES-256-GCM para tokens em `payment_connections` (`_shared/payments/crypto.ts`); `state` HMAC-SHA256 com segredo separado, `catalog_id`/`user_id`/`provider`/`env`/`nonce`/`exp` (15 min) e nonce atômico de uso único no callback.
- Isolamento por ambiente (`MP_ENV`/`PAYPAL_ENV`), por loja e por moeda; URL de retorno por origem exata; Notification URL derivada do `SUPABASE_URL` do runtime (validação contra vazamento homologação → produção).
- Recálculo oficial de preços, variações, frete, moeda, subtotal e total no backend (`orders.ts`/`pricing.ts`); o navegador envia somente `catalog_id`, dados do cliente e itens. Exceção: fallback `insertOrderDirectly` grava pedido com valores do navegador quando a função `payments` está indisponível — depende da RLS `orders_anon_insert` endurecida.
- Idempotência de evento, de cobrança ativa por pedido (inclusive entre provedores), de sessão de checkout de uso único, de captura e de reembolso (`operation_id` persistido antes da chamada).
- Webhook MP verifica assinatura HMAC do manifesto com `MERCADOPAGO_WEBHOOK_SECRET` (rotação de `v1`, janela de replay) e **consulta a API oficial**; nunca confia no corpo. Webhook PayPal valida assinatura pela API oficial `/v1/notifications/verify-webhook-signature` com `PAYPAL_WEBHOOK_ID` (fail-closed) e confirma valor/moeda/pedido/conta contra a ordem oficial.
- Gate fail-closed: divergência de valor, moeda, pedido ou vendedor impedem a confirmação; captura duplicada usa a mesma chave; reembolso é monotônico (o saldo nunca regrede).

### 1.7 Decisão M1 (documentada, não alterada)

M1 = **ausência de PKCE no OAuth do Mercado Pago**. A proteção atual é `state` assinado + nonce. A decisão registrada é **manter PKCE desabilitado** no aplicativo MP; implementar apenas `code_challenge` sem o ciclo do `code_verifier` quebraria a troca. Se o app MP exigir PKCE, a conexão falhará — nesse caso é necessária autorização específica para implementar o par completo. Nesta auditoria M1 **foi preservado como decisão documentada**; não há risco impeditivo desde que o app de produção fique com PKCE desligado.

---

## 2. Alterações realizadas nesta etapa

**Nenhuma alteração em código financeiro, banco, secrets, OAuth, webhooks ou funções publicadas.** A atuação foi estritamente de auditoria, testes e documentação:

- Leitura dos 3 relatórios obrigatórios + relatório do QR Code.
- Verificação de `main`, do diff desde `65c8a87`, de funções, secrets (nomes), tabelas, RLS, dados e endpoints.
- Auditoria de código financeiro (Edge Functions, frontend, SQL, testes).
- `npm test`: **519/519 aprovados** (9,0 s), incluindo suítes MP/PayPal/webhook/reembolso/isolamento/QR Code.
- `git diff --check`: limpo.
- Criação deste relatório.

Na etapa imediatamente anterior (fora do escopo financeiro, a pedido do usuário) foi publicado o aviso sobre troca de link na tela de QR Code: commit `b000496`, worker versão `a1915429…`. Essa mudança foi preservada.

---

## 3. Mercado Pago — situação e próximos passos

**Situação:** código pronto, credenciais ausentes em produção, app de produção não configurado, nenhuma conexão OAuth, nenhum pagamento. Split 1:1 implementado como **ausência de `marketplace_fee`** na preferência e uso exclusivo do token OAuth da vendedora — ou seja, sem comissão, com `collector_id` da conta conectada. **Não há liquidação comprovada**; o modelo depende de confirmação no painel MP de que a conta creditada é da vendedora e que não há cobrança de comissão.

### 3.1 Secrets a configurar no projeto de produção

Painel: Supabase → projeto `wdcufpvlbisnqtvmbyso` → **Project Settings → Edge Functions → Secrets**. Alternativa com CLI (somente você executa, com os valores): `supabase secrets set --project-ref wdcufpvlbisnqtvmbyso NOME=valor`.

| Secret | Onde obter |
|---|---|
| `MP_CLIENT_ID` | App de produção no painel do Mercado Pago |
| `MP_CLIENT_SECRET` | Mesmo app (somente o titular deve ver/copiar) |
| `MP_ENV` | Valor literal `production` (qualquer outro cai em Sandbox) |
| `MERCADOPAGO_WEBHOOK_SECRET` | “Secret signature” exibida em **Webhooks** dentro do app MP |
| `PAYMENT_STATE_SECRET` | Valor alto aleatório gerado por você (HMAC do `state`); nunca reutilizar o da criptografia |
| `PAYMENT_TOKEN_ENCRYPTION_KEY` | Chave AES-256 aleatória gerada por você; **não reutilizar** `PAYMENT_STATE_SECRET` |

### 3.2 Aplicativo Mercado Pago (configuração manual no painel oficial)

Painel de aplicativos: https://www.mercadopago.com.br/developers/panel/app

- Redirect URI OAuth:
  `https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/payments-callback`
- Webhook URL:
  `https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/webhooks-mercadopago`
- Eventos: `payment` e `merchant_order`.
- **PKCE desabilitado** (decisão M1) ou autorização explícita para implementá-lo.
- Escopos OAuth a conceder: `offline_access`, `read`, `write` (o código exige os três; ausência/parcialidade falha fechado).
- Confirmar que `MP_ENV=production` e que o app é de produção, não de teste.

### 3.3 OAuth e verificação

1. Entre em `https://vitrine.meellcriativa.workers.dev/painel/pagamentos` **com a conta da vendedora** e clique em conectar Mercado Pago. Não compartilhe senha, código ou token; a autorização deve acontecer no navegador da titular.
2. Após o retorno, conferir no painel: conexão associada à loja correta, conta exibida mascarada, `connected=true`, `enabled=true`, ambiente `production`, moeda `BRL`, escopos completos e `permissionsGranted`/`scope` confirmados pela API oficial.
3. Confirmar no painel MP que o `collector_id`/conta creditada é da vendedora, que não há comissão e que o país é `MLB`/Brasil. **Se o Split 1:1 não estiver disponível ou a conta recebedora não puder ser confirmada, parar e decidir a alternativa antes de qualquer cobrança** — não substituir o modelo silenciosamente.
4. Somente então o `methods` deverá passar a anunciar os meios MP. Validação: `GET /functions/v1/payments?action=methods&slug=<slug>`.

---

## 4. PayPal — situação e próximos passos

**Situação:** código implementado, mas **nenhum secret PayPal existe em nenhum dos dois projetos**, `webhooks-paypal` não está publicada em produção, não há Partner ID aprovado, merchant, onboarding de vendedora, webhook ID nem captura. Nada pode ser habilitado.

### 4.1 Secrets a configurar no projeto de produção

| Secret | Onde obter |
|---|---|
| `PAYPAL_CLIENT_ID` | App REST de produção no PayPal Developer Dashboard |
| `PAYPAL_CLIENT_SECRET` | Mesmo app |
| `PAYPAL_PARTNER_ID` | Conta de parceiro PayPal (Partner Program / Complete Payments Platform) |
| `PAYPAL_PARTNER_ATTRIBUTION_ID` | Opcional; se ausente, o código usa o `PAYPAL_PARTNER_ID` |
| `PAYPAL_WEBHOOK_ID` | ID do webhook criado no mesmo app/dashboard |
| `PAYPAL_ENV` | Valor literal `production` (qualquer outro cai em Sandbox) |

Dashboard: https://developer.paypal.com/dashboard/applications
Documentação de verificação de assinatura: https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post

### 4.2 Publicação e webhook

- Publicar `webhooks-paypal` **somente depois** de: secrets presentes, aprovação comercial como parceiro, onboarding da vendedora com `merchantIdInPayPal` + `permissionsGranted=true`, capacidade `payments_receivable` confirmada e validação Sandbox ponta a ponte.
- Deploy deve preservar `verify_jwt=false` (o PayPal não envia JWT do Supabase). **Não usar `--prune`**, não excluir funções existentes.
- URL do webhook: `https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/webhooks-paypal`
- Eventos necessários: `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.PARTIALLY_REFUNDED`.
- A assinatura é verificada pela API oficial; notificações não verificadas são recusadas (200 sem efeito ou erro, conforme o caso). Nunca aceitar evento apenas por ter chegado ao endpoint.
- Confirmar que o `payee.merchant_id` das ordens corresponde ao `merchant_id`/conta externa da conexão da loja; divergência bloqueia a confirmação (`paypal_merchant_mismatch` / `cross_seller_event`).

---

## 5. Homologação ponta a ponta — **não realizada**

Não existem credenciais utilizáveis de Sandbox para nenhum dos dois provedores (as de MP em homologação estão cifradas no Supabase e não devem ser lidas/copiadas; PayPal não tem nenhuma credencial). Portanto **não houve** teste real de:

- MP: OAuth, criação de preferência, aprovação, recusa, cancelamento, webhook assinado, confirmação de pedido, idempotência ou reembolso.
- PayPal: criação de ordem, aprovação, captura, webhook assinado, confirmação de pedido, idempotência ou reembolso.

Os 519 testes locais usam `fetch`/HMAC simulados. Eles **não** são aprovação de provedor e não substituem Sandbox.

**Ponto de parada:** para executar esta etapa são necessárias contas oficiais de teste (vendedora + compradora) e credenciais Sandbox configuradas no projeto de homologação, inclusive `PAYPAL_*`. Assim que forem fornecidas/configuradas, o próximo passo é validar o fluxo completo em `ardpqimdllzbbdvwamkh` antes de tocar em produção.

---

## 6. Publicação em produção — não executada

A autorização de publicação estava condicionada a “validações de segurança e Sandbox aprovadas”. Como o Sandbox real não pôde ser executado, **nenhuma função financeira foi republicada nesta etapa**. As versões atuais (`payments` v1, `payments-callback` v1, `webhooks-mercadopago` v1, `webhooks-paypal` ausente) permanecem exatamente como estavam. Nenhuma migration foi aplicada; nenhum dado financeiro foi alterado; nenhuma regra de RLS foi modificada.

---

## 7. Ativação dos checkouts — não executada

`methods` continua retornando `[]` para todas as lojas. Nenhum meio de pagamento foi habilitado. O frontend não consegue escolher provedor sem conexão válida, e `create_payment` falha fechado sem credenciais. Pedidos continuam sendo registrados e o fluxo WhatsApp permanece intacto.

---

## 8. Pagamento real e comprovação — **não executado; depende de autorização expressa**

Nenhuma cobrança foi feita. Para o teste controlado, será necessário definir previamente:

- Provedor (MP ou PayPal) e ambiente (produção, com valor mínimo);
- Valor exato e moeda (ex.: R$ 1,00 em BRL);
- Loja e conta recebedora (`collector_id`/`merchant_id`);
- ID do pedido de teste;
- Taxas esperadas e eventual divisão (Split 1:1 = sem comissão);
- Reembolso previsto após a validação.

Somente após autorização expressa com esses dados, e após o Sandbox aprovado, poderá ser feita a cobrança. A comprovação final exigirá: aprovação, captura, webhook assinado recebido, pedido atualizado pelo backend, conciliação do valor recebido e confirmação do destino do dinheiro na conta correta. **Status “approved” sozinho não é comprovação de recebimento.**

---

## 9. Resultado do Split e liquidações

- **Split 1:1:** implementado em código como preferência/ordem sem comissão e com conta da vendedora; **não comprovado** no painel MP nem por liquidação.
- **Liquidações comprovadas:** **nenhuma**.
- **Recebimento financeiro comprovado:** **nenhum**.

---

## 10. Pendências (em ordem de execução)

1. **Você:** criar/confirmar o app MP de produção com Redirect URI, Webhook URL, eventos `payment`/`merchant_order`, escopos `offline_access read write` e PKCE desabilitado.
2. **Você:** configurar os 6 secrets MP no projeto `wdcufpvlbisnqtvmbyso` (seção 3.1), com `MP_ENV=production`.
3. **Você:** executar o OAuth como titular da loja em `/painel/pagamentos`; validar conta, país/moeda, escopos e ativar o método no painel.
4. **Você:** confirmar conta recebedora e modelo sem comissão; decidir a alternativa se o Split 1:1 não for compatível.
5. **Você:** fornecer/configurar credenciais PayPal de produção + Partner ID aprovado + Webhook ID; cadastrar o webhook com os eventos da seção 4.2.
6. **Após 1–5:** executar Sandbox ponta a ponta com contas oficiais de teste nos dois provedores (inclusive recusa, cancelamento, idempotência e reembolso).
7. **Após Sandbox aprovado:** publicar as funções financeiras (inclusive `webhooks-paypal`) com `--no-verify-jwt`, sem `--prune`, preservando as versões anteriores; validar `methods`, conexões por loja e gates de valor/moeda/conta.
8. **Você:** autorizar expressamente o pagamento real de validação com valor, moeda, loja, conta e reembolso definidos.
9. Reconciliar aprovação, captura, webhook, pedido, valor recebido e liquidação; só então declarar ativação concluída.

Itens 1–5 e 8 dependem exclusivamente de você/provedores externos. Itens 6–7 e 9 dependem desses itens e foram deixados prontos para execução assim que as credenciais existirem.

---

## 11. Riscos

| Risco | Status |
|---|---|
| PKCE MP desabilitado (M1) | Decisão documentada; se o app exigir PKCE, OAuth falha — precisa de autorização para implementar |
| Credenciais de homologação reaproveitadas em produção | Proibido; `MP_ENV`/`PAYPAL_ENV` precisam ser `production` com credenciais de produção |
| OAuth feito com conta errada | Direcionaria recursos para destinatário errado; verificar `collector_id`/`merchant_id` antes de cobrar |
| `webhooks-paypal` ausente | Sem confirmação oficial de captura/reembolso do PayPal |
| CORS `*` nas Edge Functions | Mitigado por exigir Bearer nas ações privadas; ainda vale revisão posterior |
| Revogação remota inexistente | `disconnect` remove só o vínculo local; revogar no painel do provedor manualmente |
| Verificação PayPal dependente da API oficial | Fail-closed; se a API estiver fora, eventos são recusados (pedido não é confirmado) |
| Fallback `insertOrderDirectly` | Usa valores do navegador quando o backend financial está fora; depende da RLS reforçada (`orders_anon_insert` endurecida) |
| Migração base `20261115090000` não aplicada em produção | Produção usa o consolidado aditivo `fixes/20261120_payment_schema_additive_production.sql`; não aplicar a base sem revisão (revoga `anon` em `catalogs`/`orders`) |
| Cobrança sem Sandbox | Não autorizada; nenhum teste real foi feito |

---

## 12. Procedimento de rollback

- **Nesta etapa:** nada foi publicado ou alterado em produção, portanto não há rollback financeiro a executar.
- **Se houver deploy futuro das funções:** manter as versões atuais como referência de rollback (`payments` v1, `payments-callback` v1, `webhooks-mercadopago` v1; `webhooks-paypal` nunca existiu em produção). Reimplantar o código do commit considerado bom, com `--no-verify-jwt` e sem `--prune`.
- **Se secrets forem adicionados:** removê-los no painel Supabase (ou `supabase secrets unset --project-ref ...`) e desconectar/desabilitar as conexões em `/painel/pagamentos`. Nunca divulgar valores.
- **Se uma conexão estiver errada:** `disconnect` no painel remove o vínculo local; revogar a autorização no painel do provedor (a revogação remota não é automática).
- **Dados financeiros:** nenhuma linha foi inserida/alterada nesta etapa; não executar `DELETE`/`TRUNCATE` em tabelas financeiras. Em caso de incidente, preservar os registros para auditoria.
- **Frontend:** versão anterior ao aviso do QR Code registrada no relatório do QR Code (`40b89b3d…`); versão atual `a1915429…`.

---

## 13. Conclusão

**O que está funcionando:** catálogos, pedidos via WhatsApp, painel, i18n, conversor, Melhor Envio, QR Code e o backend financeiro fail-closed (que corretamente não oferece meios de pagamento sem credenciais/conexão).

**O que foi publicado nesta etapa:** nada no escopo financeiro. O QR Code já estava publicado e foi preservado.

**O que impede a liberação definitiva:** ausência total de credenciais de produção (MP e PayPal), app MP não configurado, nenhuma conexão OAuth da vendedora, `webhooks-paypal` ausente, nenhum teste Sandbox real, nenhuma decisão comprovada sobre conta recebedora/Split 1:1 e nenhuma liquidação ou recebimento comprovado.

**Afirmação correta até aqui:** os pagamentos estão implementados e testados localmente (519/519), mas **desativados e financeiramente não comprovados em produção**.
