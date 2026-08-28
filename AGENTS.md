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
- **Correios shipping implemented** (commit `62ac0ae`, deployed):
  - Migration `supabase/migrations/20260827120000_add_correios_shipping.sql` (NOT yet run by user): catalogs `delivery_methods`+`shipping_origin_zip`; products weight/dims; orders shipping/address/subtotal; recreates `catalogs_public` view with new columns
  - `src/lib/shipping.ts` — `quoteShipping()` calls `/functions/v1/quote-shipping`
  - `supabase/functions/quote-shipping/index.ts` — official Correios PI (Preços e Prazos), returns graceful `not_configured` until env creds set
  - Admin: "Formas de entrega" + CEP de origem (painel.personalizar.tsx); weight/dims on product form (painel.produtos.tsx)
  - Checkout (c.$slug.tsx CartSheet): delivery method select, CEP + "Calcular frete" (ViaCEP auto-fill), modalidade options, address fields, freight in total
  - `finishOrder` saves delivery/address/freight + builds WhatsApp message; orders panel shows "📦 Envio pelos Correios" + address (painel.pedidos.tsx)

### Blocked / Pending
- **User must run SQL migration** `20260827120000_add_correios_shipping.sql` in Supabase SQL Editor
- **Correios API activation** — Edge Function needs env vars on deployed function: `CORREIOS_USER`, `CORREIOS_PASSWORD` (and optional `CORREIOS_CONTRATO`, `CORREIOS_CONTRATO_SENHA`)
- Deploy Edge Function `quote-shipping` requires `supabase login` (not logged in)
- Meta Developer app not created (SMS verification failing)

## Next Move
1. Tell user to run the SQL migration manually (includes view recreation)
2. After DB ready + `supabase login`: deploy `quote-shipping` Edge Function
3. Configure Correios API credentials to activate real freight calc (until then it reports "not configured")

