# Vitrine Criativa — Relatório Definitivo de Publicação em Produção

**Data:** 20 de novembro de 2026
**Ambiente:** PRODUÇÃO (não é homologação)
**Status final:** Publicação concluída e verificada. Pagamentos reais Mercado Pago e PayPal permanecem desativados por decisão financeira, não por falha técnica.

---

## 1. Identificação do ambiente

| Item | Valor |
| --- | --- |
| Projeto Supabase de produção | `wdcufpvlbisnqtvmbyso` |
| URL Supabase | `https://wdcufpvlbisnqtvmbyso.supabase.co` |
| Worker Cloudflare | `vitrine` |
| URL pública | `https://vitrine.meellcriativa.workers.dev` |
| Conta Cloudflare | `c21b9f85e0cdd1c72359d8d296b1f3e9` (`vitrinecriativameell@gmail.com`) |
| Homologação (referência, NÃO publicada) | Supabase `ardpqimdllzbbdvwamkh` / Worker `vitrine-homolog` |

---

## 2. Versões publicadas

### Código-fonte (Git)
- **HEAD final:** `51311bc84d3509ec229eb7adec34781930a65deb`
- Commits desta publicação:
  - `016aa93` — consolida correções P0–P15 e correção TDZ (`payments/index.ts`)
  - `35c8cf3` — schema financeiro aditivo de produção (sem habilitar cobranças)
  - `51311bc` — restringe leitura anônima de `catalogs` à view pública
- Todos os commits foram enviados para `main` (`MeellCriativa/creative-showcase`) via credencial `agendacreator-pro`.

### Frontend (Worker `vitrine`)
- **Versão ativa:** `40b89b3d-9715-4468-8904-85f142f733bd` (100% do tráfego)
- **Publicada em:** 2026-11-20T07:24:12.902Z
- **Autor do deploy:** `vitrinecriativameell@gmail.com`
- Build local: `npm run build` com `.env` íntegro (7 variáveis, uma por linha); bundle contém 22 referências ao projeto de produção, 0 de homologação e a chave pública correta. A chave de service role **não** está no bundle (confirmado por chave completa e sufixo).

### Edge Functions (Supabase produção)
| Função | Status | Versão | verify_jwt |
| --- | --- | --- | --- |
| `payments` | ACTIVE | 1 | `false` |
| `payments-callback` | ACTIVE | 1 | `false` |
| `webhooks-mercadopago` | ACTIVE | 1 | `false` |
| `melhor-envio` | ACTIVE | 10 | `false` (preexistente, não alterada) |
| `melhor-envio-callback` | ACTIVE | 5 | `false` (preexistente, não alterada) |
- Deploy com `--use-api --no-verify-jwt`, **sem `--prune`**.
- **`webhooks-paypal` NÃO foi publicada.**

---

## 3. Migrações e alterações de banco aplicadas

Todas são **aditivas ou de endurecimento**, sem exclusão/atualização de dados, sem remoção de colunas e sem tabelas destrutivas.

1. **`supabase/fixes/20261120_harden_orders_anon_insert_production_compat.sql`** — política `orders_anon_insert` compatível com o schema atual de produção (já aplicada e verificada).
2. **`supabase/fixes/20261120_payment_schema_additive_production.sql`** (commit `35c8cf3`) — cria:
   - colunas em `orders`: `payment_status`, `payment_provider`, `payment_transaction_id` + constraints;
   - tabelas `payment_connections`, `order_checkout_sessions`, `payment_transactions`, `payment_events`, `payment_refunds`, `payment_oauth_states`, `payment_rate_limits`;
   - função `bump_payment_rate_limit` (somente `service_role`);
   - RLS ativo nas 7 tabelas novas, com negação por padrão para `anon`/`authenticated` e grants restritos de leitura ao dono.
3. **`supabase/fixes/20261120_harden_catalogs_anon_read_production.sql`** (commit `51311bc`) — remove leitura anônima direta em `public.catalogs`; mantém `anon` → `catalogs_public` e dono autenticado → `catalogs` via RLS.

### Verificação das migrações
- 7 tabelas financeiras existem, **todas com `rowsecurity = true`**, todas vazias (0 conexões, 0 transações, 0 eventos, 0 reembolsos, 0 sessões, 0 OAuth states, 0 rate limits).
- `anon` em `catalogs`: **sem SELECT**. `anon` em `catalogs_public`: **com SELECT**. `authenticated` em `catalogs`: **com SELECT**.
- API anônima: `catalogs_public` → 200; `catalogs` → 401; `payment_connections` → 401.
- A migração base `20261115090000_add_payment_providers.sql` **não foi aplicada** (revogaria `anon` em `catalogs` e `orders` de forma incompatível com a vitrine atual).

### Integridade dos dados de produção
| Tabela | Linhas |
| --- | --- |
| `catalogs` | 14 |
| `products` | 87 |
| `categories` | 21 |
| `orders` | 17 |
| `banners` | 9 |

Nenhuma linha foi excluída ou modificada. Multi-tenancy preservado (5 primeiras lojas com `user_id` distintos).

---

## 4. Testes e validações

- **`npm test`: 490 testes, 490 aprovados, 0 falhas** (duração ~8,3 s).
- `node --test tests/payment-homologacao-final.test.ts`: 4/4 aprovados (regressão TDZ).
- `git diff --check`: limpo.
- **Correção TDZ validada no diff final:** `const orderId` (linha 345) → `attemptDigest` (linha 357) → `const order` (linha 371) em `supabase/functions/payments/index.ts`, na ordem correta, sem uso antes da declaração.
- `wrangler deploy --dry-run --name vitrine --keep-vars`: confirmou Worker e assets antes do deploy real.

---

## 5. Verificações pós-deploy (sem pagamentos reais)

### Rotas HTTP — todas 200, sem marcadores de erro
`/`, `/auth`, `/c/meell-criativa`, `/painel`, `/painel/pagamentos`, `/painel/pedidos`, `/painel/produtos`, `/painel/personalizar`, `/painel/envio`, `/painel/categorias`, `/painel/conversor`, `/painel/estatisticas`, `/painel/senha`, `/painel/whatsapp`.

### Browser (Chromium integrado)
- **Vitrine pública `/c/meell-criativa`:** título "Meell Criativa — Vitrine Criativa"; após o gatilho "ENTRAR PARA VER CATÁLOGO" (portal de visualização, sem criação de conta), renderizam **10 produtos reais** com nomes, preços, categorias e 2 banners, incluindo "Kit Cute Vibe 🩷 pré venda", "Capas e miolo Sweet Vibes", "Agenda Creator pro", "Clubinho Meell Criativa". Nenhum erro de console.
- **`/painel` não autenticado:** redireciona para `/auth`, exibe formulário de e-mail/senha, "Esqueci minha senha" e "Pedir acesso pelo WhatsApp". Nenhum erro de console.
- Auth health: `GET /auth/v1/health` → 200 (GoTrue v2.198.0).

### Sondas das Edge Functions
| Sonda | Resultado | Interpretação |
| --- | --- | --- |
| `payments?action=methods&slug=meell-criativa` | 200, `methods: []`, `currency: BRL` | Nenhum meio de pagamento habilitado — fail-closed |
| `payments?action=create_order` com carrinho vazio | 400, `code: empty_cart` | Validação ativa, nenhum pedido/pagamento criado |
| `webhooks-mercadopago` sem assinatura | 503, `Provedor não configurado.` | Recusa explícita por falta de credenciais — fail-closed |
| `payments-callback?state=invalid` | 302 → `/painel/pagamentos?connected=0&error=invalid_state` | Estado inválido rejeitado |
| `melhor-envio?action=status` | 401 | Funcionalidade preexistente intacta (exige dono autenticado) |

---

## 6. Funcionalidades disponíveis em produção

- Catálogos, produtos, categorias, banners, busca e filtros por categoria.
- Carrinho e pedidos via WhatsApp (sem conta), com endereço e frete do Melhor Envio.
- Painel do vendedor: link da loja (`/c/`), moeda principal (`CurrencyPicker`) logo acima do atalho "Conversor de moedas", produtos, categorias, pedidos, personalização, estatísticas, senha, WhatsApp, Envio (Melhor Envio) e Pagamentos.
- Autenticação (login, recuperação de senha, solicitação de acesso via WhatsApp).
- Multi-idioma, conversor de moedas, Melhor Envio (Correios/transportadoras) — preservados.
- Isolamento por loja via RLS em todas as tabelas de negócio.

---

## 7. Estado real de Mercado Pago e PayPal

### Mercado Pago
- Código técnico auditado (P0–P15 + TDZ) **publicado** e funcionando.
- **Nenhuma conexão OAuth de vendedora** existe em produção (`payment_connections` vazia).
- **Nenhum Secret Mercado Pago** configurado (`supabase secrets list` contém apenas `ME_*` e gerenciados pelo Supabase).
- **Nenhuma transação, evento, reembolso ou sessão de checkout** criada.
- `methods` retorna `[]`; `create_payment` permanece **fail-closed**; webhook recusa sem assinatura.
- **Não houve nenhuma cobrança real, nem mesmo de teste.**

### PayPal
- Implementação preservada integralmente; **nenhuma alteração não auditada** foi feita.
- `webhooks-paypal` **não foi publicada**.
- **Nenhum Secret PayPal** configurado; nenhuma cobrança real ou de teste.

### Por que continuam desativados
A autorização para publicar cobranças depende de comprovação financeira que ainda não existe:
1. OAuth realizado pela própria vendedora, com token correto e escopo válido;
2. Associação inequívoca pagamento → pedido → vendedor;
3. Comprovação do destino do dinheiro (conta da vendedora, não a principal);
4. Split 1:1 sem comissão validado;
5. Webhook real assinado e liquidado;
6. Atualização financeira e ciclo de reembolso verificados.

`client_credentials` **não** é usado como substituto do vendedor.

---

## 8. Pendências externas (não bloqueiam o restante da plataforma)

- Vendedora realizar OAuth Mercado Pago em `/painel/pagamentos` e validar liquidação na própria conta.
- Cadastro do webhook real no painel do Mercado Pago apontando para `https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/webhooks-mercadopago`, com Secret correspondente.
- Comprovação financeira PayPal (recebimento na conta correta) antes de qualquer habilitação.
- (Preexistente, fora do escopo desta publicação) Conexão Melhor Envio por loja em `/painel/envio`, remetente, pesos/dimensões e CEP de origem.

Nenhuma dessas pendências impede vitrines, pedidos via WhatsApp ou o painel de funcionar.

---

## 9. Rollback

| Componente | Ação de rollback |
| --- | --- |
| Frontend | `npx wrangler versions deploy f9a7bc8b-f6b1-4c62-b2d4-83bd7237f4a9 --name vitrine` (versão imediatamente anterior, 2026-11-19T19:08:18.544Z) |
| Funções MP | `supabase functions list` + desativação/redeploy das versões anteriores; não havia funções MP antes, então remover `payments`, `payments-callback` e `webhooks-mercadopago` retorna ao estado original |
| Banco | Migrações são aditivas: não há dados a restaurar. O endurecimento de `catalogs` pode ser revertido com `grant select on public.catalogs to anon` + recriação da política `catalogs_anon_read`, se necessário |
| Git | `git revert` dos commits `51311bc`, `35c8cf3` e `016aa93` (não foi reescrita nenhuma história já publicada) |

---

## 10. Conclusão

A publicação em produção foi **concluída e verificada**. Código, banco, funções e frontend estão no ar. Os dados de produção (14 lojas, 87 produtos, 17 pedidos, 9 banners) estão intactos e o isolamento por RLS foi reforçado. A suíte completa de 490 testes passou e a correção TDZ está presente no diff final.

Mercado Pago e PayPal permanecem **tecnicamente prontos, mas financeiramente desativados**: nenhuma credencial, conexão, cobrança ou liquidação foi criada. Não é correto afirmar que pagamentos reais estão funcionando — a habilitação depende das comprovações listadas na seção 7.
