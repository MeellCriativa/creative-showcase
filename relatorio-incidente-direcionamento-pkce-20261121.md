# Relatório de incidente — divergência de direcionamento CLI × banco

**Data:** 21/11/2026 (UTC)
**Escopo desta etapa:** correção local de direcionamento + auditorias READ-ONLY + relatório.
**Produção:** `wdcufpvlbisnqtvmbyso`
**Homologação:** `ardpqimdllzbbdvwamkh`

---

## 1. Confirmação do projeto selecionado

### 1.1 Correções locais executadas (autorizadas)

| Item | Antes | Depois |
|---|---|---|
| `supabase/config.toml` → `project_id` | `wdcufpvlbisnqtvmbyso` | `ardpqimdllzbbdvwamkh` |
| `.temp/project-ref` | `ardpqimdllzbbdvwamkh` | `ardpqimdllzbbdvwamkh` |
| `.temp/linked-project.json` → `ref` | `ardpqimdllzbbdvwamkh` | `ardpqimdllzbbdvwamkh` |
| `.temp/pooler-url` → usuário do pooler | `postgres.ardpqimdllzbbdvwamkh` | inalterado |
| `supabase link --project-ref` | — | executado novamente, retorno `project_ref=ardpqimdllzbbdvwamkh` |

### 1.2 Terceira fonte independente (Management API)

`GET https://api.supabase.com/v1/projects/ardpqimdllzbbdvwamkh` → **HTTP 200**,
`ref=ardpqimdllzbbdvwamkh`, `name=vitrine-criativa-homolog`, `region=us-east-1`,
`organization_id=eyhoekdfetrdfcycjdjh`.

### 1.3 ⚠️ Divergência que persiste — CLI não é fonte confiável

Apesar de **todos** os arquivos locais e da Management API apontarem homologação,
`supabase db query --linked` continua retornando **15 catálogos**, enquanto a
Management API consultada diretamente com `--project-ref` explícito retorna:

- produção `wdcufpvlbisnqtvmbyso` → **15 catálogos**
- homologação `ardpqimdllzbbdvwamkh` → **2 catálogos**

`supabase status` também ainda referencia o container `supabase_db_wdcufpvlbisnqtvmbyso`.

**Conclusão:** o vínculo local foi corrigido, mas a subcomando `db query --linked`
(provavelmente também `status`) continua resolvendo para produção. Toda a auditoria
deste relatório foi feita pela **Management API com `project_ref` explícito**, que é
a única fonte inequívoca. Nenhuma escrita foi feita nesta etapa.

---

## 2. Alterações realizadas em produção (decorrentes da execução equivocada)

Foram **duas** alterações, ambas já identificadas e caracterizadas:

### 2.1 DDL da migration PKCE — `20261120140000_payment_oauth_pkce.sql`

Aplicada em `public.payment_oauth_states`:

- `code_challenge text` (nullable)
- `code_verifier_encrypted text` (nullable)
- `payment_oauth_states_pkce_format`:
  `challenge` nulo ou `^[A-Za-z0-9_-]{43}$`; `verifier` nulo ou `^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$`; ambos nulos ou ambos preenchidos.

A migration é **aditiva e idempotente** (`add column if not exists`, constraint com
`exception when duplicate_object then null`). Não remove linhas, conexões, políticas
nem colunas.

### 2.2 Catálogo de teste órfão

| Campo | Valor |
|---|---|
| `id` | `aa220e73-979f-400c-a761-73cfb1656005` |
| `user_id` | `5639c882-b2f9-4cbb-a161-21f48e25ffff` |
| `slug` | `pkce-homolog-94d9955864` |
| `created_at` | `2026-11-21 04:03:39.219914+00` |

- O `user_id` **não existe** em `auth.users` de produção (`count = 0`) — ele foi criado
  no Auth de **homologação**.
- `catalogs.user_id` **não possui FOREIGN KEY** em produção, o que permitiu a inserção órfã.
- Dependentes: `products=0`, `categories=0`, `orders=0`, `banners=0`, `catalog_visits=0`.
- Nenhum pedido, transação ou webhook foi criado para este catálogo.

### 2.3 O que NÃO foi alterado em produção

| Verificação | Resultado |
|---|---|
| `payment_oauth_states` | 2 linhas, nenhuma com PKCE, nenhuma criada após 04:00 UTC |
| `payment_connections` | 0 |
| `payment_transactions` | 0 |
| `payment_events` | 1 (preexistente) |
| `payment_refunds` | 0 |
| `payment_rate_limits` | 22 (preexistentes) |
| RLS em `payment_oauth_states` | `true` (inalterado) |
| Constraints preexistentes | pkey, provider_check, ambas FKs — inalteradas |
| Secrets | nenhum alterado |
| Funções publicadas | `payments` v8, `payments-callback` v8, `webhooks-mercadopago` v8 — **não republicadas nesta etapa** |
| Cobranças / pagamentos / liquidação | nenhuma |
| PayPal | inalterado |
| Git | nenhum commit/push; último commit `9bcfb41`; 9 arquivos modificados + 2 untracked |

---

## 3. Estado atual da migration

| Projeto | Colunas PKCE | Constraint | Registro em `schema_migrations` |
|---|---|---|---|
| Produção `wdcufpvlbisnqtvmbyso` | **presentes** | **presente** | **ausente** (aplicada via query direta) |
| Homologação `ardpqimdllzbbdvwamkh` | **ausentes** | **ausente** | **ausente** |

Histórico de migrations em produção contém apenas `20261111120000`.
Histórico de homologação não contém `20261120140000`.

**Risco de drift:** como a DDL entrou em produção sem registro, um futuro
`supabase db push` tentará aplicá-la novamente. A migration é idempotente, então
a reexecução é segura, mas ela não é contabilizada no histórico.

---

## 4. Compatibilidade com o código publicado em produção

Bundles publicados (v8) foram obtidos via Management API
`GET /v1/projects/wdcufpvlbisnqtvmbyso/functions/<slug>/body` e extraídos
(ESZIP2.3). Busca por `code_challenge`, `code_verifier`, `pkce` e `PKCE`:
**nenhuma ocorrência** nas três funções.

O código v8 faz:

```ts
admin.from("payment_oauth_states").insert({
  nonce, catalog_id, provider, user_id, expires_at
});
```

Ou seja, grava `NULL` nas duas colunas novas. A constraint aceita explicitamente
ambas nulas, e o `consumeOAuthState` usa `.select("nonce")`, não `select *`.

**Conclusão:** a DDL em produção é compatível com as funções v8; não há quebra
de insert, update ou leitura. O efeito é apenas de schema aditivo não utilizado.

---

## 5. Impactos encontrados

1. **Schema de produção alterado sem autorização** — impacto principal, embora aditivo e compatível.
2. **Catálogo órfão em produção** — sem dependentes e sem usuário válido; não afeta checkout, catálogos reais nem pedidos.
3. **Drift de migration** — DDL presente sem registro no histórico.
4. **Ferramenta CLI não confiável** — `db query --linked` e `status` ainda resolvem produção mesmo após correção de todos os arquivos locais; precisa de diagnóstico antes de qualquer nova escrita.
5. **Nenhum impacto financeiro** — 0 conexões, 0 transações, 0 reembolsos, 0 cobranças, 0 acess tokens gerados.
6. **Nenhum dado sensível exposto** — nenhum token, Secret, verifier, hash ou credencial foi impresso.

Também em homologação foram criados, via Auth Admin, **3 usuários de teste**
(um deles o `pkce-homolog-*`; os outros dois decorrentes das tentativas de magic link
com parâmetro incorreto). Nenhum possui conexão de pagamento.

---

## 6. Estado de homologação

| Item | Estado |
|---|---|
| Funções publicadas | `payments` **v11**, `payments-callback` **v11**, `webhooks-mercadopago` **v11**, todas `ACTIVE`, `verify_jwt=false` |
| Migration PKCE | **não aplicada** |
| Colunas/constraint PKCE | **ausentes** |
| `payment_oauth_states` | 0 linhas |
| `payment_connections` | 0 |
| `payment_transactions` | 0 |
| `catalogs` | 2 |
| Catálogo de teste | **ausente** (o INSERT foi para produção) |
| Usuário de teste Auth | presente (`pkce-homolog-*@...`) |
| OAuth Sandbox real | **não executado** — nenhum `code_challenge` foi gerado com sucesso, nenhum access token, nenhuma conexão gravada |

As funções v11 publicadas em homologação esperam as colunas PKCE; como elas não
existem lá, um `connect` de Mercado Pago falharia no insert do `code_verifier_encrypted`.
Não foi feita tentativa adicional nesta etapa.

---

## 7. Plano de recuperação recomendado (aguardando autorização)

1. **Diagnóstico final da CLI** — descobrir por que `db query --linked`/`status`
   ignoram `config.toml`, `.temp/project-ref` e `linked-project.json`. Enquanto não
   houver causa confirmada, **proibir `db query --linked` para escrita**; usar apenas
   Management API com `project_ref` explícito.
2. **Decisão sobre produção:**
   - **Manter** a DDL PKCE (aditiva, compatível com v8) e registrar a migration no
     histórico de forma controlada; **ou**
   - **Reverter** removendo a constraint e as duas colunas — operação destrutiva
     que exige autorização expressa e verificação de dependências.
3. **Remover o catálogo órfão** `aa220e73-979f-400c-a761-73cfb1656005` de produção
   (sem dependentes; baixo risco, mas ainda assim requer autorização).
4. **Aplicar a migration em homologação** via Management API com `project_ref`
   explícito, conferindo colunas, constraint, RLS, grants e integridade.
5. **Realizar o OAuth Sandbox em homologação** com as funções v11 já publicadas,
   validando `code_challenge`/`S256`, verifier cifrado, conexão gravada, logs sem
   credenciais e regressão PayPal.
6. **Somente depois**, com autorização expressa, publicar em produção as funções
   com PKCE e executar a validação financeira completa.

---

## 8. Estado final desta etapa

- Nenhuma escrita em banco ou função foi realizada nesta etapa.
- Nenhum Secret foi alterado.
- Nenhum commit ou push foi feito.
- Arquivo local alterado: `supabase/config.toml` (somente `project_id`).
- Arquivo local criado: este relatório.
- Aguardando autorização para o plano de recuperação.
