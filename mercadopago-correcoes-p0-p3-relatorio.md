# Relatório de Correção — Mercado Pago P0–P3

Data: 20/11/2026
Worktree isolada: `C:\Users\USER\AppData\Local\Temp\opencode\mp-correcoes-p0-p3` (detached `69b642e`)
Projeto de referência: `ardpqimdllzbbdvwamkh` (`vitrine-criativa-homolog`) — **somente leitura**.
Referência: `mercadopago-auditoria-somente-leitura.md` (veredito original: REPROVADO).

> Nenhum commit, push, deploy, migration, alteração de Secrets, acesso a banco ou pagamento
> foi realizado. Todas as mudanças são locais, na worktree isolada.

## 1. Arquivos modificados nesta correção

| Arquivo | Correções |
|---|---|
| `supabase/functions/payments/index.ts` | P0, P3 |
| `supabase/functions/payments-callback/index.ts` | P3 |
| `supabase/functions/_shared/payments/mercadopago.ts` | P1, P2 |
| `supabase/functions/_shared/payments/types.ts` | P2 |
| `supabase/functions/_shared/payments/lifecycle.ts` | P2, P3 |
| `supabase/functions/_shared/payments/webhooks.ts` | P2, P3 |
| `supabase/functions/_shared/payments/connections.ts` | P3 |
| `tests/payment-correcoes-p0-p3.test.ts` | Novo — 19 testes de regressão |

Arquivos já presentes na worktree **antes** desta correção (etapa de isolamento de ambientes,
não alterados aqui): `supabase/functions/_shared/payments/urls.ts`,
`tests/payment-env-isolation.test.ts` (14 testes) e o próprio relatório de auditoria.

## 2. Correções aplicadas

### P0 — Escopo de `resolveMpPaymentId`
- A função estava declarada **aninhada** dentro de `paymentStatusAction`, mas era chamada também por
  `refreshPaymentAction` — fora de escopo (`ReferenceError` em produção no caminho de refresh).
- Elevada ao **escopo de módulo** em `payments/index.ts`, com assinatura tipada
  `(tx: TransactionRow, credentials: ProviderCredentials) => Promise<string | null>`.
- Continua resolvendo a **preference id** via `/v1/merchant_orders/{id}` e persistindo o payment id
  antes do snapshot. Comportamento inalterado; apenas o escopo foi corrigido.

### P1 — Assinatura do webhook lendo o Secret existente
- `config()` em `mercadopago.ts` passou a ler `MERCADOPAGO_WEBHOOK_SECRET` (nome que **existe** no
  projeto), com `MP_WEBHOOK_SECRET` mantido apenas como fallback de compatibilidade — nome novo tem
  precedência.
- Nenhum Secret foi criado, removido ou alterado. Nenhum valor é logado ou devolvido.
- Assinatura ausente, inválida ou com segredo diferente continua sendo recusada antes de qualquer
  efeito; o texto de erro agora cita o nome do Secret configurado.

### P2 — Fail-closed em divergência de valor, moeda, vendedor e pedido
- `ProviderPaymentSnapshot` ganhou `externalReference` e `sellerAccountId`, preenchidos pela API
  oficial do MP (`external_reference` = UUID do pedido; `collector_id`/`user_id` = conta do vendedor).
- Novas funções puras em `lifecycle.ts`:
  - `detectPaymentOwnershipMismatch()` — compara pedido e vendedor, com modo fail-closed quando o
    provedor deveria informar o campo e não informou.
  - `paymentConfirmationGate()` — bloqueia a confirmação em `amount_divergence`,
    `currency_divergence` ou `payment_ownership_mismatch`.
- `applyOfficialSnapshot()` agora valida o snapshot **antes de qualquer captura ou escrita**
  (`updateTransaction`/`syncOrderPayment`). Divergência gera `flagDivergence()`, log sem dados
  sensíveis e retorno `{ ok: false, snapshot: null, reason }`. A validação roda novamente após a
  captura (PayPal), cuja resposta pode trazer outros dados.
- Idempotência e reenvio controlado preservados — nenhuma alteração na chave de evento, no lease de
  captura nem na decisão de duplicata.

### P3 — Validação rigorosa Sandbox/Produção
- Nova função pura `connectionEnvironmentMatches()` em `lifecycle.ts` (normaliza caixa/espaços;
  exige ambos os lados presentes).
- Aplicada em **quatro pontos**:
  - `loadCredentials()` (`connections.ts`) — cobre checkout, refresh, reembolso e webhook;
  - `create_payment` no checkout (`payments/index.ts`) — recusa 409 se a conexão for de outro ambiente;
  - `setEnabled` (`payments/index.ts`) — impede habilitar no checkout uma conexão de outro ambiente;
  - `payments-callback` OAuth — valida o `env` do `state` assinado contra o runtime antes de gravar
    credenciais, e grava `providerEnvironment(provider)` como origem da verdade;
  - resolução de conta notificada no webhook (`webhooks.ts`) — ignora conexões de outro ambiente.
- Nenhum domínio/project ref foi fixado no código; URLs continuam derivadas do runtime com fail-fast.

## 3. Testes executados e resultados

| Comando | Resultado |
|---|---|
| `npm test` (baseline, antes das edições) | **434 pass / 0 fail** |
| `node --test tests/payment-correcoes-p0-p3.test.ts` | **19 pass / 0 fail** |
| `npm test` (suíte completa, após as edições) | **453 pass / 0 fail** |

Os 19 testes novos cobrem explicitamente:
- **P0**: declaração única no escopo de módulo; chamada em `refreshPaymentAction` após a declaração.
- **P1**: assinatura válida com `MERCADOPAGO_WEBHOOK_SECRET`; assinatura inválida; assinatura ausente;
  Secret não configurado; precedência do nome novo; compatibilidade com o nome legado.
- **P2**: valor divergente; moeda divergente; vendedor incorreto; pedido incorreto; ausência de
  referência/vendedor (fail-closed); dados coerentes liberam; snapshot expõe os campos; gate roda
  antes de gravar; pagamento duplicado continua bloqueado.
- **P3**: Sandbox≠Produção (nos dois sentidos), nulos e normalização; checagem ligada em checkout,
  callback, webhook e `loadCredentials`.

## 4. Testes que falharam

- Durante o desenvolvimento, **1 teste novo falhou** por uma asserção de formatação (o regex de
  escopo capturava até o limite da palavra, sem o `(` da assinatura). Corrigida a asserção; não era
  falha do código de produção. **Nenhuma falha restante.**

## 5. Riscos restantes

- **Validação em runtime real não executada**: as correções foram verificadas por testes locais
  determinísticos (HMAC, funções puras, leitura de código-fonte). Não houve deploy nem chamada à API
  do Mercado Pago — conforme restrição de não tocar produção nem realizar pagamentos.
- **P2 depende da API oficial devolver `external_reference` e `collector_id`**: o gate é fail-closed
  justamente para esses casos; se o provedor alterar o formato, a confirmação será bloqueada com
  log de diagnóstico (seguro, mas pode exigir ajuste).
- **Compatibilidade legada do nome do Secret**: `MP_WEBHOOK_SECRET` continua como fallback. Se algum
  dia ambos existirem com valores diferentes, o nome novo vence — comportamento intencional e
  documentado.
- **Sem migrations/Secrets**: nada foi aplicado no projeto de homologação; a validação final em
  homologação depende de autorização para deploy (fora do escopo desta etapa).

## 6. Confirmação de isolamento

- Projeto de produção `wdcufpvlbisnqtvmbyso` **intacto**: nenhuma consulta, migrate, deploy ou
  alteração de configuração foi feita nele nesta etapa.
- Projeto `ardpqimdllzbbdvwamkh` foi usado **apenas como referência somente leitura** (auditoria
  anterior). Nenhum Secret foi lido em claro, criado, removido ou modificado.
- Worktree original `mp-oauth-isolamento` permanece com seu estado pré-existente, **não sobrescrita**.
- `git status`: apenas modificações locais não commitadas + arquivos novos na worktree isolada.
  **Nenhum commit, push, deploy, migration ou pagamento foi executado.**

---
Status: **PRONTO PARA REVISÃO — aguardando autorização para proseguir.**
