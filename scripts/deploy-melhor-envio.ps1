# =====================================================================
#  Vitrine Criativa - Deploy Melhor Envio (Edge Functions + Secrets)
#
#  Execute quando tiver a conta do app da Melhor Envio (Área Dev).
#  Vai pedir apenas:
#    1) ME_CLIENT_ID
#    2) ME_CLIENT_SECRET
#    3) ME_ENV (sandbox | production)
#  O restante roda automático (login, link, deploy das funções, secrets).
#
#  ANTES: na Melhor Envio (Área Dev) defina o redirect URI (CALLBACK) para:
#     https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/melhor-envio-callback
# =====================================================================

$ErrorActionPreference = "Stop"
$PROJECT_REF = "wdcufpvlbisnqtvmbyso"
$SUPABASE_URL = "https://wdcufpvlbisnqtvmbyso.supabase.co"
$SERVICE_ROLE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndkY3VmcHZsYmlzbnF0dm1ieXNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzY2ODM0MCwiZXhwIjoyMTAzMjQ0MzQwfQ.pfPUmQeSErbkyBf54HtaKxEdIywv4tFCe6LUmYZS6TY"
$VITRINE_URL = "https://vitrine.meellcriativa.workers.dev"

Write-Host ""
Write-Host "=============================="
Write-Host " Deploy Melhor Envio"
Write-Host "=============================="

$clientId = Read-Host "ME_CLIENT_ID (do app na Area Dev)"
$clientSecret = Read-Host "ME_CLIENT_SECRET (do app na Area Dev)"
if ([string]::IsNullOrWhiteSpace($clientId) -or [string]::IsNullOrWhiteSpace($clientSecret)) {
  Write-Host "ERRO: ME_CLIENT_ID e ME_CLIENT_SECRET sao obrigatorios." -ForegroundColor Red
  exit 1
}

$env = Read-Host "ME_ENV [sandbox|production]"
if ([string]::IsNullOrWhiteSpace($env)) { $env = "sandbox" }
if ($env -ne "sandbox" -and $env -ne "production") {
  Write-Host "ERRO: ME_ENV deve ser 'sandbox' ou 'production'." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "== Supabase login ==" -ForegroundColor Cyan
supabase login
if ($LASTEXITCODE -ne 0) { Write-Host "Login falhou." -ForegroundColor Red; exit 1 }

Write-Host "== Vinculando projeto ==" -ForegroundColor Cyan
supabase link --project-ref $PROJECT_REF
supabase config set project_id $PROJECT_REF 2>$null

Write-Host "== Deploy Edge Function: melhor-envio ==" -ForegroundColor Cyan
supabase functions deploy melhor-envio --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { Write-Host "Deploy melhor-envio falhou." -ForegroundColor Red; exit 1 }

Write-Host "== Deploy Edge Function: melhor-envio-callback ==" -ForegroundColor Cyan
supabase functions deploy melhor-envio-callback --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { Write-Host "Deploy melhor-envio-callback falhou." -ForegroundColor Red; exit 1 }

Write-Host "== Set secrets ==" -ForegroundColor Cyan
supabase secrets set `
  --project-ref $PROJECT_REF `
  ME_CLIENT_ID=$clientId `
  ME_CLIENT_SECRET=$clientSecret `
  ME_ENV=$env `
  SUPABASE_URL=$SUPABASE_URL `
  SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE `
  VITRINE_URL=$VITRINE_URL
if ($LASTEXITCODE -ne 0) { Write-Host "Set de secrets falhou." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "==============================" -ForegroundColor Green
Write-Host " Concluido com sucesso!" -ForegroundColor Green
Write-Host "==============================" -ForegroundColor Green
Write-Host "Ambiente: $env"
Write-Host ""
Write-Host "Lembre:"
Write-Host "  1) Cada loja conecta OAuth em /painel/envio (botao Conectar)."
Write-Host "  2) Preencha os dados do remetente apos conectar."
Write-Host "  3) No app da Melhor Envio, o redirect URI (callback) deve ser:"
Write-Host "     https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/melhor-envio-callback"
