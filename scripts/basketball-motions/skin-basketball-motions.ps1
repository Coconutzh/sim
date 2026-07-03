param(
  [Parameter(Mandatory = $true)]
  [string]$BlenderPath,
  [string]$InputDir = "",
  [string]$OutputDir = "",
  [ValidateSet("glb", "fbx", "blend")]
  [string]$Format = "glb"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if (-not $InputDir) {
  $InputDir = Join-Path $repoRoot "imgs\basketball-motions\cmu-fbx"
}
if (-not $OutputDir) {
  $OutputDir = Join-Path $repoRoot "imgs\basketball-motions\skinned-$Format"
}

if (-not (Test-Path $BlenderPath)) {
  throw "Blender executable not found: $BlenderPath"
}

$scriptPath = Join-Path $repoRoot "scripts\basketball-motions\simple_humanoid_skin.py"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

& $BlenderPath --background --python $scriptPath -- `
  --input $InputDir `
  --output-dir $OutputDir `
  --format $Format
