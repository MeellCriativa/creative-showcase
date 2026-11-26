# =====================================================================
#  Vitrine Criativa - Ativar Melhor Envio PRODUCAO (conta real)
#
#  Rode este script localmente com as credenciais do app que você criar
#  na Area Dev de https://melhorenvio.com.br (ambiente de producao).
#  Nenhuma credencial e gravada neste repositorio.
#
#  ANTES: no app de producao da Melhor Envio, cadastre EXATAMENTE:
#    https://wdcufpvlbisnqtvmbyso.supabase.co/functions/v1/melhor-envio-callback
# =====================================================================

$ErrorActionPreference = "Stop"
$PROJECT_REF = "wdcufpvlbisnqtvmbyso"
$VITRINE_URL = "https://vitrine.meellcriativa.workers.dev"

# O script pode ser chamado de qualquer pasta: o CLI do Supabase precisa da
# raiz do repositorio para encontrar supabase/config.toml e as functions.
Set-Location (Split-Path -Parent $PSScriptRoot)
if (-not (Get-Command supabase -ErrorAction SilentlyContinue)) {
  Write-Host "ERRO: CLI do Supabase nao encontrada no PATH." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Melhor Envio - ativacao em PRODUCAO" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Confira no painel da Melhor Envio (Area Dev) se o callback e:"
Write-Host "  https://$PROJECT_REF.supabase.co/functions/v1/melhor-envio-callback" -ForegroundColor Yellow
$confirm = Read-Host "Callback conferido? Digite PRODUCAO para continuar"
if ($confirm -ne "PRODUCAO") {
  Write-Host "Cancelado. Nenhuma secret foi alterada." -ForegroundColor Red
  exit 1
}

$clientId = Read-Host "ME_CLIENT_ID (app de producao)"
$secretInput = Read-Host "ME_CLIENT_SECRET (app de producao)" -AsSecureString
$clientSecret = [System.Net.NetworkCredential]::new("", $secretInput).Password
if ([string]::IsNullOrWhiteSpace($clientId) -or [string]::IsNullOrWhiteSpace($clientSecret)) {
  Write-Host "ERRO: client ID e secret sao obrigatorios." -ForegroundColor Red
  exit 1
}

# Secrets primeiro: as functions publicadas depois ja recebem o novo ambiente.
supabase secrets set `
  --project-ref $PROJECT_REF `
  ME_CLIENT_ID=$clientId `
  ME_CLIENT_SECRET=$clientSecret `
  ME_ENV=production `
  VITRINE_URL=$VITRINE_URL
if ($LASTEXITCODE -ne 0) { Write-Host "Falha ao configurar secrets." -ForegroundColor Red; exit 1 }

supabase functions deploy melhor-envio --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { Write-Host "Falha ao publicar melhor-envio." -ForegroundColor Red; exit 1 }

supabase functions deploy melhor-envio-callback --project-ref $PROJECT_REF --no-verify-jwt
if ($LASTEXITCODE -ne 0) { Write-Host "Falha ao publicar melhor-envio-callback." -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "Pronto: novas conexoes usarao contas REAIS da Melhor Envio." -ForegroundColor Green
Write-Host "Lojas ja conectadas em sandbox continuam em sandbox ate reconectarem." -ForegroundColor Green
