# Relatório — publicação da correção de e-mail digital em produção

Data: 22/11/2026 · Autorização recebida do usuário para publicar os commits `d2dc13e` e `25a3eb0`.

## 1. Project-ref utilizado

- **Produção:** `wdcufpvlbisnqtvmbyso` (`https://wdcufpvlbisnqtvmbyso.supabase.co`), PG 17.6.
- Todos os comandos Supabase usaram `--project-ref wdcufpvlbisnqtvmbyso` ou a Management API com `-Ref wdcufpvlbisnqtvmbyso`.
- **Nenhum comando `--linked` foi utilizado nesta publicação.**

## 2. Auditoria prévia (read-only)

| Verificação | Resultado |
|---|---|
| Tabela `digital_order_emails` | 0 (ausente) |
| RPCs `claim_digital_order_email` / `finish_digital_order_email` | 0 (ausentes) |
| Políticas/objetos residuais da reversão anterior | 0 |
| Migration `20261122010000` registrada | 0 (ausente) |
| Última migration antes da publicação | `20261120140000` |

## 3. Migrations aplicadas

1. `20261122010000_digital_order_email_idempotency.sql` — migration autorizada (tabela de controle por pedido, RPCs atômicas, bundle cifrado, RLS/grants).
2. `20261121120000_digital_delivery.sql` — **pré-requisito descoberto na auditoria**. Produção não possuía o schema base da entrega digital: `orders.customer_email`, as 8 colunas digitais em `products`, `digital_deliveries`, `digital_download_tokens`, `digital_download_events` e o bucket privado `digital-products`. Sem ele, o `payments` publicado falharia ao criar pedidos (`customer_email` é inserido de forma incondicional) e os links não teriam onde ser gravados. Migration aditiva, aplicada somente em produção com `project-ref` explícito.

As duas migrations foram aplicadas via Management API (`POST /v1/projects/<ref>/database/query`), que executa SQL direto e **não registra versão em `supabase_migrations.schema_migrations`**. A comprovação é a presença dos objetos no banco.

## 4. Commits publicados

- `d2dc13e` — `fix(digital): e-mail unico por compra, reenvio idempotente e novo link seguro (homolog)`
- `25a3eb0` — `docs(homolog): relatorio da correcao de e-mail unico digital`
- `HEAD` local e `refs/heads/main` remoto: `25a3eb0598cf1c29bd4524ff5bd63936d22ae393` (íntegros e alinhados).

## 5. Funções publicadas (production)

| Função | Versão | Status | verify_jwt |
|---|---:|---|---|
| `digital-delivery` | **1** (nova em produção) | ACTIVE | false |
| `payments` | 9 → **10** | ACTIVE | false |
| `payments-callback` | 9 → **10** | ACTIVE | false |
| `webhooks-mercadopago` | 9 → **10** | ACTIVE | false |

`melhor-envio` (v17) e `melhor-envio-callback` (v12) permaneceram intactos. `webhooks-paypal` **não estava publicado em produção** e não foi publicado (não há secrets PayPal no projeto).

## 6. Verificações de segurança (read-only, após publicação)

| Verificação | Resultado |
|---|---|
| 4 tabelas digitais presentes | ✅ |
| RLS ativo nas 4 tabelas | ✅ |
| 4 políticas owner-only presentes | ✅ |
| Grants `anon` em tabelas digitais | **0** ✅ |
| RPCs com `security definer`, `search_path=public` e execute apenas para `service_role`/`postgres` | ✅ |
| Lógica atômica das RPCs no `pg_proc` (status permitido + lock + cooldown / incremento de `attempts` + liberação de lock) | ✅ |
| Chamada segura da RPC com `order_id` inexistente | retornou `false`, 0 linhas afetadas ✅ |
| PK em `digital_order_emails.order_id` | ✅ |
| Bucket `digital-products` privado | ✅ |
| Contagem de pedidos em produção | 17 (inalterada) |
| Entregas/tokens/e-mails de teste criados | 0 ✅ |

Nenhum secret ou credencial foi lido, alterado ou definido por mim. Nenhuma compra real foi feita. Nenhum e-mail foi enviado em produção.

## 7. Um único e-mail por compra

A garantia foi comprovada pela estrutura publicada (PK por `order_id`, reserva atômica com lock/cooldown, `finish` transacional e um único `buildDeliveryEmail` com `items[]`) e pelos 10 testes executados em homologação: concorrência → 1 e-mail, replay → 0, reenvio → mesmo link (1), expirado → 0, novo link → 1, clique duplo → 1, download/status/isolation → 0, status bloqueado → 0, caso misto → 1. **Não foi feito envio real em produção**, por proibição de e-mails de teste a clientes e pela pendência de secrets de remetente (item 9).

## 8. Links de download

Endpoint `digital-delivery` publicado e responsivo em produção:

- `GET ?action=download&token=invalido` → **403** “Link inválido 🔒” (validação ativa, sem efeito colateral).
- `GET ?action=status` sem JWT → **401** “Não autorizado” (proteção do painel ativa).
- O fluxo completo (token SHA-256 → 302 signed URL → 200 com checksum idêntico) foi validado em homologação.

## 9. Pendências encontradas

1. **Secrets Brevo incompletos em produção.** `BREVO_API_KEY` apareceu no projeto **durante** esta publicação por ação externa (atualizado às `2026-11-22T01:04:35Z`); `BREVO_SENDER_EMAIL` e `BREVO_SENDER_NAME` **continuam ausentes**. `config()` exige os três → enquanto isso, nenhum e-mail será enviado. Requer configuração pelo usuário.
2. **Alteração externa de secrets.** Os secrets `SUPABASE_*` tiveram `updated_at` alterado de `2026-11-21T05:29Z` para `2026-11-22T01:03Z` durante a publicação. Não fui o autor; apenas observei na conferência read-only.
3. As migrations aplicadas via Management API não constam em `schema_migrations` (comportamento do endpoint de SQL direto). Objetos presentes e idempotentes; reaplicação é segura (`if not exists` / `create or replace`).
4. `webhooks-paypal` segue sem deploy em produção (fora do escopo autorizado; sem secrets PayPal).
5. Recomenda-se, após configurar os dois secrets restantes, validar uma compra digital real com destinatário controlado antes de liberar para clientes.

## 10. Conclusão

A correção foi publicada em produção com `project-ref` explícito, migrations e funções verificadas, e nenhum dado de cliente alterado. A publicação **não está 100% operacional** até que `BREVO_SENDER_EMAIL` e `BREVO_SENDER_NAME` sejam configurados — item 9. Nenhuma promoção adicional foi feita sem autorização.
