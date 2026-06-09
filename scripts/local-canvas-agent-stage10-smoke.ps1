param(
  [int]$Port = 3061,
  [string]$WorkspaceId = '6008600b-37eb-4598-9ef7-02098086468b',
  [string]$UserId = '00000000-0000-0000-0000-000000000000',
  [string]$PgHost = '127.0.0.1',
  [int]$PgPort = 5433,
  [string]$PgUser = 'postgres',
  [string]$PgPassword = 'postgres',
  [string]$PgDatabase = 'simstudio',
  [int]$RequestTimeoutSeconds = 1200
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$workflowId = [guid]::NewGuid().ToString()
$startBlockId = [guid]::NewGuid().ToString()
$out = Join-Path $repoRoot "tmp-local-canvas-agent-stage10-$stamp.out.log"
$err = Join-Path $repoRoot "tmp-local-canvas-agent-stage10-$stamp.err.log"
$resultPath = Join-Path $repoRoot "tmp-local-canvas-agent-stage10-$stamp.results.json"
$responseDir = Join-Path $repoRoot "tmp-local-canvas-agent-stage10-$stamp-responses"
New-Item -ItemType Directory -Force -Path $responseDir | Out-Null

function Write-Utf8NoBomFile {
  param([string]$Path, [string]$Text)
  [IO.File]::WriteAllText($Path, $Text, [Text.UTF8Encoding]::new($false))
}

function Read-SharedFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  try {
    $sr = [IO.StreamReader]::new($fs, [Text.Encoding]::UTF8)
    try { return $sr.ReadToEnd() } finally { $sr.Dispose() }
  } finally {
    $fs.Dispose()
  }
}

function Stop-ProcessTree {
  param([int]$PidToStop)
  if (-not $PidToStop) { return }
  $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $PidToStop }
  foreach ($child in $children) { Stop-ProcessTree -PidToStop $child.ProcessId }
  Stop-Process -Id $PidToStop -Force -ErrorAction SilentlyContinue
}

function Parse-SseFile {
  param([string]$Path)
  $sse = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
  $events = @()
  foreach ($line in ($sse -split '\r?\n')) {
    if ($line.StartsWith('data: ')) {
      try { $events += (($line.Substring(6)) | ConvertFrom-Json) } catch {}
    }
  }
  $assistant = ($events |
    Where-Object { $_.type -eq 'text' -and $_.payload.channel -eq 'assistant' } |
    ForEach-Object { [string]$_.payload.text }) -join "`n"
  $toolEvents = @($events | Where-Object { $_.type -eq 'tool' })
  $toolResults = @($toolEvents |
    Where-Object { $_.payload.phase -eq 'result' } |
    ForEach-Object {
      $payload = $_.payload
      $output = if ($payload.PSObject.Properties['output']) { $payload.output } else { $null }
      [pscustomobject]@{
        toolName = if ($payload.PSObject.Properties['toolName']) { $payload.toolName } else { $null }
        success = if ($payload.PSObject.Properties['success']) { $payload.success } else { $null }
        status = if ($payload.PSObject.Properties['status']) { $payload.status } else { $null }
        error = if ($payload.PSObject.Properties['error']) { $payload.error } else { $null }
        summary = if ($output -and $output.PSObject.Properties['summary']) { $output.summary } else { $null }
        nodeId = if ($output -and $output.PSObject.Properties['nodeId']) { $output.nodeId } else { $null }
        kind = if ($output -and $output.PSObject.Properties['kind']) { $output.kind } else { $null }
        verifiedField = if ($output -and $output.PSObject.Properties['verifiedField']) { $output.verifiedField } else { $null }
      }
    })
  [pscustomobject]@{
    eventCount = $events.Count
    assistantPreview = $assistant.Substring(0, [Math]::Min(320, $assistant.Length))
    assistantContainsSafeStop = $assistant.Contains('安全边界') -or $assistant.Contains('瀹夊叏杈圭晫')
    toolCallCount = @($toolEvents | Where-Object { $_.payload.phase -eq 'call' }).Count
    toolResultCount = $toolResults.Count
    toolNames = @($toolResults | ForEach-Object { $_.toolName })
    toolResults = $toolResults
    containsApply = $sse.Contains('canvas.apply_patch')
    containsGenerate = $sse.Contains('canvas.generate_node_output')
    containsVerify = $sse.Contains('canvas.verify_patch')
    leaksFileLocator = ($sse -match '"(?:key|storageKey|storage_key|url|path)"\s*:')
    rawLength = $sse.Length
  }
}

function Parse-JsonObjectsAfterMarker {
  param([string]$Text, [string]$Marker)
  $items = @()
  $idx = 0
  while ($true) {
    $m = $Text.IndexOf($Marker, $idx)
    if ($m -lt 0) { break }
    $brace = $Text.IndexOf('{', $m)
    if ($brace -lt 0) { break }
    $depth = 0
    $end = -1
    $inString = $false
    $escape = $false
    for ($i = $brace; $i -lt $Text.Length; $i++) {
      $ch = $Text[$i]
      if ($inString) {
        if ($escape) { $escape = $false }
        elseif ($ch -eq '\') { $escape = $true }
        elseif ($ch -eq '"') { $inString = $false }
        continue
      }
      if ($ch -eq '"') { $inString = $true; continue }
      if ($ch -eq '{') { $depth++ }
      elseif ($ch -eq '}') {
        $depth--
        if ($depth -eq 0) { $end = $i; break }
      }
    }
    if ($end -le $brace) { break }
    try { $items += (($Text.Substring($brace, $end - $brace + 1)) | ConvertFrom-Json) } catch {}
    $idx = $end + 1
  }
  return @($items)
}

function Get-SubBlockValue {
  param($Block, [string]$Id)
  if ($null -eq $Block -or $null -eq $Block.subBlocks) { return $null }
  $prop = $Block.subBlocks.PSObject.Properties[$Id]
  if ($null -eq $prop) { return $null }
  $value = $prop.Value
  if ($null -ne $value.value) { return $value.value }
  return $value
}

function Has-Value {
  param($Value)
  if ($null -eq $Value) { return $false }
  $json = $Value | ConvertTo-Json -Depth 50 -Compress
  return [string]$json -ne '' -and [string]$json -ne 'null' -and [string]$json -ne '""' -and [string]$json -ne '[]'
}

$env:PGPASSWORD = $PgPassword
$sql = @"
insert into workflow (id, user_id, name, description, last_synced, created_at, updated_at, workspace_id)
values ('$workflowId', '$UserId', 'Local canvas agent stage10 smoke $stamp', 'Codex stage10 full generation smoke', now(), now(), now(), '$WorkspaceId');
insert into workflow_blocks
  (id, workflow_id, type, name, position_x, position_y, enabled, horizontal_handles, advanced_mode, trigger_mode, locked, height, sub_blocks, outputs, data, created_at, updated_at)
values
  ('$startBlockId', '$workflowId', 'starter', 'Start', 0, 0, true, true, false, false, false, 0, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now(), now());
"@
$sql | psql -h $PgHost -p $PgPort -U $PgUser -d $PgDatabase -v ON_ERROR_STOP=1 | Out-Null

$serverCommand = @"
Set-Location -LiteralPath '$repoRoot\apps\sim'
`$env:DISABLE_AUTH='true'
`$env:BETTER_AUTH_URL='http://localhost:$Port'
`$env:NEXT_PUBLIC_APP_URL='http://localhost:$Port'
`$env:NEXT_PUBLIC_SOCKET_URL='http://localhost:3002'
`$env:NEXT_TELEMETRY_DISABLED='1'
`$env:SIM_LOW_MEMORY_DEV='true'
`$env:NEXT_PUBLIC_SIM_LOW_MEMORY_DEV='true'
`$env:NODE_OPTIONS='--max-old-space-size=8192'
bunx next dev --webpack --port $Port --disable-source-maps
"@

$proc = Start-Process -FilePath powershell.exe `
  -ArgumentList '-NoProfile', '-Command', $serverCommand `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -WindowStyle Hidden `
  -PassThru

try {
  $base = "http://localhost:$Port"
  $ready = $false
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 1
    try {
      $health = Invoke-WebRequest -Uri "$base/api/health" -UseBasicParsing -Headers @{ 'User-Agent' = 'CodexStage10Smoke/1.0' } -TimeoutSec 5
      if ($health.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
  }
  if (-not $ready) { throw "server not ready; out=$out err=$err" }

  $beforeLog = Read-SharedFile $out
  $bodyPath = Join-Path $responseDir 'full_content_chain_generate.body.json'
  $responsePath = Join-Path $responseDir 'full_content_chain_generate.sse'
  $payload = [ordered]@{
    message = 'Create and generate a short-video content chain about forest afternoon tea. Create text, image, video, and audio content nodes; add semantic references from script to image and script to audio; do not use an image or first-frame reference for the video. For the video node use text-to-video only and set videoModelFamily to wan2.6. Lay the nodes out left to right; generate every node output and write each result back to the canvas.'
    workspaceId = $WorkspaceId
    workflowId = $workflowId
    workflowCopilotMode = 'content_canvas_v1'
    confirmationMode = 'auto'
    createNewChat = $true
    userMessageId = [guid]::NewGuid().ToString()
    userTimezone = 'Asia/Shanghai'
    autoSelectionContexts = @()
  }
  Write-Utf8NoBomFile -Path $bodyPath -Text ($payload | ConvertTo-Json -Depth 100 -Compress)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $codeText = & curl.exe -sS --max-time $RequestTimeoutSeconds -w '%{http_code}' -o $responsePath `
    -H 'User-Agent: CodexStage10Smoke/1.0' `
    -H 'Accept: text/event-stream' `
    -H 'Content-Type: application/json; charset=utf-8' `
    --data-binary "@$bodyPath" `
    "$base/api/mothership/chat"
  $sw.Stop()
  Start-Sleep -Seconds 1

  $afterLog = Read-SharedFile $out
  $segment = $afterLog.Substring([Math]::Min($beforeLog.Length, $afterLog.Length))
  $models = Parse-JsonObjectsAfterMarker -Text $segment -Marker 'Local canvas agent model request completed'
  $tools = Parse-JsonObjectsAfterMarker -Text $segment -Marker 'Local canvas agent tool executed'
  $sse = Parse-SseFile $responsePath

  $statePath = Join-Path $responseDir 'workflow_state.json'
  $stateCode = & curl.exe -sS --max-time 180 -w '%{http_code}' -o $statePath `
    -H 'User-Agent: CodexStage10Smoke/1.0' `
    -H 'Accept: application/json' `
    "$base/api/workflows/$workflowId/state"
  if ([int]$stateCode -lt 200 -or [int]$stateCode -ge 300) {
    throw "workflow state HTTP $stateCode"
  }
  $state = Get-Content -LiteralPath $statePath -Encoding UTF8 | ConvertFrom-Json
  $blocks = @($state.blocks.PSObject.Properties | ForEach-Object { $_.Value })
  $contentBlocks = @($blocks | Where-Object { $_.type -eq 'content' })
  $contentKinds = @($contentBlocks | ForEach-Object {
    $preset = Get-SubBlockValue $_ 'contentFormat'
    if (-not $preset) { $preset = Get-SubBlockValue $_ 'presetId' }
    if (-not $preset) { $preset = Get-SubBlockValue $_ 'type' }
    [string]$preset
  })
  $textBlocks = @($contentBlocks | Where-Object { Has-Value (Get-SubBlockValue $_ 'contentHtml') })
  $imageBlocks = @($contentBlocks | Where-Object { Has-Value (Get-SubBlockValue $_ 'aiPrompt') -and (Has-Value (Get-SubBlockValue $_ 'file')) })
  $videoBlocks = @($contentBlocks | Where-Object { Has-Value (Get-SubBlockValue $_ 'videoPrompt') -and (Has-Value (Get-SubBlockValue $_ 'file')) })
  $audioBlocks = @($contentBlocks | Where-Object { Has-Value (Get-SubBlockValue $_ 'audioPrompt') -and (Has-Value (Get-SubBlockValue $_ 'file')) })
  $generateResults = @($sse.toolResults | Where-Object { $_.toolName -eq 'canvas.generate_node_output' -and $_.success -eq $true })
  $verifyResults = @($sse.toolResults | Where-Object { $_.toolName -eq 'canvas.verify_patch' -and $_.success -eq $true })

  $summary = [pscustomobject]@{
    stamp = $stamp
    port = $Port
    workspaceId = $WorkspaceId
    workflowId = $workflowId
    resultPath = $resultPath
    responseDir = $responseDir
    httpCode = [int]$codeText
    totalMs = [int]$sw.ElapsedMilliseconds
    modelCalls = @($models).Count
    toolLogCalls = @($tools).Count
    sse = $sse
    generatedKinds = @($generateResults | ForEach-Object { $_.kind })
    generatedCount = $generateResults.Count
    verifySuccessCount = $verifyResults.Count
    contentNodeCount = $contentBlocks.Count
    contentKinds = $contentKinds
    writeback = [pscustomobject]@{
      text = $textBlocks.Count -gt 0
      image = $imageBlocks.Count -gt 0
      video = $videoBlocks.Count -gt 0
      audio = $audioBlocks.Count -gt 0
    }
    slowestModel = @($models | Sort-Object -Property elapsedMs -Descending | Select-Object -First 1)
    slowestTool = @($tools | Sort-Object -Property elapsedMs -Descending | Select-Object -First 1)
  }
  $summary | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $resultPath -Encoding UTF8

  $failures = @()
  if ([int]$codeText -ne 200) { $failures += "chat HTTP $codeText" }
  if ($sse.assistantContainsSafeStop) { $failures += 'assistant reported safe stop' }
  if ($sse.leaksFileLocator) { $failures += 'SSE leaked file locator fields' }
  if (-not $sse.containsApply) { $failures += 'missing canvas.apply_patch' }
  if (-not $sse.containsGenerate) { $failures += 'missing canvas.generate_node_output' }
  if (-not $sse.containsVerify) { $failures += 'missing canvas.verify_patch' }
  if ($generateResults.Count -lt 4) { $failures += "expected at least 4 successful generations, got $($generateResults.Count)" }
  if ($verifyResults.Count -lt 2) { $failures += "expected verify successes, got $($verifyResults.Count)" }
  if (-not $summary.writeback.text) { $failures += 'missing text writeback' }
  if (-not $summary.writeback.image) { $failures += 'missing image file writeback' }
  if (-not $summary.writeback.video) { $failures += 'missing video file writeback' }
  if (-not $summary.writeback.audio) { $failures += 'missing audio file writeback' }
  if ($failures.Count -gt 0) {
    $summary | ConvertTo-Json -Depth 8
    throw ("Stage10 smoke failed: " + ($failures -join '; '))
  }

  $summary | ConvertTo-Json -Depth 8
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-ProcessTree -PidToStop $proc.Id }
}
