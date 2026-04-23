param(
  [string]$ProjectRoot = (Get-Location).Path,
  [bool]$ResetDatabase = $true,
  [bool]$EnforceAdminOnly = $true,
  [int]$HealthTimeoutSeconds = 180
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

function Test-RequiredEnvValue {
  param(
    [string]$Name
  )

  $value = [System.Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($value) -or $value -match '^<<.+>>$') {
    throw "Required env var is missing or still placeholder: $Name"
  }
}

function Wait-Health {
  param(
    [string]$Url,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 10
      if ($response.ok -eq $true) {
        return
      }
    } catch {
      Start-Sleep -Seconds 5
      continue
    }

    Start-Sleep -Seconds 5
  }

  throw "Health check timed out: $Url"
}

function Invoke-ComposeSqlFile {
  param(
    [string[]]$ComposeArgs,
    [string]$SqlFilePath
  )

  Get-Content $SqlFilePath -Raw | docker compose @ComposeArgs exec -T matching_db `
    psql -v ON_ERROR_STOP=1 -U $env:MATCH_PG_USER -d $env:MATCH_PG_DB
}

if (!(Test-Path (Join-Path $ProjectRoot "docker-compose.package.yml"))) {
  throw "docker-compose.package.yml not found in $ProjectRoot"
}

Set-Location $ProjectRoot

if (!(Test-Path ".env")) {
  Copy-Item ".\deploy\.env.server.example" ".\.env"
  if (!(Test-Path ".env.local") -and (Test-Path ".\deploy\.env.local.server.example")) {
    Copy-Item ".\deploy\.env.local.server.example" ".\.env.local"
  }
  throw ".env created from deploy\\.env.server.example. Fill required values, then rerun the script."
}

Import-EnvFile ".\.env"
Import-EnvFile ".\.env.local"

$requiredEnvVars = @(
  "ERP_PG_HOST",
  "ERP_PG_PORT",
  "ERP_PG_DB",
  "ERP_PG_USER",
  "ERP_PG_PASSWORD",
  "ERP_STOCK_VIEW",
  "MATCH_PG_HOST",
  "MATCH_PG_PORT",
  "MATCH_PG_DB",
  "MATCH_PG_USER",
  "MATCH_PG_PASSWORD"
)

foreach ($name in $requiredEnvVars) {
  Test-RequiredEnvValue -Name $name
}

$composeArgs = @("-f", "docker-compose.package.yml")

if ($ResetDatabase) {
  Write-Host "Removing existing containers and database volume..."
  docker compose @composeArgs down -v --remove-orphans
} else {
  Write-Host "Stopping old containers without deleting the database volume..."
  docker compose @composeArgs down --remove-orphans
}

Write-Host "Starting deploy package services..."
docker compose @composeArgs up -d --build

Write-Host ""
Write-Host "Waiting for application health..."
Wait-Health -Url "http://localhost/health" -TimeoutSeconds $HealthTimeoutSeconds

if ($EnforceAdminOnly) {
  Write-Host ""
  Write-Host "Cleaning app users and keeping only admin..."
  Invoke-ComposeSqlFile -ComposeArgs $composeArgs -SqlFilePath ".\deploy\reset-app-users.sql"
}

Write-Host ""
Write-Host "Service status:"
docker compose @composeArgs ps

Write-Host ""
Write-Host "Health check:"
Invoke-RestMethod -Uri "http://localhost/health" -Method Get | ConvertTo-Json -Depth 4

if ($EnforceAdminOnly) {
  Write-Host ""
  Write-Host "Active app users:"
  docker compose @composeArgs exec -T matching_db `
    psql -U $env:MATCH_PG_USER -d $env:MATCH_PG_DB -c "SELECT username, role, is_active FROM app_users ORDER BY id;"
  Write-Host ""
  Write-Host "Login: admin / admin"
}
