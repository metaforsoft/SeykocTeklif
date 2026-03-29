param(
  [ValidateSet("api", "sync", "dispatch", "all")]
  [string]$Service = "api"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Ensure-MatchingDb {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    return
  }

  Set-Location $root
  $running = docker ps --filter "name=^matching_db$" --format "{{.Names}}"
  if ($running -notcontains "matching_db") {
    docker compose up -d matching_db | Out-Null
  }
}

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

Ensure-MatchingDb
Run-Migrations
Stop-ComposeServices
Stop-DebugProcess -Port 9229
Stop-DebugProcess -Port 9230
Stop-DebugProcess -Port 9231

switch ($Service) {
  "api" {
    Start-DebugWindow -Title "Matching API Debug" -Command "npm run debug:api"
  }
  "sync" {
    Start-DebugWindow -Title "Sync Service Debug" -Command "npm run debug:sync"
  }
  "dispatch" {
    Start-DebugWindow -Title "Order Dispatcher Debug" -Command "npm run debug:dispatch"
  }
  "all" {
    Start-DebugWindow -Title "Matching API Debug" -Command "npm run debug:api"
    Start-DebugWindow -Title "Sync Service Debug" -Command "npm run debug:sync"
    Start-DebugWindow -Title "Order Dispatcher Debug" -Command "npm run debug:dispatch"
  }
}
