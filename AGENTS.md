<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

# Vitrine Criativa — Work State

## Objective
- Mobile-first catalog platform: sellers create catalogs, buyers order via WhatsApp
- Deployed on Cloudflare Workers at `https://vitrine.meellcriativa.workers.dev` (worker `vitrine`, account `meellcriativa`)

## Important Details
- Repo owner: MeellCriativa; pushes via `agendacreator-pro` collaborator
- Git config: `user.name=agendacreator-pro`, `user.email=agendacreator-pro@users.noreply.github.com`
- Repo cloned at `C:\Users\USER\Documents\Default Project`
- Tech stack: TanStack Start (React 19 + Vite), TypeScript, Tailwind 4, shadcn/ui, Supabase, Nitro with cloudflare-module preset
- Supabase project `wdcufpvlbisnqtvmbyso` — URL `https://wdcufpvlbisnqtvmbyso.supabase.co`; anon + service-role keys in `.env`
- Build: `npm run build` (Vite reads `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` from `.env` automatically). **NEVER set these env vars manually on the command line** — a transposed-character typo in the anon key (`xr`→`rx`, pos 191-192) baked into the deployed bundle caused 401 "Invalid API key" on ALL browser data fetches → public vitrine didn't load (stuck spinner; fixed by rebuilding from `.env`, commit `04acaeaf` worker). If you must override, read from `.env`: `$env:VITE_SUPABASE_PUBLISHABLE_KEY=([regex]::Match((Get-Content .env -Raw),'VITE_SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"]+)"','Singleline').Groups[1].Value -replace '\s','')`
- Deploy frontend: `cd .output && npx wrangler deploy --name vitrine`
- Supabase CLI logged in (verified `supabase projects list`); Edge Functions deployed
- User runs SQL manually in Supabase SQL Editor (small blocks; Node.removeChild browser bug)
- PowerShell: cannot use `&&`; use `; if ($?)`; no `head` — use `Select-Object -First N`
- User requires: always commit and push without asking
- **PAINEL — manter PERMANENTEMENTE (decisão do usuário, 19/11/2026)**: o `/painel` deve SEMPRE conter (1) o campo **"Editar link da loja"** com o prefixo `/c/` e o botão **Salvar** no card "Link da minha loja", e (2) o card **"Moeda principal da loja"** com `CurrencyPicker` + botão Salvar **logo acima do atalho "Conversor de moedas"**. Restaurados do commit `16e37d1` em `src/routes/painel.index.tsx` (com chaves i18n em `panel.ts`). Não remover, não mover de lugar e não substituir por controle equivalente em Personalizar. Qualquer alteração futura no painel deve preservar esses dois recursos.
- **Push auth gotcha**: `gh` is logged in as `geansilveiraprodartivs-tech` (no push rights) and its credential helper overrides git. A plain `git push` fails 403. Push with the `agendacreator-pro` credential stored in Windows Credential Manager: `git -c credential.https://github.com.helper=manager push https://agendacreator-pro@github.com/MeellCriativa/creative-showcase.git main`
- **Melhor Envio tokens**: `status` now validates/refreshes the token; any call (incl. public `quote`) auto-refreshes if within the 45d refresh window. If a store is fully idle >45d both tokens die → owner must reconnect OAuth in `/painel/envio` (panel shows "Conexão expirada"). On refresh failure the account is auto-marked `connected=false`.
- **PRODUÇÃO — pedidos não eram gravados (18/11)**: a política RLS `orders_anon_insert` foi removida (execução parcial da migration `20261115090000`) e a Edge Function `payments` nunca foi publicada → checkout caía em erro/WhatsApp sem gravar pedido. O checkout agora detecta backend ausente (`isPaymentsBackendUnavailable`) e grava direto em `orders` (`insertOrderDirectly`). **Falta rodar** `supabase/fixes/20261118_restore_orders_anon_insert.sql` no SQL Editor para a política voltar (sem ela o insert anônimo falha com `new row violates row-level security policy`).

## Work State

### Completed
- **Vírgula decimal nas opções de valor do checkout (22/11, commit `9e1c45e`)**: o campo convertia o texto para número a cada tecla e apagava a vírgula; agora o texto digitado é preservado (`src/lib/decimalInput.ts`), normalizado para `59,90` ao sair do campo e convertido com segurança ao salvar. Teste de regressão em `tests/decimal-input.test.ts`. 568/568 testes passando; `tsc --noEmit` limpo. Workers: homologação `48776338`, produção `0ed1995f`. Smoke test do catálogo de produção sem erros de console.
- **Checkout personalizado/Pix em produção (22/11)**: SQL `supabase/fixes/20261122_producao_checkout_produtos_pix.sql` aplicado pelo usuário no SQL Editor (blocos em `supabase/fixes/producao_blocos/`, commit `5d33f68`). Verificado via PostgREST: colunas `products.additional_info/digital_delivery_mode/checkout_*/pix_*`, `catalogs.pix_*`, `orders.payment_method/pix_*`, tabelas `product_testimonials`/`manual_payment_confirmations` e RPC `confirm_manual_payment` (retorna `false` para UUID inexistente). `pix_holder_document` bloqueado para anon; `catalogs_public` segue legível. `pix-manual?action=config` responde 200 com CORS `*` em produção. Carrinho real validado: link `?produto=&valor=` pré-seleciona valor, Mercado Pago sem PayPal e sem WhatsApp como pagamento, seletor "Moeda de exibição", console limpo. Worker produção `c58aca85`; homologação `bd4ee12b`.
- Full DB schema on `wdcufpvlbisnqtvmbyso` — catalogs, categories, products, banners, orders, catalog_visits + RLS policies + `catalogs_public` view + storage bucket `catalog-images` + triggers
- Meta tables created but empty (RLS working); Meta/WhatsApp integration UI **blocked** with "Em breve" (commit `8a593ca`)
- **Melhor Envio shipping implemented** (Correios + transportadoras, multi-tenant — REPLACES the rejected Correios direct API):
  - **IMPORTANT CORS FIX (commit `3895182`)**: OAuth "Conectar" failed in browser with generic error. ROOT CAUSE: Edge Function returned CORS headers ONLY on the OPTIONS preflight, but actual responses (`jsonRes`) had no `Access-Control-Allow-Origin`/`Allow-Methods` → browser blocked the fetch → generic catch. FIXED: `_shared/cors.ts` now includes `Access-Control-Allow-Methods: GET, POST, OPTIONS`; `_shared/melhor-envio.ts` merges `corsHeaders` into `jsonRes` and the inline `not_connected` Response. Redployed both functions + worker `9e909538`. Verified: preflight AND real 200/401 responses return `Access-Control-Allow-Origin:*`. `meCall` in `shipping.ts` and `handleConnect` in `painel.envio.tsx` now log real errors and surface `res.error` instead of hiding it.
  - Migration `supabase/migrations/20260827130000_add_melhor_envio_shipping.sql` (NOT yet run by user): catalogs `delivery_methods`+`shipping_origin_zip`; products weight/dims; orders shipping/address/subtotal **+ ME pipeline columns** (me_order_id, me_agency_id, me_tracking, me_status, me_protocol, me_label_id, me_label_url); **new `melhor_envio_accounts` table** (per-catalog OAuth token + sender address, RLS owner-only); recreates `catalogs_public` view
  - Edge Function router `supabase/functions/melhor-envio/index.ts` — actions: status/connect/disconnect/save_sender/quote/cart/checkout/generate/print/tracking/agencies; quote is public (buyer), everything else owner-auth via verifyUser; token auto-refresh per store
  - Edge Function `supabase/functions/melhor-envio-callback/index.ts` — OAuth redirect, exchanges code, stores per-store token, redirects to `/painel/envio`
  - Shared helper `supabase/functions/_shared/melhor-envio.ts` — token load/refresh, `meApi`, sandbox/production base from `ME_ENV`
  - `src/lib/shipping.ts` — `quoteShipping()` calls `/functions/v1/melhor-envio?action=quote`; `meApi` client (status/connect/disconnect/saveSender/cart/checkout/generate/print/tracking/agencies)
  - `src/lib/catalog.ts` — `DELIVERY_METHODS` key `melhor_envio`; OrderItem stores weight/dims; Order has ME columns; ShippingQuote = serviceId/name/price/delivery_min/max/agencyRequired/collect
  - Admin `src/routes/painel.envio.tsx` — connect via OAuth (per store), sender (remetente) address form, disconnect, sandbox/production badge; nav tab "Envio" added (grid-cols-8)
  - Checkout (`c.$slug.tsx` CartSheet): real ME service quotes (PAC/SEDEX/transportadoras), CEP, address → saves freight to order
  - Orders panel (`painel.pedidos.tsx`): ME shipping block + buttons "Criar envio → Pagar envio → Gerar etiqueta → Imprimir/Rastrear"
  - Admin "Formas de entrega" + CEP de origem (painel.personalizar.tsx); weight/dims on product form (painel.produtos.tsx) reference Melhor Envio

### Blocked / Pending
- **Notificação de novo pedido (22/11, commit `c8cec39`)**: e-mail ao vendedor via Brevo + toast/badge no painel em tempo real. Código, testes (573/573), Edge Functions (`payments` e `seller-order-notify`) e worker de homologação (`0a9c0788`) publicados. **Falta o usuário rodar os 4 blocos de `supabase/fixes/blocos_notificacoes_vendedor/` no SQL Editor da homologação (`ardpqimdllzbbdvwamkh`) e depois da produção (`wdcufpvlbisnqtvmbyso`)** — sem o trigger/RLS/Realtime nada é disparado. Só publicar em produção após validar um pedido de teste em homologação. Migration canônica: `supabase/migrations/20261122150000_seller_order_notifications.sql`.
- **SQL migration applied SUCCESSFULLY** (3 parts, user-confirmed; verified all columns + `melhor_envio_accounts` table exist)
- **Supabase CLI logged in + project `wdcufpvlbisnqtvmbyso` linked** (verified via `supabase projects list`)
- **Front auto-freight live**: buyer types CEP → freight calculated automatically + product+freight total shown immediately (commit `270b1e5`, worker Version `9aa3c206`)
- **Deploy Edge Functions DONE**: `melhor-envio` and `melhor-envio-callback` deployed (verified: `status`→401 without owner auth, public `quote`→200 `not_connected`), project linked
- **Secrets set DONE** on deployed functions: `ME_CLIENT_ID=11518`, `ME_CLIENT_SECRET=<hidden>`, `ME_ENV=sandbox`, `VITRINE_URL`. NOTE: `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are auto-injected by Supabase runtime (CLI rejects `SUPABASE_` prefixed secrets) — do NOT set them.
- **Melhor Envio Sandbox app 11518 registered** (redirect URI = `https://vitrine.meellcriativa.workers.dev/functions/v1/melhor-envio-callback`)
- **NEXT (user)**: connect store via OAuth in `/painel/envio` (Conectar), fill remetente/sender, set product weight/dims, mark delivery in store settings
- **Each store owner** must create/own a Melhor Envio account (free) and authorize via `/painel/envio`; access_token valid 30d, refresh 45d (auto-refresh implemented)
- **DCe / SEFAZ (non-commercial invoice)** — from 06/04/2026 non-commercial sending enforced by ME; `non_commercial: true` set, `from.state_register: "ISENTO"`; commercial option not yet wired in UI
- Meta Developer app not created (SMS verification failing)

## Next Move
1. **(User)** Connect store in `/painel/envio` via OAuth (Conectar) → sandbox login → back to `/painel/envio?me_connected=1` → fill remetente/sender
2. **(User)** Store settings: mark delivery method "Envio (Correios e transportadoras)" + set CEP de origem; set product weight/dims
3. Test: buyer quotes CEP (auto-freight) → order → Criar envio → Pagar envio → Gerar etiqueta → Imprimir/Rastrear (sandbox, no spend)
4. For production: re-register app in Prod Área Dev, `ME_ENV=production`
5. Known limits: agency-required services (Latam/Azul/Buslog) need agency selection (not yet in UI); commercial/invoice path optional


