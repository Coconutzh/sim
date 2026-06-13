#!/usr/bin/env bun

type CheckStatus = 'pass' | 'fail' | 'skip'

export interface CheckResult {
  name: string
  status: CheckStatus
  detail?: string
  data?: unknown
}

interface JsonResponse {
  ok: boolean
  status: number
  payload: unknown
}

interface Options {
  json: boolean
  chat: boolean
  canvasRead: boolean
  skillList: boolean
  skillProposalCreate: boolean
  memory: boolean
  skipSimHealth: boolean
}

const DEFAULT_REQUIRED_TOOLSETS = ['sim']
const DEFAULT_FORBIDDEN_TOOLSETS = [
  'browser',
  'code_execution',
  'computer_use',
  'cronjob',
  'delegation',
  'file',
  'terminal',
]
const REQUIRED_TOOLS_BY_TOOLSET: Record<string, string[]> = {
  sim: ['sim_canvas_agent_run', 'sim_skill_proposal_run', 'sim_external_evidence_prepare'],
}

function printUsage(): void {
  process.stdout.write(`SIM Hermes smoke test

Usage:
  bun run scripts/hermes-sim-smoke.ts [--chat] [--canvas-read] [--skill-list] [--skill-proposal-create] [--memory] [--json]

Required env:
  HERMES_API_URL              Hermes API Server base URL, e.g. http://127.0.0.1:8642
  HERMES_API_KEY              Bearer token matching Hermes API_SERVER_KEY

Optional env:
  SIM_BASE_URL                SIM base URL, default http://127.0.0.1:3000
  INTERNAL_API_SECRET         Enables SIM /api/internal/hermes/health check
  HERMES_REQUIRED_TOOLSETS    Default sim
  HERMES_FORBIDDEN_TOOLSETS   Default browser,code_execution,computer_use,cronjob,delegation,file,terminal
  HERMES_SMOKE_MODEL          Optional Hermes model override
  HERMES_SMOKE_USER_ID        Required for --canvas-read / --skill-list / --skill-proposal-create
  HERMES_SMOKE_ORGANIZATION_ID Required for --skill-list / --skill-proposal-create, recommended for all SIM metadata
  HERMES_SMOKE_WORKGROUP_ID   Required for --skill-proposal-create
  HERMES_SMOKE_WORKSPACE_ID   Required for --canvas-read
  HERMES_SMOKE_WORKFLOW_ID    Required for --canvas-read
  HERMES_SMOKE_OTHER_USER_ID  Required for --memory isolation check
  HERMES_SMOKE_WRITE_CONFIRM  Must be CREATE_SKILL_PROPOSAL for --skill-proposal-create
  HERMES_SMOKE_CHAT_ID        Optional stable chat id, default hermes-smoke
  HERMES_SMOKE_AGENT_CODE     Optional SIM agent code for skill proposal smoke
  HERMES_SMOKE_SELECTED_NODE_IDS Comma-separated selected node ids
  HERMES_SMOKE_TIMEOUT_MS     Default 20000

Notes:
  Default checks are read-only: Hermes health, capabilities, toolset policy,
  and SIM aggregated health when INTERNAL_API_SECRET is present.
  --chat sends a no-tool OpenAI-compatible chat completion.
  --canvas-read asks Hermes to call sim_canvas_agent_run in read_only mode.
  --skill-list asks Hermes to list published SIM skills only.
  --skill-proposal-create creates a pending-review SIM skill proposal and compares it.
  --memory exercises SIM-backed Hermes user memory write/prefetch/isolation through SIM internal APIs.
`)
}

function parseOptions(argv: string[]): Options {
  const flags = new Set(argv)
  if (flags.has('--help') || flags.has('-h')) {
    printUsage()
    process.exit(0)
  }
  return {
    json: flags.has('--json'),
    chat: flags.has('--chat'),
    canvasRead: flags.has('--canvas-read'),
    skillList: flags.has('--skill-list'),
    skillProposalCreate: flags.has('--skill-proposal-create'),
    memory: flags.has('--memory'),
    skipSimHealth: flags.has('--skip-sim-health'),
  }
}

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function envList(name: string, fallback: string[]): string[] {
  const raw = envString(name)
  if (!raw) return fallback
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readArray(record: Record<string, unknown> | undefined, key: string): unknown[] {
  const value = record?.[key]
  return Array.isArray(value) ? value : []
}

function getTimeoutMs(): number {
  const raw = Number(envString('HERMES_SMOKE_TIMEOUT_MS'))
  return Number.isFinite(raw) && raw >= 1000 ? raw : 20000
}

async function fetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = getTimeoutMs()
): Promise<JsonResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const payload = (await response.json().catch(() => ({}))) as unknown
    return { ok: response.ok, status: response.status, payload }
  } finally {
    clearTimeout(timeout)
  }
}

function requiredEnv(name: string, results: CheckResult[]): string | undefined {
  const value = envString(name)
  if (!value) {
    results.push({
      name: `env:${name}`,
      status: 'fail',
      detail: `${name} is required`,
    })
  }
  return value
}

function buildAuthHeaders(apiKey: string): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
}

function summarizePayload(payload: unknown): unknown {
  const record = asRecord(payload)
  if (!record) return payload
  return {
    status: record.status,
    version: record.version,
    commit: record.commit ?? asRecord(record.build)?.commit,
    error: record.error,
  }
}

async function checkHermesHealth(
  baseUrl: string,
  apiKey: string,
  results: CheckResult[]
): Promise<void> {
  const response = await fetchJson(`${baseUrl}/health`, {
    method: 'GET',
    headers: buildAuthHeaders(apiKey),
  })
  const status = readString(asRecord(response.payload), 'status')
  results.push({
    name: 'hermes.health',
    status: response.ok && status === 'ok' ? 'pass' : 'fail',
    detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`,
    data: summarizePayload(response.payload),
  })
}

async function checkCapabilities(
  baseUrl: string,
  apiKey: string,
  results: CheckResult[]
): Promise<void> {
  const response = await fetchJson(`${baseUrl}/v1/capabilities`, {
    method: 'GET',
    headers: buildAuthHeaders(apiKey),
  })
  const features = asRecord(asRecord(response.payload)?.features)
  const issues: string[] = []
  if (features?.chat_completions !== true) issues.push('missing chat_completions')
  if (features?.session_key_header !== 'X-Hermes-Session-Key') {
    issues.push('missing X-Hermes-Session-Key support')
  }
  results.push({
    name: 'hermes.capabilities',
    status: response.ok && issues.length === 0 ? 'pass' : 'fail',
    detail: issues.length > 0 ? issues.join('; ') : `HTTP ${response.status}`,
    data: response.payload,
  })
}

async function checkToolsets(
  baseUrl: string,
  apiKey: string,
  results: CheckResult[]
): Promise<void> {
  const required = envList('HERMES_REQUIRED_TOOLSETS', DEFAULT_REQUIRED_TOOLSETS)
  const forbidden = envList('HERMES_FORBIDDEN_TOOLSETS', DEFAULT_FORBIDDEN_TOOLSETS)
  const response = await fetchJson(`${baseUrl}/v1/toolsets`, {
    method: 'GET',
    headers: buildAuthHeaders(apiKey),
  })
  const data = readArray(asRecord(response.payload), 'data')
  const entries = data.map((item) => asRecord(item)).filter(Boolean) as Record<string, unknown>[]
  const enabled = entries
    .filter((entry) => entry.enabled === true)
    .map((entry) => readString(entry, 'name'))
    .filter((name): name is string => Boolean(name))
    .sort()
  const enabledSet = new Set(enabled)
  const byName = new Map(
    entries
      .map((entry) => [readString(entry, 'name'), entry] as const)
      .filter((entry): entry is readonly [string, Record<string, unknown>] => Boolean(entry[0]))
  )

  const missingToolsets = required.filter((name) => !enabledSet.has(name))
  const enabledForbidden = enabled.filter((name) => forbidden.includes(name))
  const missingTools = Object.fromEntries(
    Object.entries(REQUIRED_TOOLS_BY_TOOLSET)
      .filter(([toolset]) => required.includes(toolset))
      .map(([toolset, tools]) => {
        const entry = byName.get(toolset)
        const actualTools = readArray(entry, 'tools').filter(
          (tool): tool is string => typeof tool === 'string'
        )
        const actualToolSet = new Set(actualTools)
        return [toolset, tools.filter((tool) => !actualToolSet.has(tool))] as const
      })
      .filter(([, tools]) => tools.length > 0)
  )
  const issues = [
    missingToolsets.length ? `missing toolsets: ${missingToolsets.join(', ')}` : '',
    enabledForbidden.length ? `forbidden enabled: ${enabledForbidden.join(', ')}` : '',
    ...Object.entries(missingTools).map(
      ([toolset, tools]) => `missing ${toolset} tools: ${tools.join(', ')}`
    ),
  ].filter(Boolean)

  results.push({
    name: 'hermes.toolsets',
    status: response.ok && issues.length === 0 ? 'pass' : 'fail',
    detail: issues.length > 0 ? issues.join('; ') : `enabled: ${enabled.join(', ')}`,
    data: { required, forbidden, enabled, missingToolsets, enabledForbidden, missingTools },
  })
}

async function checkSimHealth(simBaseUrl: string, results: CheckResult[]): Promise<void> {
  const apiKey = envString('INTERNAL_API_SECRET')
  if (!apiKey) {
    results.push({
      name: 'sim.hermes-health',
      status: 'skip',
      detail: 'INTERNAL_API_SECRET is not set',
    })
    return
  }
  const response = await fetchJson(`${simBaseUrl}/api/internal/hermes/health`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey,
    },
  })
  const payload = asRecord(response.payload)
  results.push({
    name: 'sim.hermes-health',
    status: response.ok && payload?.ok === true ? 'pass' : 'fail',
    detail: response.ok ? `HTTP ${response.status}` : `HTTP ${response.status}`,
    data: summarizePayload(response.payload),
  })
}

async function postSimMemory(
  simBaseUrl: string,
  body: Record<string, unknown>
): Promise<JsonResponse> {
  const serviceToken = envString('HERMES_SERVICE_TOKEN')
  if (!serviceToken) {
    return {
      ok: false,
      status: 0,
      payload: {
        errorCode: 'MISSING_ENV',
        error: 'HERMES_SERVICE_TOKEN is required for --memory',
      },
    }
  }

  return fetchJson(`${simBaseUrl}/api/internal/hermes/memory/run`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-sim-service-token': serviceToken,
    },
    body: JSON.stringify(body),
  })
}

async function postSimSkillProposal(
  simBaseUrl: string,
  body: Record<string, unknown>
): Promise<JsonResponse> {
  const serviceToken = envString('HERMES_SERVICE_TOKEN')
  if (!serviceToken) {
    return {
      ok: false,
      status: 0,
      payload: {
        errorCode: 'MISSING_ENV',
        error: 'HERMES_SERVICE_TOKEN is required for --skill-proposal-create',
      },
    }
  }

  return fetchJson(`${simBaseUrl}/api/internal/hermes/skill-proposals/run`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-sim-service-token': serviceToken,
    },
    body: JSON.stringify(body),
  })
}

function buildSimMetadata(): Record<string, unknown> {
  const selectedNodeIds = envList('HERMES_SMOKE_SELECTED_NODE_IDS', [])
  return {
    sim: {
      userId: envString('HERMES_SMOKE_USER_ID'),
      organizationId: envString('HERMES_SMOKE_ORGANIZATION_ID'),
      workspaceId: envString('HERMES_SMOKE_WORKSPACE_ID'),
      workflowId: envString('HERMES_SMOKE_WORKFLOW_ID'),
      chatId: envString('HERMES_SMOKE_CHAT_ID') ?? 'hermes-smoke',
      ...(selectedNodeIds.length > 0 ? { selectedNodeIds } : {}),
      traceId: `hermes-smoke-${Date.now()}`,
    },
  }
}

async function runChatSmoke(
  baseUrl: string,
  apiKey: string,
  results: CheckResult[]
): Promise<void> {
  const response = await fetchJson(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(apiKey),
      'content-type': 'application/json',
      'x-hermes-session-key': `sim:smoke:user:${envString('HERMES_SMOKE_USER_ID') ?? 'anonymous'}`,
      'x-hermes-session-id': envString('HERMES_SMOKE_CHAT_ID') ?? 'hermes-smoke',
    },
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      messages: [
        {
          role: 'system',
          content: 'You are responding to a SIM-Hermes smoke test. Do not call tools.',
        },
        {
          role: 'user',
          content: 'Reply exactly: SIM_HERMES_SMOKE_OK',
        },
      ],
      metadata: buildSimMetadata(),
    }),
  })
  const choices = readArray(asRecord(response.payload), 'choices')
  const message = asRecord(asRecord(choices[0])?.message)
  const content = readString(message, 'content') ?? ''
  results.push({
    name: 'hermes.chat',
    status: response.ok && content.includes('SIM_HERMES_SMOKE_OK') ? 'pass' : 'fail',
    detail: response.ok ? content.slice(0, 160) : `HTTP ${response.status}`,
  })
}

function requireSimContext(results: CheckResult[], keys: string[]): boolean {
  let ok = true
  for (const key of keys) {
    if (!envString(key)) {
      ok = false
      results.push({
        name: `env:${key}`,
        status: 'fail',
        detail: `${key} is required for this smoke mode`,
      })
    }
  }
  return ok
}

function requireWriteConfirm(results: CheckResult[], expected: string): boolean {
  if (envString('HERMES_SMOKE_WRITE_CONFIRM') === expected) return true
  results.push({
    name: 'env:HERMES_SMOKE_WRITE_CONFIRM',
    status: 'fail',
    detail: `Set HERMES_SMOKE_WRITE_CONFIRM=${expected} to run this write smoke`,
  })
  return false
}

async function runCanvasReadSmoke(
  baseUrl: string,
  apiKey: string,
  results: CheckResult[]
): Promise<void> {
  if (
    !requireSimContext(results, [
      'HERMES_SMOKE_USER_ID',
      'HERMES_SMOKE_WORKSPACE_ID',
      'HERMES_SMOKE_WORKFLOW_ID',
    ])
  ) {
    return
  }

  const response = await fetchJson(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(apiKey),
      'content-type': 'application/json',
      'x-hermes-session-key': `sim:smoke:user:${envString('HERMES_SMOKE_USER_ID')}`,
      'x-hermes-session-id': envString('HERMES_SMOKE_CHAT_ID') ?? 'hermes-smoke',
    },
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      messages: [
        {
          role: 'system',
          content:
            'You are a SIM smoke-test agent. Use sim_canvas_agent_run with mode=read_only only.',
        },
        {
          role: 'user',
          content:
            'Inspect the SIM canvas in read_only mode and return a concise summary. Do not propose or apply changes.',
        },
      ],
      metadata: buildSimMetadata(),
    }),
  })
  const choices = readArray(asRecord(response.payload), 'choices')
  const content = readString(asRecord(asRecord(choices[0])?.message), 'content') ?? ''
  results.push({
    name: 'hermes.sim-canvas-read',
    status: response.ok && content.length > 0 ? 'pass' : 'fail',
    detail: response.ok ? content.slice(0, 240) : `HTTP ${response.status}`,
  })
}

async function runSkillListSmoke(
  baseUrl: string,
  apiKey: string,
  results: CheckResult[]
): Promise<void> {
  if (!requireSimContext(results, ['HERMES_SMOKE_USER_ID', 'HERMES_SMOKE_ORGANIZATION_ID'])) {
    return
  }

  const response = await fetchJson(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(apiKey),
      'content-type': 'application/json',
      'x-hermes-session-key': `sim:smoke:user:${envString('HERMES_SMOKE_USER_ID')}`,
      'x-hermes-session-id': envString('HERMES_SMOKE_CHAT_ID') ?? 'hermes-smoke',
    },
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      messages: [
        {
          role: 'system',
          content:
            'You are a SIM smoke-test agent. Use sim_skill_proposal_run only for list_published. Do not create, patch, submit, publish, enable, disable, delete, or roll back skills.',
        },
        {
          role: 'user',
          content:
            'List published SIM skills for this organization and summarize the count. This is read-only.',
        },
      ],
      metadata: buildSimMetadata(),
    }),
  })
  const choices = readArray(asRecord(response.payload), 'choices')
  const content = readString(asRecord(asRecord(choices[0])?.message), 'content') ?? ''
  results.push({
    name: 'hermes.sim-skill-list',
    status: response.ok && content.length > 0 ? 'pass' : 'fail',
    detail: response.ok ? content.slice(0, 240) : `HTTP ${response.status}`,
  })
}

function buildSkillProposalBaseBody(traceId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    userId: envString('HERMES_SMOKE_USER_ID'),
    organizationId: envString('HERMES_SMOKE_ORGANIZATION_ID'),
    workgroupId: envString('HERMES_SMOKE_WORKGROUP_ID'),
    traceId,
    hermesRunId: `hermes-smoke-skill-proposal-${Date.now()}`,
  }
  const workspaceId = envString('HERMES_SMOKE_WORKSPACE_ID')
  if (workspaceId) body.workspaceId = workspaceId
  const agentCode = envString('HERMES_SMOKE_AGENT_CODE')
  if (agentCode) body.agentCode = agentCode
  return body
}

async function runSkillProposalCreateSmoke(
  simBaseUrl: string,
  results: CheckResult[]
): Promise<void> {
  const hasContext = requireSimContext(results, [
    'HERMES_SERVICE_TOKEN',
    'HERMES_SMOKE_USER_ID',
    'HERMES_SMOKE_ORGANIZATION_ID',
    'HERMES_SMOKE_WORKGROUP_ID',
  ])
  const hasWriteConfirm = requireWriteConfirm(results, 'CREATE_SKILL_PROPOSAL')
  if (!hasContext || !hasWriteConfirm) return

  const traceId = `hermes-skill-proposal-smoke-${Date.now()}`
  const title = `[SMOKE] Hermes Skill Proposal ${traceId}`
  const content = [
    '# SIM Hermes Smoke Skill',
    '',
    `Trace: ${traceId}`,
    '',
    'Use this proposal only to verify the Hermes -> SIM Skill Proposal review bridge.',
    'It must stay pending review until a human admin explicitly publishes or rejects it.',
  ].join('\n')
  const common = buildSkillProposalBaseBody(traceId)

  const createResponse = await postSimSkillProposal(simBaseUrl, {
    ...common,
    operation: 'propose_create',
    title,
    description: 'Smoke-test proposal created by the SIM Hermes release gate.',
    proposedContent: content,
    evidenceRefs: [`smoke:${traceId}`],
    risk: 'low',
    status: 'pending_review',
  })
  const createPayload = asRecord(createResponse.payload)
  const proposal = asRecord(createPayload?.proposal)
  const proposalId = readString(proposal, 'id')
  results.push({
    name: 'sim.skill-proposal-create',
    status:
      createResponse.ok &&
      createPayload?.success === true &&
      readString(proposal, 'status') === 'pending_review' &&
      Boolean(proposalId)
        ? 'pass'
        : 'fail',
    detail: createResponse.ok
      ? `proposal ${proposalId ?? 'missing'}`
      : `HTTP ${createResponse.status}`,
    data: {
      proposalId,
      status: readString(proposal, 'status'),
      title: readString(proposal, 'title'),
    },
  })
  if (!(createResponse.ok && createPayload?.success === true && proposalId)) return

  const compareResponse = await postSimSkillProposal(simBaseUrl, {
    ...common,
    operation: 'compare',
    proposalId,
  })
  const comparePayload = asRecord(compareResponse.payload)
  const comparison = asRecord(comparePayload?.comparison)
  results.push({
    name: 'sim.skill-proposal-compare',
    status:
      compareResponse.ok &&
      comparePayload?.success === true &&
      readString(comparison, 'proposalId') === proposalId
        ? 'pass'
        : 'fail',
    detail: compareResponse.ok ? `proposal ${proposalId}` : `HTTP ${compareResponse.status}`,
  })
}

function readMemories(payload: unknown): Record<string, unknown>[] {
  return readArray(asRecord(payload), 'memories')
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function memoryContains(payload: unknown, marker: string): boolean {
  return readMemories(payload).some((memory) => readString(memory, 'content')?.includes(marker))
}

function baseMemoryBody(traceId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    userId: envString('HERMES_SMOKE_USER_ID'),
    organizationId: envString('HERMES_SMOKE_ORGANIZATION_ID'),
    traceId,
    hermesRunId: `hermes-smoke-memory-${Date.now()}`,
  }
  const workspaceId = envString('HERMES_SMOKE_WORKSPACE_ID')
  if (workspaceId) body.workspaceId = workspaceId
  return body
}

async function runMemorySmoke(simBaseUrl: string, results: CheckResult[]): Promise<void> {
  if (
    !requireSimContext(results, [
      'HERMES_SERVICE_TOKEN',
      'HERMES_SMOKE_USER_ID',
      'HERMES_SMOKE_OTHER_USER_ID',
      'HERMES_SMOKE_ORGANIZATION_ID',
    ])
  ) {
    return
  }

  const traceId = `hermes-memory-smoke-${Date.now()}`
  const marker = `${traceId}-preference`
  const memoryContent = `${marker}: 用户做短视频脚本时偏好先出三版 hook，再生成分镜。`
  const common = baseMemoryBody(traceId)

  const writeResponse = await postSimMemory(simBaseUrl, {
    ...common,
    operation: 'write',
    content: memoryContent,
    category: 'workflow_habit',
    evidenceRefs: [`smoke:${traceId}`],
    metadata: { smoke: true },
  })
  const writePayload = asRecord(writeResponse.payload)
  results.push({
    name: 'sim.hermes-memory-write',
    status: writeResponse.ok && writePayload?.success === true ? 'pass' : 'fail',
    detail: writeResponse.ok ? `HTTP ${writeResponse.status}` : `HTTP ${writeResponse.status}`,
    data: summarizePayload(writeResponse.payload),
  })
  if (!(writeResponse.ok && writePayload?.success === true)) return

  const prefetchResponse = await postSimMemory(simBaseUrl, {
    ...common,
    operation: 'prefetch',
    query: marker,
    limit: 5,
  })
  results.push({
    name: 'sim.hermes-memory-prefetch',
    status:
      prefetchResponse.ok && memoryContains(prefetchResponse.payload, marker) ? 'pass' : 'fail',
    detail: prefetchResponse.ok
      ? `matched ${readMemories(prefetchResponse.payload).length} item(s)`
      : `HTTP ${prefetchResponse.status}`,
  })

  const otherUserResponse = await postSimMemory(simBaseUrl, {
    ...common,
    userId: envString('HERMES_SMOKE_OTHER_USER_ID'),
    operation: 'prefetch',
    query: marker,
    limit: 5,
  })
  results.push({
    name: 'sim.hermes-memory-user-isolation',
    status:
      otherUserResponse.ok && !memoryContains(otherUserResponse.payload, marker) ? 'pass' : 'fail',
    detail: otherUserResponse.ok
      ? `other user matched ${readMemories(otherUserResponse.payload).length} item(s)`
      : `HTTP ${otherUserResponse.status}`,
  })

  const ephemeralResponse = await postSimMemory(simBaseUrl, {
    ...common,
    operation: 'write',
    content: `${marker}: 记住当前画布这个节点已经生成过视频了，下一步继续用 pendingActionId。`,
    category: 'workflow_habit',
  })
  const ephemeralPayload = asRecord(ephemeralResponse.payload)
  results.push({
    name: 'sim.hermes-memory-reject-ephemeral',
    status:
      ephemeralResponse.status === 400 &&
      ephemeralPayload?.success === false &&
      ephemeralPayload.errorCode === 'INVALID_MEMORY_CONTENT'
        ? 'pass'
        : 'fail',
    detail: `HTTP ${ephemeralResponse.status}`,
    data: summarizePayload(ephemeralResponse.payload),
  })
}

function printResults(results: CheckResult[], json: boolean): void {
  const failed = results.filter((result) => result.status === 'fail')
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: failed.length === 0, checks: results }, null, 2)}\n`
    )
    return
  }

  for (const result of results) {
    const marker = result.status === 'pass' ? 'PASS' : result.status === 'skip' ? 'SKIP' : 'FAIL'
    process.stdout.write(
      `[${marker}] ${result.name}${result.detail ? ` - ${result.detail}` : ''}\n`
    )
  }
}

export async function runSmoke(argv: string[] = process.argv.slice(2)): Promise<{
  options: Options
  results: CheckResult[]
}> {
  const options = parseOptions(argv)
  const results: CheckResult[] = []
  const hermesUrl = requiredEnv('HERMES_API_URL', results)
  const hermesApiKey = requiredEnv('HERMES_API_KEY', results)
  const simBaseUrl = trimTrailingSlash(envString('SIM_BASE_URL') ?? 'http://127.0.0.1:3000')

  if (!hermesUrl || !hermesApiKey) {
    return { options, results }
  }

  const hermesBaseUrl = trimTrailingSlash(hermesUrl)
  try {
    await checkHermesHealth(hermesBaseUrl, hermesApiKey, results)
    await checkCapabilities(hermesBaseUrl, hermesApiKey, results)
    await checkToolsets(hermesBaseUrl, hermesApiKey, results)
    if (!options.skipSimHealth) await checkSimHealth(simBaseUrl, results)
    if (options.chat) await runChatSmoke(hermesBaseUrl, hermesApiKey, results)
    if (options.canvasRead) await runCanvasReadSmoke(hermesBaseUrl, hermesApiKey, results)
    if (options.skillList) await runSkillListSmoke(hermesBaseUrl, hermesApiKey, results)
    if (options.skillProposalCreate) await runSkillProposalCreateSmoke(simBaseUrl, results)
    if (options.memory) await runMemorySmoke(simBaseUrl, results)
  } catch (error) {
    results.push({
      name: 'smoke.unhandled-error',
      status: 'fail',
      detail: error instanceof Error ? error.message : String(error),
    })
  }

  return { options, results }
}

async function main(): Promise<void> {
  const { options, results } = await runSmoke()
  printResults(results, options.json)
  process.exit(results.some((result) => result.status === 'fail') ? 1 : 0)
}

if (import.meta.main) {
  await main()
}
