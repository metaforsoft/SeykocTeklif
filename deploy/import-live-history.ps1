param(
  [string]$ProjectRoot = "C:\stock-matching-platform",
  [string]$SourceHost,
  [string]$SourcePort = "5432",
  [string]$SourceDb,
  [string]$SourceUser,
  [string]$SourcePassword,
  [switch]$RefreshStocksFromErp = $true
)

$ErrorActionPreference = "Stop"

function Import-EnvFile {
  param(
    [string]$Path
  )

  if (!(Test-Path $Path)) {
    return
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (!$trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf("=")
    if ($separatorIndex -lt 1) {
      continue
    }

    $name = $trimmed.Substring(0, $separatorIndex).Trim()
    $value = $trimmed.Substring($separatorIndex + 1).Trim()
    [System.Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

function Test-Value {
  param(
    [string]$Name,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Missing required value: $Name"
  }
}

if (!(Test-Path $ProjectRoot)) {
  throw "Project root not found: $ProjectRoot"
}

Set-Location $ProjectRoot

Import-EnvFile ".\.env"
Import-EnvFile ".\.env.local"

Test-Value -Name "SourceHost" -Value $SourceHost
Test-Value -Name "SourcePort" -Value $SourcePort
Test-Value -Name "SourceDb" -Value $SourceDb
Test-Value -Name "SourceUser" -Value $SourceUser
Test-Value -Name "SourcePassword" -Value $SourcePassword
Test-Value -Name "MATCH_PG_DB" -Value $env:MATCH_PG_DB
Test-Value -Name "MATCH_PG_USER" -Value $env:MATCH_PG_USER

$composeArgs = @("-f", "docker-compose.yml", "-f", "docker-compose.prod.yml")

Write-Host "Importing historical and learning tables into target DB..."
Get-Content ".\deploy\import-live-history.sql" -Raw | docker compose @composeArgs exec -T matching_db `
  psql `
    -v ON_ERROR_STOP=1 `
    -v SRC_HOST="$SourceHost" `
    -v SRC_PORT="$SourcePort" `
    -v SRC_DB="$SourceDb" `
    -v SRC_USER="$SourceUser" `
    -v SRC_PASSWORD="$SourcePassword" `
    -U $env:MATCH_PG_USER `
    -d $env:MATCH_PG_DB

if ($RefreshStocksFromErp) {
  Write-Host ""
  Write-Host "Restarting sync-service to refill stock tables from ERP source in .env..."
  docker compose @composeArgs restart sync-service
  Write-Host "Stock refresh triggered. Follow with:"
  Write-Host "docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f sync-service"
}

Write-Host ""
Write-Host "Import completed."
