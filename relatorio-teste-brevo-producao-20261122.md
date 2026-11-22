# Relatório — teste controlado do Brevo em produção

Data: 22/11/2026 · Projeto: `wdcufpvlbisnqtvmbyso` (produção) · Autorização recebida para execução exata do plano apresentado.

## 1. Escopo executado

| Etapa | Resultado |
|---|---|
| Função temporária `brevo-controlled-test` criada e publicada | ✅ única função publicada nesta operação |
| Proteção por header `x-test-guard` | ✅ exigida nas ações `check` e `send` |
| Ação `check` (sem e-mail, apenas booleanos) | ✅ |
| Ação `send` (um e-mail ao destinatário controlado) | ✅ |
| Nenhuma compra, pedido ou registro de cliente criado | ✅ |
| Nenhum secret alterado/criado/removido | ✅ |
| Nenhuma função existente republicada | ✅ |
| Nenhuma migration executada | ✅ |

Todos os comandos Supabase usaram `--project-ref wdcufpvlbisnqtvmbyso`. Nenhum `--linked`.

## 2. Implementação da função temporária

- `supabase/functions/brevo-controlled-test/index.ts`: importa `sendViaBrevo` de `../_shared/digital_delivery.ts` — **a mesma implementação usada pela entrega digital**.
- Para permitir o import sem reescrever a lógica, a palavra-chave `export` foi adicionada apenas no código-fonte de `sendViaBrevo` durante o teste e **revertida ao final**. As funções já publicadas não foram redeployadas, portanto permaneceram intactas.
- Guard: `x-test-guard` com valor fixo definido no código da função temporária; requisições sem o header recebiam 401.
- `check`: lê `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` e `SUPABASE_URL` com `Deno.env.get`, exatamente como `config()`, e devolve somente `true/false` — nenhum valor, hash ou trecho foi exposto. Não envia e-mail.
- `send`: destinatário fixo `vitrinecriativameell@gmail.com`, assunto e corpo estáticos, sem dados de cliente; usa `sendViaBrevo`. Flag em memória impediria um segundo envio no mesmo isolate; a ação foi chamada uma única vez.

## 3. Resultado do teste

**`check` (HTTP 200):**
```json
{"ok":true,"hasApiKey":true,"hasSenderEmail":true,"hasSenderName":true,"hasSupabaseUrl":true,"configOk":true}
```

**`send` (HTTP 200):**
```json
{"ok":true,"messageId":"<202611220110.28020905925@smtp-relay.mailin.fr>","error":null}
```

O `messageId` foi devolvido pelo Brevo, confirmando que a mensagem foi aceita pelo provedor. **Exatamente um e-mail** foi enviado, apenas ao endereço controlado.

## 4. Verificação de dados (read-only, após o envio)

`pedidos=17, entregas=0, tokens=0, emails=0, tabela=1, rpcs=2, rls=true, policies=1` — idêntico ao estado anterior ao teste. Nenhum registro de teste foi criado nas tabelas de clientes.

## 5. Limpeza e auditoria final

- Função temporária excluída em produção (`Deleted Edge Function`).
- Entrada `[functions.brevo-controlled-test]` removida de `supabase/config.toml`; arquivo restaurado exatamente ao HEAD.
- `export` temporário revertido em `_shared/digital_delivery.ts`; diretório local da função removido.
- `git status` limpo; `HEAD = 787c368`.

Funções existentes após a limpeza (versões inalteradas em relação ao início deste teste):

| Função | Versão | Status |
|---|---:|---|
| `digital-delivery` | 4 | ACTIVE |
| `payments` | 13 | ACTIVE |
| `payments-callback` | 13 | ACTIVE |
| `webhooks-mercadopago` | 13 | ACTIVE |
| `melhor-envio` | 20 | ACTIVE |
| `melhor-envio-callback` | 15 | ACTIVE |

Nomes dos secrets Brevo após o teste: `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` — presentes, sem alteração. A função temporária não consta mais na listagem.

## 6. Conclusão e pendências

A pendência bloqueante apontada no relatório de publicação está **encerrada**: os três secrets existem, `config()` encontra os nomes exigidos e o envio real pelo Brevo foi comprovado com `messageId`.

Pendências restantes (não bloqueantes para esta etapa):
1. O fluxo completo de compra digital (webhook → entrega → e-mail com link → download) foi validado em homologação, não em produção. Se desejar, o próximo passo seria um pedido de teste isolado com destinatário controlado — exige autorização específica, pois cria registros em tabelas de cliente.
2. As versões das funções haviam mudado externamente antes deste teste (v4/v13 e melhor-envio v20/v15); nenhuma alteração de código foi feita por mim nelas.
3. Nenhuma credencial ou valor de secret foi exibido em nenhum momento.
