Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DatabaseUrlFromEnvFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$EnvFilePath
  )

  if (-not (Test-Path -LiteralPath $EnvFilePath)) {
    return $null
  }

  foreach ($line in Get-Content -LiteralPath $EnvFilePath) {
    if ($line -match '^\s*DATABASE_URL\s*=\s*(.+?)\s*$') {
      return $matches[1].Trim().Trim('"').Trim("'")
    }
  }

  return $null
}

function Get-ConfiguredDatabaseUrl {
  if ($env:DATABASE_URL) {
    return $env:DATABASE_URL
  }

  $repoRoot = Split-Path -Parent $PSScriptRoot
  $candidates = @(
    (Join-Path $repoRoot 'apps\sim\.env'),
    (Join-Path $repoRoot 'apps\realtime\.env'),
    (Join-Path $repoRoot 'packages\db\.env')
  )

  foreach ($candidate in $candidates) {
    $databaseUrl = Get-DatabaseUrlFromEnvFile -EnvFilePath $candidate
    if ($databaseUrl) {
      return $databaseUrl
    }
  }

  return $null
}

function Test-TcpReachable {
  param(
    [Parameter(Mandatory = $true)]
    [string]$HostName,
    [Parameter(Mandatory = $true)]
    [int]$Port
  )

  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $connect = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(1500, $false)) {
      $client.Close()
      return $false
    }
    $client.EndConnect($connect)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Resolve-PostgresBin {
  $pgCtlCommand = Get-Command pg_ctl.exe -ErrorAction SilentlyContinue
  $pgIsReadyCommand = Get-Command pg_isready.exe -ErrorAction SilentlyContinue

  if ($pgCtlCommand -and $pgIsReadyCommand) {
    return Split-Path -Parent $pgCtlCommand.Source
  }

  $candidates = @(
    (Join-Path $env:USERPROFILE 'miniconda3\envs\sim-pg\Library\bin'),
    (Join-Path $env:USERPROFILE 'anaconda3\envs\sim-pg\Library\bin')
  )

  foreach ($candidate in $candidates) {
    if (
      (Test-Path -LiteralPath (Join-Path $candidate 'pg_ctl.exe')) -and
      (Test-Path -LiteralPath (Join-Path $candidate 'pg_isready.exe'))
    ) {
      return $candidate
    }
  }

  return $candidates[0]
}

$databaseUrl = Get-ConfiguredDatabaseUrl
if ($databaseUrl) {
  try {
    $uri = [System.Uri]$databaseUrl
    $port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
    if (Test-TcpReachable -HostName $uri.Host -Port $port) {
      Write-Host "Using existing PostgreSQL at $($uri.Host):$port"
      exit 0
    }
  } catch {
    Write-Warning "Ignoring invalid DATABASE_URL while checking local database availability."
  }
}

$pgBin = Resolve-PostgresBin
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
