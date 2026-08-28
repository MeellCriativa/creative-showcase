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
- Build: set env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`) then `npm run build`; deploy: `cd .output && npx wrangler deploy --name vitrine`
- Supabase CLI NOT logged in — cannot deploy Edge Functions; needs `supabase login`
- User runs SQL manually in Supabase SQL Editor (small blocks; Node.removeChild browser bug)
- PowerShell: cannot use `&&`; use `; if ($?)`; no `head` — use `Select-Object -First N`
- User requires: always commit and push without asking

## Work State

### Completed
- Full DB schema on `wdcufpvlbisnqtvmbyso` — catalogs, categories, products, banners, orders, catalog_visits + RLS policies + `catalogs_public` view + storage bucket `catalog-images` + triggers
- Meta tables created but empty (RLS working); Meta/WhatsApp integration UI **blocked** with "Em breve" (commit `8a593ca`)
- **Melhor Envio shipping implemented** (Correios + transportadoras, multi-tenant — REPLACES the rejected Correios direct API):
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
- **User must run SQL migration** `20260827130000_add_melhor_envio_shipping.sql` in Supabase SQL Editor (recreate view + new columns + new table)
- **Deploy Edge Functions** `melhor-envio` and `melhor-envio-callback` — requires `supabase login` (CLI NOT logged in)
- **Set function secrets** on the deployed functions: `ME_CLIENT_ID`, `ME_CLIENT_SECRET`, `ME_ENV` (sandbox|production), and confirm `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `VITRINE_URL` are set
- **Register platform Melhor Envio app** (Área Dev): Sandbox `https://app-sandbox.melhorenvio.com.br/integracoes/area-dev`, Prod via Painel → Integrações → Área Dev; set redirect URI to `${VITRINE_URL}/functions/v1/melhor-envio-callback`; note client_id/secret
- **Each store owner** must create/own a Melhor Envio account (free) and authorize via `/painel/envio`; access_token valid 30d, refresh 45d (auto-refresh implemented)
- **DCe / SEFAZ (non-commercial invoice)** — from 06/04/2026 non-commercial sending enforced by ME; `non_commercial: true` set, `from.state_register: "ISENTO"`; commercial option not yet wired in UI
- Meta Developer app not created (SMS verification failing)

## Next Move
1. Tell user to run the SQL migration manually (`20260827130000_add_melhor_envio_shipping.sql`) in Supabase SQL Editor
2. After `supabase login`: deploy both Edge Functions (`melhor-envio`, `melhor-envio-callback`) with secrets
3. User registers the platform ME app (Sandbox first) → set `ME_CLIENT_ID`/`ME_CLIENT_SECRET`/`ME_ENV=sandbox`; test OAuth connect in `/painel/envio`
4. Test first quote → then label in sandbox (no spend); then switch `ME_ENV=production`, re-register app, real labels
5. Known limits: agency-required services (Latam/Azul/Buslog) need agency selection (not yet in UI); commercial/invoice path optional


