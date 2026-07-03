param(
  [int]$Limit = 100,
  [int]$StartPage = 1,
  [int]$MaxPages = 120,
  [int]$DelayMs = 1200,
  [int]$SelectionSettleMs = 6500,
  [int]$MismatchRetryLimit = 2,
  [switch]$UseDefaultChromeProfile,
  [switch]$Headless,
  [switch]$Force,
  [switch]$AllPages,
  [string]$StartUrl = "https://www.mixamo.com/#/?page=1",
  [string]$ChromePath = "",
  [string]$DownloadDir = "",
  [string]$Manifest = "",
  [string]$BrowserProfileDir = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

bun x playwright --version | Out-Host

$playwrightTemp = Get-ChildItem -Path $env:LOCALAPPDATA\Temp -Directory -Filter "bunx-*-playwright@latest" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $playwrightTemp) {
  throw "Could not locate the temporary Playwright package created by bun x."
}

$env:NODE_PATH = Join-Path $playwrightTemp.FullName "node_modules"

$nodeArgs = @(
  "scripts\mixamo-download\download-mixamo.cjs",
  "--limit", "$Limit",
  "--start-page", "$StartPage",
  "--max-pages", "$MaxPages",
  "--delay-ms", "$DelayMs",
  "--selection-settle-ms", "$SelectionSettleMs",
  "--mismatch-retry-limit", "$MismatchRetryLimit",
  "--start-url", "$StartUrl"
)

if ($ChromePath) {
  $nodeArgs += @("--chrome-path", $ChromePath)
}

if ($UseDefaultChromeProfile) {
  $nodeArgs += "--use-default-chrome-profile"
}

if ($Headless) {
  $nodeArgs += "--headless"
}

if ($Force) {
  $nodeArgs += "--force"
}

if ($AllPages) {
  $nodeArgs += "--all-pages"
}

if ($DownloadDir) {
  $nodeArgs += @("--download-dir", $DownloadDir)
}

if ($Manifest) {
  $nodeArgs += @("--manifest", $Manifest)
}

if ($BrowserProfileDir) {
  $nodeArgs += @("--browser-profile-dir", $BrowserProfileDir)
}

node @nodeArgs
