Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pgBin = Join-Path $env:USERPROFILE 'miniconda3\envs\sim-pg\Library\bin'
$dataDir = Join-Path $env:USERPROFILE '.simstudio\postgres-data'
$logDir = Join-Path $env:USERPROFILE '.simstudio\logs'

$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$pgIsReady = Join-Path $pgBin 'pg_isready.exe'

if (-not (Test-Path $pgCtl)) {
  throw "pg_ctl.exe was not found at $pgCtl"
}

if (-not (Test-Path (Join-Path $dataDir 'PG_VERSION'))) {
  throw "PostgreSQL data directory was not found at $dataDir"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

& $pgIsReady -h 127.0.0.1 -p 5433 *> $null
if ($LASTEXITCODE -ne 0) {
  & $pgCtl -D $dataDir -l (Join-Path $logDir 'postgres.log') start
}

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
  & $pgIsReady -h 127.0.0.1 -p 5433 *> $null
  if ($LASTEXITCODE -eq 0) {
    exit 0
  }
  Start-Sleep -Seconds 1
}

throw 'PostgreSQL did not become ready on 127.0.0.1:5433 within 30 seconds'
