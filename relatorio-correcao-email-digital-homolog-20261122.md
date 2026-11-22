# Relatório — correção do e-mail único de compra digital (homologação)

Data: 22/11/2026 · Projeto: `ardpqimdllzbbdvwamkh` (`vitrine-criativa-homolog`)
Destinatário controlado dos testes: `vitrinecriativameell@gmail.com`
Produção (`wdcufpvlbisnqtvmbyso`): **não recebeu deploy, não recebeu cobrança, não recebeu e-mail de cliente** (ver aviso no item 6).

---

## 1. Causa identificada

1. **Múltiplos pontos de entrada.** `applyOfficialSnapshot()` é chamado pelo webhook (`webhooks.ts:663`), pelo retorno do comprador (`payments/index.ts:659`) e pela atualização manual/refresh (`payments/index.ts:1223`). Todos chegam ao hook de entrega em `webhooks.ts:346`.
2. **Concorrência com verificação fraca.** A entrega fazia `read-then-write` na linha de `digital_deliveries` (`status !== "sent"`). Duas chamadas simultâneas podiam passar pela checagem antes de qualquer gravação e disparar dois e-mails.
3. **Um e-mail por produto.** Cada produto digital do mesmo pedido gerava seu próprio e-mail, em vez de um único e-mail de compra confirmada com todos os links.
4. **Reenvio não podia reutilizar o link.** Somente o hash SHA-256 do token era persistido; o token bruto (e, portanto, a URL original) não existia em lugar nenhum. Diante de link expirado, o sistema não tinha como saber que devia exigir um novo.

## 2. Arquivos e funções modificados

| Arquivo | Alteração |
|---|---|
| `supabase/migrations/20261122010000_digital_order_email_idempotency.sql` (nova) | Tabela `digital_order_emails` (PK = `order_id`), RPCs `claim_digital_order_email()` e `finish_digital_order_email()`, `email_bundle_cipher` (AES-GCM), RLS owner-only, `revoke all ... from anon`. |
| `supabase/functions/_shared/digital_delivery.ts` | `deliverDigitalOrder()`, `retryDelivery()`, `regenerateDelivery()`, `revokeDelivery()`, `processDownload()`, novos helpers `claimEmailSlot`, `finishEmail`, `readEmailBundle`, `isLinkValid`, `rebuildBundleForLinks`, `revokeTokensForDelivery`. |
| `supabase/functions/_shared/digital_delivery_pure.ts` | `buildDeliveryEmail()` aceita `items[]` (produto, URL, orientações, validade); assinatura antiga permanece compatível. |
| `supabase/functions/digital-delivery/index.ts` | Mensagens amigáveis para `retry`/`regenerate`, inclusive “gere um novo link”. |
| `tests/digital-delivery.test.ts` | Testes do e-mail único, da reserva atômica, do bundle criptografado e da validação do link clicado. |
| `supabase/config.toml` | `project_id` apontando para homologação (alteração pré-existente preservada). |

## 3. Correções implementadas

- **Um e-mail por compra:** a reserva inicial só é obtida com `claimEmailSlot(orderId, ["pending"], 0)`. A PK em `order_id` garante uma única reserva por pedido. O e-mail reúne todos os produtos digitais, links, orientações e validades.
- **Bundle reutilizável:** assunto/HTML/texto + metadados dos links são cifrados com `PAYMENT_TOKEN_ENCRYPTION_KEY` (já existente em homologação; nenhuma credencial foi lida ou alterada). O token bruto nunca fica em coluna isolada — apenas o hash SHA-256, como antes.
- **Reenviar:** reutiliza exatamente os mesmos links. Valida o link **da entrega clicada**; se expirado/revogado/inválido, retorna `link_expired_need_new` com a mensagem “O link expirou ou foi revogado. Gere um novo link para reenviar.”. Se outro produto do mesmo pedido expirou, o conteúdo é reconstruído **com os mesmos tokens**, removendo apenas o link inválido. Lock de 120 s + janela de 5 s impedem cliques repetidos e envios simultâneos. Cada tentativa é registrada em `attempts`.
- **Gerar novo link:** revoga os tokens anteriores da entrega via `revokeTokensForDelivery()`, cria um novo token seguro e envia **um** e-mail pelo mesmo mecanismo. Pedido, pagamento e cobrança intactos. Links de outros produtos válidos são preservados.
- **Status bloqueados:** `refunded`/`cancelled`/`chargeback` revogam links e não enviam e-mail.
- **Download inalterado:** token opaco, hash, contador atômico com comparação de versão, signed URL de 5 min, bucket privado, registro de evento e RLS preservados.

## 4. Proteção contra duplicidade

- `claim_digital_order_email()` atualiza a linha com `status = 'sending'` sob condição atômica (`status IN (...)`, `locked_at` expirado, `sent_at` fora da janela). Apenas uma chamada vence.
- `finish_digital_order_email()` incrementa `attempts` e libera o lock numa única transação.
- A PK `order_id` impede duas linhas de controle para a mesma compra.
- O hook continua best-effort: falha de e-mail nunca altera o resultado financeiro do webhook.
- `applyOfficialSnapshot()` permanece nos três pontos de entrada (são fluxos distintos), mas a idempotência no banco torna qualquer repetição inofensiva.

## 5. Resultado dos 10 testes (homologação, sem cobrança real)

| # | Cenário | Resultado | E-mails |
|---|---|---|---:|
| 1 | Aprovação com 2 produtos digitais + 2 chamadas concorrentes | 1 enviado (`…61549612996`), 1 `skipped`; e-mail com 2 links, assunto “Compra confirmada: 2 produtos digitais” | **1** |
| 2 | Replay do webhook (`confirmation_already_sent`) | `skipped=1`, nenhum token novo, `attempts` inalterado | **0** |
| 3 | Reenviar com links válidos | Mesmo conteúdo e mesmos 2 IDs de token; `attempts` 1 → 2 | **1** |
| 4 | Reenviar com link expirado | `link_expired_need_new` + mensagem orientando a gerar novo link; `attempts` inalterado | **0** |
| 5 | Gerar novo link | Token antigo revogado (410), novo token válido (302 → arquivo idêntico); link do outro produto preservado; `attempts` → 3 | **1** |
| 6 | Dois cliques simultâneos em Reenviar | Um bloqueado por `send_in_progress_or_recent`, um enviado; `attempts` 3 → 4 | **1** |
| 7 | Download pelo link do e-mail | 302 → signed URL → 200, 39 bytes, SHA-256 idêntico ao original | **0** |
| 8 | Isolamento entre lojas | `A owns A=true`, `A owns B=false`, `B owns A=false`, `B owns B=true` | **0** |
| 9 | Status `pending`, `refunded`, `cancelled` | `payment_not_approved` / `payment_blocked`; 0 entregas, 0 tokens, 0 linhas de e-mail | **0** |
| 10 | Caso-limite: 2 produtos, um link expirado | Clique no expirado → erro claro, **0** e-mails; clique no válido → e-mail contendo **apenas** o link válido, nenhum token novo | **1** |

**Total de e-mails enviados ao destinatário controlado: 6.** Nenhum e-mail foi enviado em atualizações internas, downloads, mudanças de status ou falhas de teste.

Validações adicionais: `npm test` → **553 testes, 0 falhas**; `npm run build -- --mode homolog` → OK; funções `digital-delivery`, `payments`, `webhooks-mercadopago` e `webhooks-paypal` publicadas em homologação; função temporária `digital-email-fix-test` excluída de homologação e removida do repositório.

Limpeza: todos os pedidos, entregas, tokens, eventos, registros de e-mail, produtos, catálogos, usuários e arquivos de teste removidos. Contagem final em homologação: `orders=2, digital_deliveries=0, digital_download_tokens=0, digital_download_events=0, digital_order_emails=0` — iguais ao início.

## 6. Aviso importante sobre produção (transparência)

Durante o diagnóstico descobri que `supabase db query --linked` usa um **link global** apontando para produção (`wdcufpvlbisnqtvmbyso`), embora `supabase/config.toml` e os deploys usem `--project-ref ardpqimdllzbbdvwamkh`. Em consequência, o arquivo de migration de idempotência foi aplicado em produção **por engano** nessa única ocasião.

Ação imediata: reverti exatamente os três objetos criados (`digital_order_emails`, `claim_digital_order_email`, `finish_digital_order_email`) com `drop ... if exists` e verifiquei o resultado: **0 tabelas e 0 funções** na produção. Nenhum dado foi lido ou modificado, nenhuma credencial/Secret foi tocada, nenhuma função foi publicada, nenhum e-mail ou cobrança foi enviado. A migration correta foi aplicada em homologação via Management API com `project-ref` explícito e confirmada (Postgres 17.12, objetos presentes). A verificação final de produção foi repetida ao fim dos testes: continua **0/0**.

## 7. Estado final

- Commit `d2dc13e` enviado para `main` (`ddb368d..d2dc13e`).
- Nenhum deploy de frontend ou funções foi feito em produção.
- **Não avançar para produção** sem autorização explícita; quando autorizado, aplicar a migration em produção de forma intencional e repetir a validação.
