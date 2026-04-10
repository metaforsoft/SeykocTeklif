param(
  [string]$ProjectRoot = "C:\stock-matching-platform"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $ProjectRoot)) {
  throw "Project root not found: $ProjectRoot"
}

Set-Location $ProjectRoot

if (!(Test-Path ".env")) {
  throw ".env not found in $ProjectRoot"
}

Write-Host "Building and starting production services..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

Write-Host ""
Write-Host "Service status:"
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

Write-Host ""
Write-Host "Health check:"
try {
  Invoke-RestMethod -Uri "http://localhost/health" -Method Get | ConvertTo-Json -Depth 4
} catch {
  Write-Warning "Health check failed. Inspect logs with:"
  Write-Host "docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f matching-api"
}

