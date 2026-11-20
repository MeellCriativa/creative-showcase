# Etapa 2 — Deploy Mercado Pago em Homologação (relatório final)

Data: 20/11/2026
Worktree: `C:\Users\USER\AppData\Local\Temp\opencode\mp-correcoes-p0-p3` (HEAD `69b642e`, sem commits/push)
Projeto utilizado: **`ardpqimdllzbbdvwamkh`** (`vitrine-criativa-homolog`)
Produção `wdcufpvlbisnqtvmbyso`: **fora de escopo, não acessada, não modificada**.

---

## 1. Pré-verificações obrigatórias — 8/8 OK

| # | Verificação | Resultado |
|---|---|---|
| 1 | Diretório da worktree | Conferido: CWD igual a `C:\Users\USER\AppData\Local\Temp\opencode\mp-correcoes-p0-p3` |
| 2 | Project Ref explicitamente | `ardpqimdllzbbdvwamkh`, confirmado também por hash de `SUPABASE_URL` |
| 3 | Quatro diretórios de função | `payments`, `payments-callback`, `webhooks-mercadopago`, `webhooks-paypal` — todos com `index.ts` |
| 4 | Arquivos enviados | 24 arquivos `.ts` no grafo; 0 imports quebrados; nenhum `.env` na worktree |
| 5 | Diff aprovado | 7 arquivos, 316 inserções / 74 remoções — idêntico ao relatório aprovado |
| 6 | Nenhum arquivo de produção | Literais de produção existem apenas em `melhor-envio*`/`meta-*`, **não deployados**; as 4 funções e seus módulos não contêm project ref/worker de produção |
| 7 | `--project-ref` no comando | Presente, com valor de homologação |
| 8 | Nenhum deploy sem Project Ref | Nenhum comando de deploy foi executado sem o flag explícito |

Observação de segurança: `supabase/config.toml` contém `project_id = "wdcufpvlbisnqtvmbyso"` (produção).
O comando executado usou `--project-ref ardpqimdllzbbdvwamkh`, que tem precedência. A resposta do
próprio CLI confirmou `"project_ref":"ardpqimdllzbbdvwamkh"`.

## 2. Comando executado (exatamente o autorizado)

```powershell
supabase functions deploy payments payments-callback webhooks-mercadopago webhooks-paypal --project-ref ardpqimdllzbbdvwamkh --use-api --no-verify-jwt
```

Resposta do CLI: `{"project_ref":"ardpqimdllzbbdvwamkh","functions":["payments","payments-callback","webhooks-mercadopago","webhooks-paypal"],"message":"Deployed Functions."}`

## 3. Resultado por função / versões / status

| Função | Resultado | Versão anterior | Versão implantada | Status | `verify_jwt` |
|---|---|---|---|---|---|
| `payments` | Sucesso | v5 | **v6** | ACTIVE | `false` |
| `payments-callback` | Sucesso | v5 | **v6** | ACTIVE | `false` |
| `webhooks-mercadopago` | Sucesso | v5 | **v6** | ACTIVE | `false` |
| `webhooks-paypal` | Sucesso | v5 | **v6** | ACTIVE | `false` |

`updated_at` das quatro: `1795148324083` — mesmo instante de deploy.
As funções não autorizadas `melhor-envio` e `melhor-envio-callback` permanecem em **v22**, com
`updated_at` anterior — confirmação de que nada além das quatro foi alterado.

## 4. Verificação do código publicado

Não há subcomando `logs` na CLI v2.109.1. Em substituição, o código publicado foi baixado
(`supabase functions download`, com `--project-ref` explícito) para diretório **temporário fora da
worktree**, e comparado byte a byte com os arquivos locais aprovados:

```
IGUAL  payments/index.ts
IGUAL  payments-callback/index.ts
IGUAL  webhooks-mercadopago/index.ts
IGUAL  webhooks-paypal/index.ts
IGUAL  _shared/payments/connections.ts
IGUAL  _shared/payments/urls.ts
IGUAL  _shared/payments/webhooks.ts
IGUAL  _shared/payments/{crypto,currencies,db,index,money,paypal,cors}
```

Marcadores confirmados no bundle publicado:
- `async function resolveMpPaymentId` no escopo de módulo (**P0**)
- `connectionEnvironmentMatches(connection.environment, ...)` em `payments/index.ts`,
  `connections.ts` e `webhooks.ts`; `connectionEnvironmentMatches(String(payload.env...))` no callback (**P3**)
- `paymentConfirmationGate({ divergence, ownership })` em `webhooks.ts` (**P2**)
- `paymentsCallbackUrl()` / `paymentsWebhookUrl()` em `urls.ts` e callback (isolamento)

`mercadopago.ts` (**P1/P2**) consta na lista de assets enviados pelo CLI para as quatro funções,
mas o comando `download` da CLI falha ao extrair o asset `src/lib/currency.ts`
(`UnsafeFunctionDownloadPathError`) — limitação conhecida do CLI, **não erro de deploy**.
A verificação de P1 foi feita por: (a) Secret `MERCADOPAGO_WEBHOOK_SECRET` presente no projeto,
(b) upload confirmado no log de deploy e (c) 6/6 testes locais de assinatura aprovados após o deploy.

## 5. Erros encontrados

- **Nenhum erro de deploy.** As quatro funções foram publicadas e ficaram `ACTIVE` na v6.
- Único incidente: limitação do CLI no comando de *download* (`source/src/lib/currency.ts`),
  sem efeito no deploy — todos os demais arquivos foram extraídos e conferidos.

### Logs relevantes (sem dados sensíveis)

Trechos do log de deploy (somente nomes de arquivos públicos):
```
Deploying Function: payments
Uploading asset (payments): supabase/functions/_shared/payments/lifecycle.ts
Uploading asset (payments): supabase/functions/_shared/payments/webhooks.ts
Uploading asset (payments): supabase/functions/_shared/payments/mercadopago.ts
Uploading asset (payments): supabase/functions/_shared/payments/urls.ts
... (idem para payments-callback, webhooks-mercadopago, webhooks-paypal)
{"project_ref":"ardpqimdllzbbdvwamkh",...,"message":"Deployed Functions."}
```
Nenhum valor de Secret, token, chave ou dado de vendedor apareceu em qualquer log.

## 6. Ambiente e Secrets (pós-deploy, por nome/hash)

| Verificação | Resultado |
|---|---|
| `MERCADOPAGO_WEBHOOK_SECRET` | Presente — nome exato lido pela correção P1 |
| `MP_WEBHOOK_SECRET` | Ausente (fallback legado; desnecessário) |
| `MP_CLIENT_ID`, `MP_CLIENT_SECRET` | Presentes |
| `MP_ENV` | Presente; hash confere com **`sandbox`** — ambiente inalterado |
| `PAYMENT_TOKEN_ENCRYPTION_KEY`, `PAYMENT_STATE_SECRET` | Presentes |
| `SUPABASE_URL` | Hash confere com homologação |
| `VITRINE_URL` | Hash confere com `vitrine-homolog...` |
| Nenhum Secret criado, removido ou alterado | Confirmado |

Nenhum valor de Secret foi exibido em nenhuma etapa.

## 7. Confirmações finais

- **Projeto utilizado:** exclusivamente `ardpqimdllzbbdvwamkh` — confirmado pelo flag explícito e
  pela resposta do CLI e pela listagem pós-deploy (`entrypoint_path` contém o ref de homologação).
- **Produção `wdcufpvlbisnqtvmbyso`:** nenhuma consulta, deploy, migration, alteração de banco ou
  Secrets foi feita. Permanece intacta.
- **Worktree original `mp-oauth-isolamento`:** intacta, mesmo estado anterior, HEAD `69b642e`.
- **Worktree isolada:** nenhum commit, push ou modificação de código após o deploy.
- **Operações financeiras:** nenhuma. Nenhuma Preference, cobrança, pagamento, reembolso ou chamada
  à API do Mercado Pago foi feita. Nenhum webhook foi disparado. Nenhuma tabela financeira foi lida
  ou escrita. Nenhuma migration, alteração de banco, ambiente ou OAuth de vendedor foi executada.

## 8. Pendências para testes completos de Sandbox (autorização separada)

1. Conferir no painel do desenvolvedor MP o cadastro das URLs de homologação:
   - Callback: `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/payments-callback`
   - Webhook: `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago`
   (eventos `payment` e `merchant_order`; PKCE desabilitado enquanto P14 não for tratado).
2. Conectar uma conta de vendedor **de teste** via `/painel/pagamentos` e conferir, somente leitura,
   `payment_connections` e `payment_oauth_states`.
3. Usar o botão de **notificação de teste** do app MP — o código responde `200 {ignored:"test_event"}`
   sem efeitos financeiros. Confirma runtime de P1 sem cobrança.
4. Validar P2 em Sandbox com pagamento de teste controlado e verificar divergência forçada em
   ambiente isolado (somente com autorização explícita).
5. Validar P3 tentando checkout com conexão de ambiente divergente (deve retornar 409).
6. Revisar logs das funções via painel Supabase (a CLI local não oferece `functions logs`) após
   algum tráfego real de teste.
7. Achados P4–P15 da auditoria permanecem fora do escopo desta etapa.

---

**DEPLOY CONCLUÍDO EM HOMOLOGAÇÃO. PARADO — aguardando nova autorização para qualquer teste.**
