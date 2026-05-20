Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Add-PathIfExists {
  param(
    [Parameter(Mandatory = $true)]
    [string]$PathValue
  )

  if ((Test-Path $PathValue) -and -not (($env:PATH -split ';') -contains $PathValue)) {
    $env:PATH = "$PathValue;$env:PATH"
  }
}

function Resolve-BunPath {
  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if ($bunCommand) {
    return $bunCommand.Source
  }

  Add-PathIfExists "C:\Program Files\nodejs"
  Add-PathIfExists "C:\Program Files\Git\cmd"
  Add-PathIfExists "$env:USERPROFILE\miniconda3\envs\sim-pg\Library\bin"
  Add-PathIfExists "$env:USERPROFILE\miniconda3\condabin"
  Add-PathIfExists "$env:USERPROFILE\anaconda3\envs\sim-pg\Library\bin"
  Add-PathIfExists "$env:USERPROFILE\anaconda3\condabin"

  $wingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path $wingetRoot) {
    $bunDir = Get-ChildItem $wingetRoot -Directory -Filter 'Oven-sh.Bun*' |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1

    if ($bunDir) {
      $candidate = Join-Path $bunDir.FullName 'bun-windows-x64'
      Add-PathIfExists $candidate
    }
  }

  $bunCommand = Get-Command bun -ErrorAction SilentlyContinue
  if (-not $bunCommand) {
    throw 'bun was not found. Install Bun or add it to PATH first.'
  }

  return $bunCommand.Source
}

function Stop-RepoProcesses {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot
  )

  $targets = Get-CimInstance Win32_Process | Where-Object {
    ($_.Name -in @('node.exe', 'bun.exe')) -and
    $_.CommandLine -and
    $_.CommandLine -like "*$RepoRoot*"
  }

  $pids = @($targets | Select-Object -ExpandProperty ProcessId -ErrorAction SilentlyContinue | Sort-Object -Unique)
  if ($pids) {
    Stop-Process -Id $pids -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }

  $portPids = @(
    Get-NetTCPConnection -LocalPort 3000, 3002 -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue |
      Sort-Object -Unique
  )

  if ($portPids) {
    Stop-Process -Id $portPids -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

function Wait-ForUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [int]$TimeoutSeconds = 240
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return $true
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  return $false
}

$repoRoot = $PSScriptRoot
$bunExe = Resolve-BunPath

Stop-RepoProcesses -RepoRoot $repoRoot

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$appOut = Join-Path $env:TEMP "sim-canonical-app-$runId.stdout.log"
$appErr = Join-Path $env:TEMP "sim-canonical-app-$runId.stderr.log"
$rtOut = Join-Path $env:TEMP "sim-canonical-rt-$runId.stdout.log"
$rtErr = Join-Path $env:TEMP "sim-canonical-rt-$runId.stderr.log"

$appProcess = Start-Process -FilePath $bunExe `
  -ArgumentList 'run', 'dev:local' `
  -WorkingDirectory (Join-Path $repoRoot 'apps\sim') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $appOut `
  -RedirectStandardError $appErr `
  -PassThru

$realtimeProcess = Start-Process -FilePath $bunExe `
  -ArgumentList 'run', 'dev' `
  -WorkingDirectory (Join-Path $repoRoot 'apps\realtime') `
  -WindowStyle Hidden `
  -RedirectStandardOutput $rtOut `
  -RedirectStandardError $rtErr `
  -PassThru

$appReady = Wait-ForUrl -Url 'http://localhost:3000'
$realtimeReady = Wait-ForUrl -Url 'http://localhost:3002/health'

if (-not ($appReady -and $realtimeReady)) {
  throw "Startup failed. Check logs:`n$appErr`n$appOut`n$rtErr`n$rtOut"
}

Write-Host "Sim app is running at http://localhost:3000"
Write-Host "Realtime health is running at http://localhost:3002/health"
Write-Host "App PID: $($appProcess.Id)"
Write-Host "Realtime PID: $($realtimeProcess.Id)"
Write-Host "Logs:"
Write-Host "  $appOut"
Write-Host "  $appErr"
Write-Host "  $rtOut"
Write-Host "  $rtErr"
