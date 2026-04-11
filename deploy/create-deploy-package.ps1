param(
  [string]$OutputRoot = "out",
  [string]$PackageName = "stock-matching-platform-deploy"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $projectRoot $OutputRoot
$packageDir = Join-Path $outputDir $PackageName
$zipPath = Join-Path $outputDir "$PackageName.zip"

function Copy-IntoPackage {
  param(
    [string]$RelativePath
  )

  $source = Join-Path $projectRoot $RelativePath
  if (!(Test-Path $source)) {
    throw "Required path not found: $RelativePath"
  }

  $target = Join-Path $packageDir $RelativePath
  $targetParent = Split-Path -Parent $target
  if ($targetParent -and !(Test-Path $targetParent)) {
    New-Item -ItemType Directory -Path $targetParent -Force | Out-Null
  }

  if ((Get-Item $source) -is [System.IO.DirectoryInfo]) {
    Copy-Item $source $target -Recurse -Force
  } else {
    Copy-Item $source $target -Force
  }
}

Write-Host "Building workspace dist files..."
Push-Location $projectRoot
try {
  npm run build
} finally {
  Pop-Location
}

if (Test-Path $packageDir) {
  Remove-Item $packageDir -Recurse -Force
}
if (!(Test-Path $outputDir)) {
  New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$paths = @(
  "package.json",
  "package-lock.json",
  "Dockerfile.runtime",
  "docker-compose.package.yml",
  "apps/matching-api/package.json",
  "apps/matching-api/dist",
  "apps/sync-service/package.json",
  "apps/sync-service/dist",
  "apps/order-dispatcher/package.json",
  "apps/order-dispatcher/dist",
  "packages/common/package.json",
  "packages/common/dist",
  "packages/db/package.json",
  "packages/db/dist",
  "packages/db/migrations",
  "services/ocr-service/Dockerfile",
  "services/ocr-service/app.py",
  "services/ocr-service/requirements.txt",
  "deploy/nginx/default.conf",
  "deploy/.env.server.example",
  "deploy/.env.local.server.example",
  "deploy/publish-package.ps1",
  "deploy/DEPLOY_PACKAGE.md"
)

foreach ($path in $paths) {
  Copy-IntoPackage -RelativePath $path
}

if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

Compress-Archive -Path (Join-Path $packageDir '*') -DestinationPath $zipPath -Force

Write-Host ""
Write-Host "Deploy package created:"
Write-Host $packageDir
Write-Host $zipPath
