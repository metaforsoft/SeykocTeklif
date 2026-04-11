param(
  [string]$ProjectRoot = (Get-Location).Path
)

$ErrorActionPreference = "Stop"

if (!(Test-Path (Join-Path $ProjectRoot "docker-compose.package.yml"))) {
  throw "docker-compose.package.yml not found in $ProjectRoot"
}

Set-Location $ProjectRoot

Write-Host "Starting deploy package services..."
docker compose -f docker-compose.package.yml up -d --build

Write-Host ""
Write-Host "Service status:"
docker compose -f docker-compose.package.yml ps

Write-Host ""
Write-Host "Health check:"
try {
  Invoke-RestMethod -Uri "http://localhost/health" -Method Get | ConvertTo-Json -Depth 4
} catch {
  Write-Warning "Health check failed. Inspect logs with:"
  Write-Host "docker compose -f docker-compose.package.yml logs -f matching-api"
}
