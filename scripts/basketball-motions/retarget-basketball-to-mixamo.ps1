param(
  [Parameter(Mandatory = $true)]
  [string]$BlenderPath,
  [string]$TemplateFbx = "",
  [string]$InputDir = "",
  [string]$OutputDir = "",
  [ValidateSet("glb", "fbx", "blend")]
  [string]$Format = "glb",
  [int]$SampleStep = 1
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if (-not $TemplateFbx) {
  $templateRoot = Join-Path $repoRoot "imgs\mixamo\fbx-fast-page2"
  $TemplateFbx = Get-ChildItem -LiteralPath $templateRoot -File -Filter "*.fbx" |
    Where-Object { $_.Length -gt 1000000 } |
    Sort-Object Name |
    Select-Object -First 1 -ExpandProperty FullName
}

if (-not $InputDir) {
  $InputDir = Join-Path $repoRoot "imgs\basketball-motions\cmu-fbx"
}

if (-not $OutputDir) {
  $OutputDir = Join-Path $repoRoot "imgs\basketball-motions\mixamo-retargeted-$Format"
}

if (-not (Test-Path $BlenderPath)) {
  throw "Blender executable not found: $BlenderPath"
}
if (-not (Test-Path $TemplateFbx)) {
  throw "Template FBX not found: $TemplateFbx"
}

$scriptPath = Join-Path $repoRoot "scripts\basketball-motions\retarget_cmu_to_mixamo_skin.py"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

Write-Host "Template: $TemplateFbx"
Write-Host "Input: $InputDir"
Write-Host "Output: $OutputDir"

& $BlenderPath --background --python $scriptPath -- `
  --template $TemplateFbx `
  --input $InputDir `
  --output-dir $OutputDir `
  --format $Format `
  --sample-step $SampleStep
