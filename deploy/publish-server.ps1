param(
  [string]$ProjectRoot = "C:\stock-matching-platform",
  [bool]$ResetDatabase = $false,
  [bool]$EnforceAdminOnly = $false,
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

if (!(Test-Path $ProjectRoot)) {
  throw "Project root not found: $ProjectRoot"
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

$composeArgs = @("-f", "docker-compose.yml", "-f", "docker-compose.prod.yml")

if ($ResetDatabase) {
  Write-Host "Removing existing containers and database volume..."
  docker compose @composeArgs down -v --remove-orphans
} else {
  Write-Host "Stopping old containers without deleting the database..."
  docker compose @composeArgs down --remove-orphans
}

Write-Host "Building and starting production services..."
docker compose @composeArgs up -d --build

Write-Host ""
Write-Host "Waiting for application health..."
Wait-Health -Url "http://localhost/health" -TimeoutSeconds $HealthTimeoutSeconds

Write-Host ""
Write-Host "Service status:"
docker compose @composeArgs ps

Write-Host ""
Write-Host "Health check:"
Invoke-RestMethod -Uri "http://localhost/health" -Method Get | ConvertTo-Json -Depth 4
