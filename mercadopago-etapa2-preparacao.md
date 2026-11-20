# Etapa 2 — Preparação e Deploy em Homologação

Data: 20/11/2026
Worktree: `C:\Users\USER\AppData\Local\Temp\opencode\mp-correcoes-p0-p3` (detached `69b642e`, **sem novos commits**)
Homologação: `ardpqimdllzbbdvwamkh` — **único projeto accessado nesta etapa (somente leitura)**.
Produção `wdcufpvlbisnqtvmbyso`: **não acessada, não modificada**.

> Status desta etapa: **FASES 1 e 2 CONCLUÍDAS — FASE 3 EM AGUARDO DE AUTORIZAÇÃO. NENHUM DEPLOY FOI EXECUTADO.**

---

## FASE 1 — REVISÃO

### 1.1 Diff integral revisado

`git diff` completo lido (596 linhas de patch, 316 inserções / 74 remoções em 7 arquivos rastreados)
mais os 5 arquivos novos. Nenhuma alteração foi feita nesta fase.

| Arquivo | Natureza das alterações | Autorização |
|---|---|---|
| `supabase/functions/payments/index.ts` | P0 (escopo de `resolveMpPaymentId`), P3 (2 checagens) + isolamento de URLs | P0–P3 desta etapa + isolamento pré-existente |
| `supabase/functions/payments-callback/index.ts` | P3 (validação do `env` no `state`; `environment` gravado do runtime) + isolamento de URLs/redirect | P3 desta etapa + isolamento pré-existente |
| `supabase/functions/_shared/payments/mercadopago.ts` | P1 (nome do Secret), P2 (`externalReference`/`sellerAccountId`) | P0–P3 desta etapa |
| `supabase/functions/_shared/payments/types.ts` | P2 (2 campos opcionais no snapshot) | P0–P3 desta etapa |
| `supabase/functions/_shared/payments/lifecycle.ts` | P2 (`detectPaymentOwnershipMismatch`, `paymentConfirmationGate`), P3 (`connectionEnvironmentMatches`) | P0–P3 desta etapa |
| `supabase/functions/_shared/payments/webhooks.ts` | P2 (gate antes de captura/escrita + revalidação pós-captura), P3 (conta notificada) | P0–P3 desta etapa |
| `supabase/functions/_shared/payments/connections.ts` | P3 (`loadCredentials`) | P0–P3 desta etapa |
| `supabase/functions/_shared/payments/urls.ts` | Novo — derivação fail-fast de URLs | Isolamento pré-existente |
| `tests/payment-correcoes-p0-p3.test.ts` | Novo — 19 testes | P0–P3 desta etapa |
| `tests/payment-env-isolation.test.ts` | Novo — 14 testes | Isolamento pré-existente |
| `mercadopago-auditoria-somente-leitura.md`, `mercadopago-correcoes-p0-p3-relatorio.md` | Novos — documentação | Etapas anteriores |

**Conclusão:** além das correções P0–P3, o diff contém exclusivamente o isolamento de ambientes
já autorizado na etapa anterior (`urls.ts`, testes e as partes de `payments*.ts` que trocam
fallbacks por URLs derivadas). **Não há alterações não autorizadas.**

**Nenhum arquivo de migration, banco, `config.toml`, frontend, Secrets ou produção foi modificado.**
`git diff --cached` está vazio — nada foi staged, commitado ou enviado.

### 1.2 Nomes de Secrets confirmados

Verificação por **nome e hash SHA-256** (a CLI nunca devolve valores em claro; nenhum valor foi exibido).

Consumidos pelo código de pagamentos:
`MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_ENV`, `MERCADOPAGO_WEBHOOK_SECRET` (novo primário),
`MP_WEBHOOK_SECRET` (fallback legado), `PAYMENT_TOKEN_ENCRYPTION_KEY`, `PAYMENT_STATE_SECRET`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-injetados), `VITRINE_URL`,
`PAYMENTS_RETURN_ORIGIN` (opcional).

| Nome | Status em homologação | Uso |
|---|---|---|
| `MERCADOPAGO_WEBHOOK_SECRET` | **Presente** | Lido pela correção P1 — assinatura do webhook |
| `MP_WEBHOOK_SECRET` | Ausente | Fallback legado; não é necessário |
| `MP_CLIENT_ID` / `MP_CLIENT_SECRET` | Presentes | OAuth/refresh da plataforma |
| `MP_ENV` | Presente, valor `sandbox` (hash confere) | Isolamento P3 |
| `PAYMENT_TOKEN_ENCRYPTION_KEY` / `PAYMENT_STATE_SECRET` | Presentes | AES-GCM / HMAC do `state` |
| `SUPABASE_URL` | Presente, aponta para homologação (hash confere) | URLs de callback/webhook |
| `VITRINE_URL` | Presente, aponta para `vitrine-homolog...` (hash confere) | Retorno ao painel |
| `PAYMENTS_RETURN_ORIGIN` | Ausente | Opcional; `VITRINE_URL` cobre |
| `PAYPAL_*` | Ausentes | PayPal desconfigurado — ver risco R3 |
| `MERCADOPAGO_ACCESS_TOKEN` / `_PUBLIC_KEY` / `_CLIENT_SECRET` | Ausentes | **Correto**: o código usa `MP_CLIENT_*` e tokens individuais por vendedor |

### 1.3 Dependências das Edge Functions

Varredura recursiva dos imports relativos a partir dos 4 entrypoints: **24 arquivos `.ts` verificados, 0 imports quebrados**.
Módulos alterados (`mercadopago.ts`, `types.ts`, `lifecycle.ts`, `webhooks.ts`, `connections.ts`, `urls.ts`)
são **bundled dentro de cada função no deploy** — não existem imports compartilhados em runtime.
Portanto, toda função que importa qualquer módulo alterado precisa de redeploy.

### 1.4 Funções que precisam de deploy

A auditoria listou 3 funções; a revisão do grafo de dependências identificou uma **4ª**:

| Função | Versão atual | Motivo do redeploy |
|---|---|---|
| `payments` | v5 | P0 + P3 diretos; P1/P2/P3 via `mercadopago.ts`, `webhooks.ts`, `lifecycle.ts`, `urls.ts` |
| `payments-callback` | v5 | P3 direto + `urls.ts` |
| `webhooks-mercadopago` | v5 | P1 (`mercadopago.ts`), P2/P3 (`webhooks.ts`, `lifecycle.ts`) |
| `webhooks-paypal` | v5 | **Importa `webhooks.ts` alterado** (P2/P3) — ausente na auditoria, mas deployada em homologação |

As 4 estão `ACTIVE` com `verify_jwt=false` — configuração que deve ser preservada.

---

## FASE 2 — PREPARAÇÃO (somente leitura)

Comandos executados, todos com `--project-ref ardpqimdllzbbdvwamkh` explícito:

| Verificação | Resultado |
|---|---|
| CLI Supabase | v2.109.1 |
| `supabase functions list --project-ref ardpqimdllzbbdvwamkh` | 6 funções ativas; as 4 de pagamento em v5, `verify_jwt=false` |
| `supabase secrets list --project-ref ardpqimdllzbbdvwamkh` | Secrets acima presentes (por nome/hash) |
| Hash de `MP_ENV` | confere com `sandbox` |
| Hash de `SUPABASE_URL` | confere com `https://ardpqimdllzbbdvwamkh.supabase.co` (não produção) |
| Hash de `VITRINE_URL` | confere com `https://vitrine-homolog.meellcriativa.workers.dev` (não produção) |
| `node --test tests/payment-env-isolation.test.ts` | 14/14 — callback e webhook derivados do projeto atual, sem literais de produção |
| Suíte completa (etapa anterior) | 453/453 |
| Integridade de imports | 24 arquivos, 0 quebrados |
| Worktree original `mp-oauth-isolamento` | Intacta, HEAD `69b642e`, mesmo estado anterior |

**URLs que o código deriva em homologação:**
- OAuth callback: `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/payments-callback`
- Webhook: `https://ardpqimdllzbbdvwamkh.supabase.co/functions/v1/webhooks-mercadopago`

**OAuth:** `state` HMAC + nonce inalterados; `redirect_uri` idêntica na geração do `state` e na troca de código;
PKCE permanece desabilitado (P14 fora do escopo). O **registro dessas URLs no app MP de homologação**
é configuração externa e não pode ser verificado por CLI — deve ser conferido manualmente no painel
do desenvolvedor MP antes de testar OAuth/webhook.

**Ambiente:** Sandbox confirmado (`MP_ENV=sandbox`). Nenhuma credencial de produção foi lida ou usada.

---

## FASE 3 — RELATÓRIO PARA AUTORIZAÇÃO

### Funções a implantar
`payments`, `payments-callback`, `webhooks-mercadopago`, `webhooks-paypal` (4 funções, todas em homologação).

### Arquivos envolvidos no bundle
Os 7 arquivos rastreados alterados + `urls.ts` (novo), listados na FASE 1. Nenhum arquivo de
migration, banco ou frontend entra no deploy.

### Riscos identificados

- **R1 (ALTO) — `supabase/config.toml` aponta para produção.** `project_id = "wdcufpvlbisnqtvmbyso"`.
  Qualquer comando de deploy **sem `--project-ref`** usaria esse valor. Mitigação obrigatória:
  todos os comandos abaixo carregam `--project-ref ardpqimdllzbbdvwamkh`. **Nunca** executar
  `supabase functions deploy` sozinho, nem `supabase link` apontando para produção, nem `--prune`.
- **R2 (MÉDIO) — Docker indisponível neste ambiente.** Por isso os comandos usam `--use-api`
  (bundle server-side). Sem essa flag o deploy local provavelmente falharia.
- **R3 (BAIXO) — `webhooks-paypal` também será redeployado** por compartilhar `webhooks.ts`.
  Como os Secrets `PAYPAL_*` não existem em homologação, a função permanece inoperante, mas
  **segura** (falha fechada por configuração). Nenhuma cobrança PayPal é possível.
- **R4 (MÉDIO) — P2 fail-closed pode bloquear confirmações legítimas** se a API do MP deixar de devolver
  `external_reference` ou `collector_id`. É o comportamento desejado (seguro); logs de diagnóstico
  serão emitidos com o motivo, sem dados sensíveis.
- **R5 (MÉDIO) — Achados P4–P15 da auditoria permanecem** (fora do escopo desta etapa), notadamente
  P5: `notification_url` ainda usa `readEnv("SUPABASE_URL") ?? ""` em `mercadopago.ts:352`. Com
  `SUPABASE_URL` presente a URL gerada está correta, mas não há fail-fast nesse ponto.
- **R6 (MÉDIO) — URLs registradas no app MP de homologação** precisam de conferência manual;
  não há como validá-las por CLI sem expor credenciais.
- **R7 (MÉDIO) — Validação em runtime ainda não executada.** O deploy substitui código; a prova real
  depende de teste de notificação do MP (sem cobrança) e de leitura das tabelas financeiras,
  **em autorização separada**.

### Comandos exatos que serão executados (APÓS autorização)

```powershell
cd C:\Users\USER\AppData\Local\Temp\opencode\mp-correcoes-p0-p3

supabase functions deploy payments payments-callback webhooks-mercadopago webhooks-paypal --project-ref ardpqimdllzbbdvwamkh --use-api --no-verify-jwt
```

Verificação pós-deploy (somente leitura):

```powershell
supabase functions list --project-ref ardpqimdllzbbdvwamkh
```

Expectativa: as 4 funções evoluem de v5 para v6, permanecem `ACTIVE` e `verify_jwt=false`.
Nenhum outro comando será executado nesta etapa — em especial: sem `--prune`, sem `supabase link`,
sem `secrets set`, sem `db push`, sem migrations e sem push git.

### Confirmação de operação financeira

**Nenhuma operação financeira será realizada.** O deploy apenas substitui o código das Edge Functions.
Não serão criadas Preferences, cobranças, pagamentos, reembolsos nem qualquer escrita em tabelas
financeiras. Nenhum pagamento real ou de teste será iniciado. Nenhum Secrets será alterado.
Nenhuma configuração de produção será lida ou modificada. A worktree original não será sobrescrita.

---

**PARADO. Aguardando autorização expressa para executar o comando de deploy acima.**
