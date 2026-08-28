# =====================================================================
#  Vitrine Criativa - Deploy Melhor Envio (Edge Functions + Migration)
#  Execute apenas UMA VEZ, com o supabase CLI logado.
#
#  1) Abrirá o navegador para login no Supabase (interativo).
#  2) Aplica a migration 20260827130000_add_melhor_envio_shipping.sql
#  3) Deploy das Edge Functions melhor-envio e melhor-envio-callback
#  4) Aplica os secrets (ME_CLIENT_ID, ME_CLIENT_SECRET, ME_ENV, etc)
#
#  Antes: pegue ME_CLIENT_ID / ME_CLIENT_SECRET no app da Melhor Envio
#  (Area Dev). NAO rode o passo 4 sem ter esses valores.
# =====================================================================

$ErrorActionPreference = "Stop"
$PROJECT_REF = "wdcufpvlbisnqtvmbyso"
$VITRINE_URL = "https://vitrine.meellcriativa.workers.dev"

Write-Host "== Supabase login =="
supabase login

Write-Host "== Vinculando projeto =="
supabase link --project-ref $PROJECT_REF

# Caso o link ainda aponte para outro projeto, force o ref
supabase config set project_id $PROJECT_REF 2>$null

Write-Host "== Aplicando migration de shipping / Melhor Envio =="
supabase db push --include-all

Write-Host "== Deploy Edge Function: melhor-envio =="
supabase functions deploy melhor-envio --project-ref $PROJECT_REF --no-verify-jwt

Write-Host "== Deploy Edge Function: melhor-envio-callback =="
supabase functions deploy melhor-envio-callback --project-ref $PROJECT_REF --no-verify-jwt

Write-Host ""
Write-Host "== Secrets =="
Write-Host "Informe os valores do app da Melhor Envio quando solicitado."
Write-Host "  ME_ENV deve ser 'sandbox' para testes ou 'production' para real."
$secretName = Read-Host "Nome do secret [ENTER para pular]"
if ($secretName -eq "") { $secretName = $null }
if ($secretName) {
  $secretValue = Read-Host "Valor do secret (classe somente leitura)"
  supabase secrets set $secretName=$secretValue --project-ref $PROJECT_REF
}

Write-Host ""
Write-Host "Defina os secrets abaixo (ex.:)"
Write-Host "  supabase secrets set ME_CLIENT_ID=SEU_ID CLIENT_SECRET=SUA_CHAVE ME_ENV=sandbox --project-ref $PROJECT_REF"
Write-Host "  VITRINE_URL=$VITRINE_URL"
Write-Host ""

Write-Host "== Concluido! Lembre: =="
Write-Host "  1) Cada loja conecta em /painel/envio (OAuth)."
Write-Host "  2) Na Melhor Envio, o redirect URI deve ser:"
Write-Host "     $VITRINE_URL/functions/v1/melhor-envio-callback"
