Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')

$repoProcesses = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -in @('node.exe', 'bun.exe')) -and
  $_.CommandLine -and
  $_.CommandLine -like "*$repoRoot*"
}

$repoPids = @(
  $repoProcesses |
    Select-Object -ExpandProperty ProcessId -ErrorAction SilentlyContinue |
    Sort-Object -Unique
)

if ($repoPids) {
  Stop-Process -Id $repoPids -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

$portPids = @(
  Get-NetTCPConnection -LocalPort 3000, 3002 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue |
    Sort-Object -Unique
)

if ($portPids) {
  Stop-Process -Id $portPids -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}
