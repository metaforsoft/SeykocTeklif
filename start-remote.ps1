param(
  [ValidateSet("api", "sync", "dispatch", "all")]
  [string]$Service = "all"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Stop-ComposeServices {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    return
  }

  Set-Location $root
  $api = docker ps --filter "name=matching-api" --format "{{.Names}}"
  if ($api) {
    docker stop $api | Out-Null
  }

  $sync = docker ps --filter "name=sync-service" --format "{{.Names}}"
  if ($sync) {
    docker stop $sync | Out-Null
  }

  $dispatch = docker ps --filter "name=order-dispatcher" --format "{{.Names}}"
  if ($dispatch) {
    docker stop $dispatch | Out-Null
  }
}

function Run-Migrations {
  Set-Location $root
  npm run migrate | Out-Host
}

function Stop-DebugProcess {
  param(
    [int]$Port
  )

  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq "node") {
      Stop-Process -Id $process.Id -Force
    }
  }
}

function Start-DebugWindow {
  param(
    [string]$Title,
    [string]$Command
  )

  Start-Process powershell -ArgumentList @(
    "-NoExit",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    "Set-Location '$root'; `$Host.UI.RawUI.WindowTitle = '$Title'; $Command"
  ) | Out-Null
}

Run-Migrations
Stop-ComposeServices
Stop-DebugProcess -Port 9229
Stop-DebugProcess -Port 9230
Stop-DebugProcess -Port 9231

switch ($Service) {
  "api" {
    Start-DebugWindow -Title "Matching API (Remote DB)" -Command "npm run debug:remote:api"
  }
  "sync" {
    Start-DebugWindow -Title "Sync Service (Remote DB)" -Command "npm run debug:remote:sync"
  }
  "dispatch" {
    Start-DebugWindow -Title "Order Dispatcher (Remote DB)" -Command "npm run debug:remote:dispatch"
  }
  "all" {
    Start-DebugWindow -Title "Matching API (Remote DB)" -Command "npm run debug:remote:api"
    Start-DebugWindow -Title "Sync Service (Remote DB)" -Command "npm run debug:remote:sync"
    Start-DebugWindow -Title "Order Dispatcher (Remote DB)" -Command "npm run debug:remote:dispatch"
  }
}
