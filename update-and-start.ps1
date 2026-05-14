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

function Resolve-RequiredCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$CommandName
  )

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  Add-PathIfExists "C:\Program Files\Git\cmd"
  Add-PathIfExists "C:\Program Files\nodejs"
  Add-PathIfExists "$env:USERPROFILE\anaconda3\envs\sim-pg\Library\bin"
  Add-PathIfExists "$env:USERPROFILE\anaconda3\condabin"

  $wingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (Test-Path $wingetRoot) {
    $bunDir = Get-ChildItem $wingetRoot -Directory -Filter 'Oven-sh.Bun*' |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1

    if ($bunDir) {
      Add-PathIfExists (Join-Path $bunDir.FullName 'bun-windows-x64')
    }
  }

  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$CommandName was not found. Install it or add it to PATH first."
  }

  return $command.Source
}

$repoRoot = $PSScriptRoot
$null = Resolve-RequiredCommand -CommandName 'git'
$null = Resolve-RequiredCommand -CommandName 'bun'

$gitStatus = git -C $repoRoot status --porcelain --untracked-files=no
if ($gitStatus) {
  Write-Host 'Local tracked changes detected. Using git pull --rebase --autostash.'
  git -C $repoRoot pull --rebase --autostash
} else {
  git -C $repoRoot pull --ff-only
}

bun --cwd $repoRoot install
bun --cwd (Join-Path $repoRoot 'packages\db') run db:migrate

& (Join-Path $repoRoot 'start-dev.ps1')
