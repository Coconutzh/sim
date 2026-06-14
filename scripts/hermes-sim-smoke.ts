#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parseDotEnv } from './check-hermes-local-preflight'

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
  conversationChain: boolean
  canvasPropose: boolean
  canvasHistory: boolean
  canvasProposeApply: boolean
  canvasRead: boolean
  skillList: boolean
  skillProposalCreate: boolean
  memory: boolean
  skipSimHealth: boolean
}

const DEFAULT_REQUIRED_TOOLSETS = ['sim']
const DEFAULT_SIM_ENV_FILE = path.join('apps', 'sim', '.env')
let cachedSmokeSessionId: string | undefined
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
  sim: [
    'sim_canvas_agent_run',
    'sim_canvas_history_query',
    'sim_skill_proposal_run',
    'sim_external_evidence_prepare',
  ],
}

function printUsage(): void {
  process.stdout.write(`SIM Hermes smoke test

Usage:
  bun run scripts/hermes-sim-smoke.ts [--chat] [--conversation-chain] [--canvas-read] [--canvas-propose] [--canvas-propose-apply] [--canvas-history] [--skill-list] [--skill-proposal-create] [--memory] [--json]

Required env:
  HERMES_API_URL              Hermes API Server base URL, e.g. http://127.0.0.1:8642
  HERMES_API_KEY              Bearer token matching Hermes API_SERVER_KEY

Optional env:
  SIM_BASE_URL                SIM base URL, default http://127.0.0.1:3000
  INTERNAL_API_SECRET         Enables SIM /api/internal/hermes/health check
  HERMES_SERVICE_TOKEN        Required for --canvas-propose-apply / --skill-proposal-create / --memory service checks
  HERMES_REQUIRED_TOOLSETS    Default sim
  HERMES_FORBIDDEN_TOOLSETS   Default browser,code_execution,computer_use,cronjob,delegation,file,terminal
  HERMES_SMOKE_MODEL          Optional Hermes model override
  HERMES_SMOKE_USER_ID        Required for --canvas-read / --canvas-propose-apply / --skill-list / --skill-proposal-create
  HERMES_SMOKE_ORGANIZATION_ID Required for --skill-list / --skill-proposal-create, recommended for all SIM metadata
  HERMES_SMOKE_WORKGROUP_ID   Required for --skill-proposal-create
  HERMES_SMOKE_WORKSPACE_ID   Required for --canvas-read / --canvas-propose-apply
  HERMES_SMOKE_WORKFLOW_ID    Required for --canvas-read / --canvas-propose-apply
  HERMES_SMOKE_OTHER_USER_ID  Required for --memory isolation check
  HERMES_SMOKE_WRITE_CONFIRM  Must be CREATE_SKILL_PROPOSAL for --skill-proposal-create, APPLY_CANVAS_PROPOSAL for --canvas-propose-apply
  HERMES_SMOKE_CHAT_ID        Optional real SIM copilot chat id; omit for headless canvas smoke
  HERMES_SMOKE_SESSION_ID     Optional Hermes gateway session id; defaults to an ephemeral smoke id
  HERMES_SMOKE_CANVAS_TITLE   Optional title for the temporary node created by --canvas-propose-apply
  HERMES_SMOKE_AGENT_CODE     Optional SIM agent code for skill proposal smoke
  HERMES_SMOKE_SELECTED_NODE_IDS Comma-separated selected node ids
  HERMES_SMOKE_TIMEOUT_MS     Default 120000
  HERMES_SMOKE_LOAD_ENV_FILES Set to false to disable auto-loading apps/sim/.env and ../hermes-agent-sim/.env

Notes:
  Default checks are read-only: Hermes health, capabilities, toolset policy,
  and SIM aggregated health when INTERNAL_API_SECRET is present.
  --chat sends a no-tool OpenAI-compatible chat completion.
  --conversation-chain verifies Responses API conversation + store=true continuity and isolation.
  --canvas-read asks Hermes to call sim_canvas_agent_run in read_only mode and verifies the tool call.
  --canvas-propose asks Hermes to create a confirmable proposal without applying it.
  --canvas-propose-apply asks Hermes to propose a canvas mutation, then confirms the exact pendingActionId.
  --canvas-history asks Hermes to call sim_canvas_history_query and verifies the tool call.
  --skill-list asks Hermes to list published SIM skills only and verifies the tool call.
  --skill-proposal-create creates a pending-review SIM skill proposal and compares it.
  --memory exercises SIM-backed Hermes user memory write/prefetch/isolation through SIM internal APIs.
`)
}

async function readEnvFile(filePath: string): Promise<Record<string, string>> {
  try {
    return parseDotEnv(await readFile(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function applyMissingEnv(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export async function loadDefaultLocalEnvFiles(cwd = process.cwd()): Promise<void> {
  if (process.env.HERMES_SMOKE_LOAD_ENV_FILES?.trim().toLowerCase() === 'false') return
  applyMissingEnv(await readEnvFile(path.resolve(cwd, DEFAULT_SIM_ENV_FILE)))
  applyMissingEnv(await readEnvFile(path.resolve(path.dirname(cwd), 'hermes-agent-sim', '.env')))
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
    conversationChain: flags.has('--conversation-chain'),
    canvasPropose: flags.has('--canvas-propose'),
    canvasHistory: flags.has('--canvas-history'),
    canvasProposeApply: flags.has('--canvas-propose-apply'),
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

function smokeSessionId(): string {
  const configured = envString('HERMES_SMOKE_SESSION_ID') ?? envString('HERMES_SMOKE_CHAT_ID')
  if (configured) return configured
  cachedSmokeSessionId ??= `hermes-smoke-${Date.now()}`
  return cachedSmokeSessionId
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

function responseOutputItems(payload: unknown): Record<string, unknown>[] {
  return readArray(asRecord(payload), 'output')
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function responseHasFunctionCall(payload: unknown, toolName: string): boolean {
  return responseOutputItems(payload).some(
    (item) => item.type === 'function_call' && item.name === toolName
  )
}

function firstFunctionCall(
  payload: unknown,
  toolName?: string
): Record<string, unknown> | undefined {
  return responseOutputItems(payload).find(
    (item) => item.type === 'function_call' && (!toolName || item.name === toolName)
  )
}

function responseEvidence(payload: unknown, toolName?: string): Record<string, string> {
  const response = asRecord(payload)
  const call = firstFunctionCall(payload, toolName)
  return Object.fromEntries(
    [
      ['responseId', readString(response, 'id')],
      ['toolCallId', readString(call, 'call_id') ?? readString(call, 'id')],
      ['toolName', readString(call, 'name')],
    ].filter((entry): entry is [string, string] => Boolean(entry[1]))
  )
}

function canvasSnapshot(payload: unknown): Record<string, unknown> | undefined {
  const canvas = asRecord(asRecord(payload)?.canvas)
  if (!canvas) return undefined
  const nodes = readArray(canvas, 'nodes')
    .map((node) => asRecord(node))
    .filter((node): node is Record<string, unknown> => Boolean(node))
    .map((node) => ({
      id: readString(node, 'id'),
      name: readString(node, 'name'),
      type: readString(node, 'type'),
    }))
  const edges = readArray(canvas, 'edges')
    .map((edge) => asRecord(edge))
    .filter((edge): edge is Record<string, unknown> => Boolean(edge))
    .map((edge) => ({
      id: readString(edge, 'id'),
      source: readString(edge, 'source'),
      target: readString(edge, 'target'),
    }))
  return {
    nodeCount: canvas.nodeCount,
    edgeCount: canvas.edgeCount,
    nodes,
    edges,
  }
}

function canvasSnapshotFingerprint(snapshot: Record<string, unknown> | undefined): string {
  return JSON.stringify(snapshot ?? {})
}

function readCanvasSnapshot(simBaseUrl: string, serviceToken: string, label: string) {
  return fetchJson(`${simBaseUrl}/api/internal/hermes/canvas-agent/run`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-sim-service-token': serviceToken,
    },
    body: JSON.stringify({
      userId: envString('HERMES_SMOKE_USER_ID'),
      organizationId: envString('HERMES_SMOKE_ORGANIZATION_ID'),
      workspaceId: envString('HERMES_SMOKE_WORKSPACE_ID'),
      workflowId: envString('HERMES_SMOKE_WORKFLOW_ID'),
      mode: 'read_only',
      message: `Read canvas state for ${label} smoke verification.`,
      traceId: `hermes-smoke-canvas-${label}-${Date.now()}`,
    }),
  })
}

async function verifyReadOnlyCanvasUnchanged(
  simBaseUrl: string,
  beforeRead: JsonResponse | undefined,
  label: string,
  results: CheckResult[]
): Promise<void> {
  const serviceToken = envString('HERMES_SERVICE_TOKEN')
  if (!serviceToken || !beforeRead) return
  const beforeSnapshot = canvasSnapshot(beforeRead.payload)
  const afterRead = await readCanvasSnapshot(simBaseUrl, serviceToken, `${label}-after`)
  const afterSnapshot = canvasSnapshot(afterRead.payload)
  const unchanged =
    beforeRead.ok &&
    afterRead.ok &&
    canvasSnapshotFingerprint(beforeSnapshot) === canvasSnapshotFingerprint(afterSnapshot)
  results.push({
    name: `sim.${label}-read-only-verify`,
    status: unchanged ? 'pass' : 'fail',
    detail: afterRead.ok
      ? unchanged
        ? `canvas unchanged (${String(beforeSnapshot?.nodeCount ?? 'unknown')} nodes)`
        : 'canvas changed during read-only smoke'
      : httpFailureDetail(afterRead),
    data: {
      before: beforeSnapshot,
      after: afterSnapshot,
    },
  })
}

function parseJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  if (typeof value !== 'string') return undefined
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return undefined
  }
}

function responseFunctionCallOutputs(payload: unknown): Record<string, unknown>[] {
  return responseOutputItems(payload)
    .filter((item) => item.type === 'function_call_output')
    .map((item) => parseJsonObject(item.output))
    .filter((item): item is Record<string, unknown> => Boolean(item))
}

function firstToolOutput(payload: unknown): Record<string, unknown> | undefined {
  return responseFunctionCallOutputs(payload)[0]
}

function responseOutputText(payload: unknown): string {
  return responseOutputItems(payload)
    .flatMap((item) => readArray(item, 'content'))
    .map((content) => asRecord(content))
    .filter((content): content is Record<string, unknown> => Boolean(content))
    .map((content) => readString(content, 'text') ?? '')
    .filter(Boolean)
    .join('\n')
}

function getTimeoutMs(): number {
  const raw = Number(envString('HERMES_SMOKE_TIMEOUT_MS'))
  return Number.isFinite(raw) && raw >= 1000 ? raw : 120000
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
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: { error: error instanceof Error ? error.message : String(error) },
    }
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

function payloadError(payload: unknown): string | undefined {
  const record = asRecord(payload)
  const direct = readString(record, 'error') ?? readString(record, 'message')
  if (direct) return direct
  const nestedError = asRecord(record?.error)
  return readString(nestedError, 'message') ?? readString(nestedError, 'detail')
}

function httpFailureDetail(response: JsonResponse): string {
  const error = payloadError(response.payload)
  return error ? `HTTP ${response.status}: ${error}` : `HTTP ${response.status}`
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
    detail: response.status === 0 ? payloadError(response.payload) : `HTTP ${response.status}`,
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
  if (response.status === 0) {
    results.push({
      name: 'hermes.capabilities',
      status: 'fail',
      detail: payloadError(response.payload) ?? 'request failed',
      data: response.payload,
    })
    return
  }
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
  if (response.status === 0) {
    results.push({
      name: 'hermes.toolsets',
      status: 'fail',
      detail: payloadError(response.payload) ?? 'request failed',
      data: response.payload,
    })
    return
  }
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
    detail: response.status === 0 ? payloadError(response.payload) : `HTTP ${response.status}`,
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
  const chatId = envString('HERMES_SMOKE_CHAT_ID')
  return {
    sim: {
      userId: envString('HERMES_SMOKE_USER_ID'),
      organizationId: envString('HERMES_SMOKE_ORGANIZATION_ID'),
      workspaceId: envString('HERMES_SMOKE_WORKSPACE_ID'),
      workflowId: envString('HERMES_SMOKE_WORKFLOW_ID'),
      ...(chatId ? { chatId } : {}),
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
      'x-hermes-session-id': smokeSessionId(),
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
    detail: response.ok ? content.slice(0, 160) : httpFailureDetail(response),
    data: responseEvidence(response.payload),
  })
}

async function runConversationChainSmoke(
  baseUrl: string,
  apiKey: string,
  results: CheckResult[]
): Promise<void> {
  const marker = `SIM_CHAIN_ALPHA_${Date.now()}`
  const conversation = `sim:smoke:conversation:${Date.now()}`
  const isolatedConversation = `${conversation}:isolated`
  const headers = {
    ...buildAuthHeaders(apiKey),
    'content-type': 'application/json',
    'x-hermes-session-key': `sim:smoke:user:${envString('HERMES_SMOKE_USER_ID') ?? 'anonymous'}`,
  }

  const first = await fetchJson(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      instructions:
        'You are responding to a SIM-Hermes conversation-chain smoke test. Do not call tools.',
      input: `Remember this test phrase for this conversation only: ${marker}. Reply with SIM_CHAIN_STORED.`,
      conversation,
      store: true,
      truncation: 'auto',
    }),
  })
  const second = await fetchJson(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      instructions:
        'You are responding to a SIM-Hermes conversation-chain smoke test. Do not call tools.',
      input: 'What was the test phrase from the previous turn?',
      conversation,
      store: true,
      truncation: 'auto',
    }),
  })
  const isolated = await fetchJson(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      instructions:
        'You are responding to a SIM-Hermes conversation-chain smoke test. If the current conversation has no prior test phrase, reply exactly: SIM_CHAIN_NONE. Do not call tools.',
      input: 'What was the previous test phrase?',
      conversation: isolatedConversation,
      store: true,
      truncation: 'auto',
    }),
  })

  const secondText = responseOutputText(second.payload)
  const isolatedText = responseOutputText(isolated.payload)
  const ok =
    first.ok &&
    second.ok &&
    isolated.ok &&
    secondText.includes(marker) &&
    !isolatedText.includes(marker)
  results.push({
    name: 'hermes.conversation-chain',
    status: ok ? 'pass' : 'fail',
    detail: ok
      ? `conversation continued and isolated (${conversation})`
      : `first=${first.status} second=${second.status} isolated=${isolated.status} second="${secondText.slice(0, 120)}" isolated="${isolatedText.slice(0, 120)}"`,
    data: {
      conversation,
      isolatedConversation,
      marker,
      firstResponseId: readString(asRecord(first.payload), 'id'),
      secondResponseId: readString(asRecord(second.payload), 'id'),
      isolatedResponseId: readString(asRecord(isolated.payload), 'id'),
    },
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
  simBaseUrl: string,
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

  const serviceToken = envString('HERMES_SERVICE_TOKEN')
  const beforeRead = serviceToken
    ? await readCanvasSnapshot(simBaseUrl, serviceToken, 'canvas-read-before')
    : undefined
  const response = await fetchJson(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(apiKey),
      'content-type': 'application/json',
      'x-hermes-session-key': `sim:smoke:user:${envString('HERMES_SMOKE_USER_ID')}`,
      'x-hermes-session-id': smokeSessionId(),
    },
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      instructions:
        'You are a SIM smoke-test agent. You must use sim_canvas_agent_run with mode=read_only only.',
      input:
        'Inspect the SIM canvas in read_only mode and return a concise summary. Do not propose or apply changes.',
      metadata: buildSimMetadata(),
      store: false,
    }),
  })
  const content = responseOutputText(response.payload)
  results.push({
    name: 'hermes.sim-canvas-read',
    status:
      response.ok && responseHasFunctionCall(response.payload, 'sim_canvas_agent_run')
        ? 'pass'
        : 'fail',
    detail: response.ok
      ? `${responseHasFunctionCall(response.payload, 'sim_canvas_agent_run') ? 'tool called' : 'tool call missing'}${content ? ` - ${content.slice(0, 200)}` : ''}`
      : httpFailureDetail(response),
    data: responseEvidence(response.payload, 'sim_canvas_agent_run'),
  })
  await verifyReadOnlyCanvasUnchanged(simBaseUrl, beforeRead, 'canvas-read', results)
}

async function runCanvasHistorySmoke(
  baseUrl: string,
  apiKey: string,
  simBaseUrl: string,
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

  const serviceToken = envString('HERMES_SERVICE_TOKEN')
  const beforeRead = serviceToken
    ? await readCanvasSnapshot(simBaseUrl, serviceToken, 'canvas-history-before')
    : undefined
  const response = await fetchJson(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(apiKey),
      'content-type': 'application/json',
      'x-hermes-session-key': `sim:smoke:user:${envString('HERMES_SMOKE_USER_ID')}`,
      'x-hermes-session-id': smokeSessionId(),
    },
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      instructions:
        'You are a SIM smoke-test agent. You must use sim_canvas_history_query exactly once with query=recent_operations before answering. Do not call sim_canvas_agent_run in this step.',
      input:
        'Query the authoritative SIM canvas operation history for this workflow and summarize the latest operation count.',
      metadata: buildSimMetadata(),
      store: false,
    }),
  })
  const content = responseOutputText(response.payload)
  results.push({
    name: 'hermes.sim-canvas-history',
    status:
      response.ok && responseHasFunctionCall(response.payload, 'sim_canvas_history_query')
        ? 'pass'
        : 'fail',
    detail: response.ok
      ? `${responseHasFunctionCall(response.payload, 'sim_canvas_history_query') ? 'tool called' : 'tool call missing'}${content ? ` - ${content.slice(0, 200)}` : ''}`
      : httpFailureDetail(response),
    data: responseEvidence(response.payload, 'sim_canvas_history_query'),
  })
  await verifyReadOnlyCanvasUnchanged(simBaseUrl, beforeRead, 'canvas-history', results)
}

async function runCanvasProposeSmoke(
  baseUrl: string,
  apiKey: string,
  simBaseUrl: string,
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

  const serviceToken = envString('HERMES_SERVICE_TOKEN')
  const beforeRead = serviceToken
    ? await readCanvasSnapshot(simBaseUrl, serviceToken, 'canvas-proposal-before')
    : undefined
  const nodeTitle =
    envString('HERMES_SMOKE_CANVAS_TITLE') ?? `Hermes Smoke Proposal ${new Date().toISOString()}`
  const response = await fetchJson(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(apiKey),
      'content-type': 'application/json',
      'x-hermes-session-key': `sim:smoke:user:${envString('HERMES_SMOKE_USER_ID')}`,
      'x-hermes-session-id': smokeSessionId(),
    },
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      instructions:
        'You are a SIM smoke-test agent. You must use sim_canvas_agent_run exactly once with mode=propose. Do not apply changes.',
      input: `Propose creating one temporary text content node titled "${nodeTitle}" on the SIM canvas. Return the pendingActionId from SIM.`,
      metadata: buildSimMetadata(),
      store: false,
    }),
  })
  const output = firstToolOutput(response.payload)
  const pendingActionId = readString(output, 'pendingActionId')
  const ok =
    response.ok &&
    responseHasFunctionCall(response.payload, 'sim_canvas_agent_run') &&
    output?.success === true &&
    output.mode === 'propose' &&
    output.requiresConfirmation === true &&
    Boolean(pendingActionId)
  results.push({
    name: 'hermes.sim-canvas-propose',
    status: ok ? 'pass' : 'fail',
    detail: response.ok
      ? ok
        ? `pendingActionId ${pendingActionId}`
        : `proposal missing expected pending action${responseOutputText(response.payload) ? ` - ${responseOutputText(response.payload).slice(0, 200)}` : ''}`
      : httpFailureDetail(response),
    data: {
      ...responseEvidence(response.payload, 'sim_canvas_agent_run'),
      pendingActionId,
    },
  })
  await verifyReadOnlyCanvasUnchanged(simBaseUrl, beforeRead, 'canvas-proposal', results)
}

async function runCanvasProposeApplySmoke(
  baseUrl: string,
  apiKey: string,
  simBaseUrl: string,
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
  if (!requireWriteConfirm(results, 'APPLY_CANVAS_PROPOSAL')) return
  const serviceToken = requiredEnv('HERMES_SERVICE_TOKEN', results)
  if (!serviceToken) return

  const sessionId = smokeSessionId()
  const nodeTitle =
    envString('HERMES_SMOKE_CANVAS_TITLE') ?? `Hermes Smoke Node ${new Date().toISOString()}`
  const baseHeaders = {
    ...buildAuthHeaders(apiKey),
    'content-type': 'application/json',
    'x-hermes-session-key': `sim:smoke:user:${envString('HERMES_SMOKE_USER_ID')}`,
    'x-hermes-session-id': sessionId,
  }
  const readCanvas = (label: string) =>
    fetchJson(`${simBaseUrl}/api/internal/hermes/canvas-agent/run`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-sim-service-token': serviceToken,
      },
      body: JSON.stringify({
        userId: envString('HERMES_SMOKE_USER_ID'),
        organizationId: envString('HERMES_SMOKE_ORGANIZATION_ID'),
        workspaceId: envString('HERMES_SMOKE_WORKSPACE_ID'),
        workflowId: envString('HERMES_SMOKE_WORKFLOW_ID'),
        mode: 'read_only',
        message: `Read canvas state before/after ${label} smoke.`,
        traceId: `hermes-smoke-canvas-${label}-${Date.now()}`,
      }),
    })

  const beforeRead = await readCanvas('before')
  const beforeCanvas = asRecord(asRecord(beforeRead.payload)?.canvas)
  const beforeNodeCount = beforeCanvas?.nodeCount
  if (!beforeRead.ok || typeof beforeNodeCount !== 'number') {
    results.push({
      name: 'sim.canvas-write-before-read',
      status: 'fail',
      detail: beforeRead.ok ? 'missing canvas node count' : httpFailureDetail(beforeRead),
    })
    return
  }

  const proposalResponse = await fetchJson(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      instructions:
        'You are a SIM smoke-test agent. You must use sim_canvas_agent_run exactly once with mode=propose. Do not apply changes in this step.',
      input: `Propose creating one temporary text content node titled "${nodeTitle}" on the SIM canvas. The node should contain a short smoke-test note. Return the pendingActionId from SIM.`,
      metadata: buildSimMetadata(),
      store: false,
    }),
  })
  const proposalOutput = firstToolOutput(proposalResponse.payload)
  const pendingActionId = readString(proposalOutput, 'pendingActionId')
  const proposalOk =
    proposalResponse.ok &&
    responseHasFunctionCall(proposalResponse.payload, 'sim_canvas_agent_run') &&
    proposalOutput?.success === true &&
    proposalOutput.mode === 'propose' &&
    proposalOutput.requiresConfirmation === true &&
    Boolean(pendingActionId)
  results.push({
    name: 'hermes.sim-canvas-propose',
    status: proposalOk ? 'pass' : 'fail',
    detail: proposalResponse.ok
      ? proposalOk
        ? `pendingActionId ${pendingActionId}`
        : `proposal missing expected pending action${responseOutputText(proposalResponse.payload) ? ` - ${responseOutputText(proposalResponse.payload).slice(0, 200)}` : ''}`
      : httpFailureDetail(proposalResponse),
    data: {
      ...responseEvidence(proposalResponse.payload, 'sim_canvas_agent_run'),
      pendingActionId,
    },
  })
  if (!proposalOk || !pendingActionId) return

  const applyResponse = await fetchJson(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      instructions:
        'You are a SIM smoke-test agent. The user has explicitly confirmed the pending SIM canvas proposal. You must use sim_canvas_agent_run exactly once with mode=apply_after_confirm and the provided pendingActionId.',
      input: `User confirmation: apply the SIM canvas proposal now. Use pendingActionId "${pendingActionId}" and do not invent a different id.`,
      metadata: buildSimMetadata(),
      store: false,
    }),
  })
  const applyOutput = firstToolOutput(applyResponse.payload)
  const changedNodeIds = readArray(applyOutput, 'changedNodeIds').filter(
    (item): item is string => typeof item === 'string' && item.length > 0
  )
  const applyOk =
    applyResponse.ok &&
    responseHasFunctionCall(applyResponse.payload, 'sim_canvas_agent_run') &&
    applyOutput?.success === true &&
    applyOutput.mode === 'apply_after_confirm' &&
    applyOutput.pendingActionId === pendingActionId &&
    changedNodeIds.length > 0
  results.push({
    name: 'hermes.sim-canvas-apply-after-confirm',
    status: applyOk ? 'pass' : 'fail',
    detail: applyResponse.ok
      ? applyOk
        ? `changed ${changedNodeIds.join(', ')}`
        : `apply missing expected write confirmation${responseOutputText(applyResponse.payload) ? ` - ${responseOutputText(applyResponse.payload).slice(0, 200)}` : ''}`
      : httpFailureDetail(applyResponse),
    data: applyOk
      ? {
          ...responseEvidence(applyResponse.payload, 'sim_canvas_agent_run'),
          pendingActionId,
          changedNodeIds,
          verificationSummary: readString(applyOutput, 'verificationSummary'),
        }
      : undefined,
  })

  if (!applyOk) return

  const afterRead = await readCanvas('after')
  const afterCanvas = asRecord(asRecord(afterRead.payload)?.canvas)
  const afterNodeCount = afterCanvas?.nodeCount
  const afterNodes = readArray(afterCanvas, 'nodes').map((node) => asRecord(node))
  const hasExpectedNode = afterNodes.some((node) => readString(node, 'name') === nodeTitle)
  const writeVerified =
    afterRead.ok &&
    typeof afterNodeCount === 'number' &&
    afterNodeCount >= beforeNodeCount + 1 &&
    hasExpectedNode
  results.push({
    name: 'sim.canvas-write-verify',
    status: writeVerified ? 'pass' : 'fail',
    detail: afterRead.ok
      ? writeVerified
        ? `node count ${beforeNodeCount} -> ${afterNodeCount}; found "${nodeTitle}"`
        : `expected node count >= ${beforeNodeCount + 1} and title "${nodeTitle}", got ${afterNodeCount ?? 'unknown'}`
      : httpFailureDetail(afterRead),
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

  const response = await fetchJson(`${baseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      ...buildAuthHeaders(apiKey),
      'content-type': 'application/json',
      'x-hermes-session-key': `sim:smoke:user:${envString('HERMES_SMOKE_USER_ID')}`,
      'x-hermes-session-id': smokeSessionId(),
    },
    body: JSON.stringify({
      model: envString('HERMES_SMOKE_MODEL'),
      instructions:
        'You are a SIM smoke-test agent. You must use sim_skill_proposal_run only for list_published. Do not create, patch, submit, publish, enable, disable, delete, or roll back skills.',
      input:
        'List published SIM skills for this organization and summarize the count. This is read-only.',
      metadata: buildSimMetadata(),
      store: false,
    }),
  })
  const content = responseOutputText(response.payload)
  results.push({
    name: 'hermes.sim-skill-list',
    status:
      response.ok && responseHasFunctionCall(response.payload, 'sim_skill_proposal_run')
        ? 'pass'
        : 'fail',
    detail: response.ok
      ? `${responseHasFunctionCall(response.payload, 'sim_skill_proposal_run') ? 'tool called' : 'tool call missing'}${content ? ` - ${content.slice(0, 200)}` : ''}`
      : httpFailureDetail(response),
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
    if (options.conversationChain) {
      await runConversationChainSmoke(hermesBaseUrl, hermesApiKey, results)
    }
    if (options.canvasRead) {
      await runCanvasReadSmoke(hermesBaseUrl, hermesApiKey, simBaseUrl, results)
    }
    if (options.canvasHistory) {
      await runCanvasHistorySmoke(hermesBaseUrl, hermesApiKey, simBaseUrl, results)
    }
    if (options.canvasPropose) {
      await runCanvasProposeSmoke(hermesBaseUrl, hermesApiKey, simBaseUrl, results)
    }
    if (options.canvasProposeApply) {
      await runCanvasProposeApplySmoke(hermesBaseUrl, hermesApiKey, simBaseUrl, results)
    }
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
  await loadDefaultLocalEnvFiles()
  const { options, results } = await runSmoke()
  printResults(results, options.json)
  process.exit(results.some((result) => result.status === 'fail') ? 1 : 0)
}

if (import.meta.main) {
  await main()
}
