import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { Agent, type Dispatcher } from 'undici'
import { env, envNumber } from '@/lib/core/config/env'

const logger = createLogger('HermesClient')
const DEFAULT_HEALTH_TIMEOUT_MS = 5000
const DEFAULT_API_TIMEOUT_MS = 30 * 60 * 1000
const MIN_API_TIMEOUT_MS = 60 * 1000
const CONNECT_TIMEOUT_MS = 30 * 1000
const DEFAULT_FORBIDDEN_TOOLSETS = [
  'browser',
  'code_execution',
  'computer_use',
  'cronjob',
  'delegation',
  'file',
  'terminal',
] as const

export interface HermesChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface HermesChatCompletionParams {
  messages: HermesChatMessage[]
  model?: string
  sessionId?: string
  sessionKey?: string
  metadata?: Record<string, unknown>
  signal?: AbortSignal
}

export interface HermesResponseParams {
  input: HermesResponseInput
  instructions: string
  model?: string
  sessionId?: string
  sessionKey?: string
  metadata?: Record<string, unknown>
  signal?: AbortSignal
  store?: boolean
  conversation?: string
  previousResponseId?: string
  conversationHistory?: HermesResponseConversationMessage[]
  truncation?: 'auto'
}

export interface HermesResponseInputTextPart {
  type: 'input_text'
  text: string
}

export interface HermesResponseInputImagePart {
  type: 'input_image'
  image_url: string
  detail?: 'auto' | 'low' | 'high'
}

export type HermesResponseInputContentPart =
  | HermesResponseInputTextPart
  | HermesResponseInputImagePart

export interface HermesResponseInputMessage {
  role: 'user'
  content: HermesResponseInputContentPart[]
}

export type HermesResponseInput = string | HermesResponseInputMessage[]

export interface HermesResponseConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
}

export interface HermesChatCompletionResult {
  id?: string
  content: string
  sessionId?: string
  sessionKey?: string
  usage?: {
    prompt: number
    completion: number
    total: number
  }
  raw: unknown
}

export interface HermesClientConfig {
  baseUrl: string
  apiKey: string
}

export type HermesHealthStatus = 'unconfigured' | 'healthy' | 'degraded' | 'unreachable'

export interface HermesRuntimeBuildInfo {
  version?: string
  commit?: string | null
  release?: string | null
  buildTime?: string | null
}

export interface HermesCapabilitySummary {
  chatCompletions: boolean
  responsesApi: boolean
  skillsApi: boolean
  sessionKeyHeader?: string
}

export interface HermesToolsetSummary {
  checked: boolean
  required: string[]
  forbidden: string[]
  enabled: string[]
  missing: string[]
  enabledForbidden: string[]
  requiredTools: Record<string, string[]>
  missingTools: Record<string, string[]>
}

export interface HermesHealthCheckResult {
  configured: boolean
  ok: boolean
  status: HermesHealthStatus
  checkedAt: string
  baseUrl?: string
  version?: string
  commit?: string | null
  build?: HermesRuntimeBuildInfo
  capabilities?: HermesCapabilitySummary
  toolsets?: HermesToolsetSummary
  responseStatus?: number
  error?: string
}

export interface HermesHealthCheckOptions {
  signal?: AbortSignal
  includeToolsets?: boolean
}

export class HermesClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message)
    this.name = 'HermesClientError'
  }
}

type HermesFetchInit = RequestInit & { dispatcher?: Dispatcher }

let apiDispatcher: Dispatcher | undefined
let apiDispatcherTimeoutMs: number | undefined

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export function getHermesClientConfig(): HermesClientConfig | null {
  if (!env.HERMES_API_URL || !env.HERMES_API_KEY) return null
  return {
    baseUrl: trimTrailingSlash(env.HERMES_API_URL),
    apiKey: env.HERMES_API_KEY,
  }
}

function getHermesRequiredToolsets(): string[] {
  const raw = env.HERMES_REQUIRED_TOOLSETS
  if (raw === undefined) return ['sim', 'web', 'vision']
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function getHermesForbiddenToolsets(): string[] {
  const raw = env.HERMES_FORBIDDEN_TOOLSETS
  if (raw === undefined) return [...DEFAULT_FORBIDDEN_TOOLSETS]
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function getHermesHealthTimeoutMs(): number {
  return envNumber(env.HERMES_HEALTH_TIMEOUT_MS, DEFAULT_HEALTH_TIMEOUT_MS, { min: 1000 })
}

function getHermesApiTimeoutMs(): number {
  return envNumber(env.HERMES_API_TIMEOUT_MS, DEFAULT_API_TIMEOUT_MS, {
    min: MIN_API_TIMEOUT_MS,
  })
}

function getHermesApiDispatcher(): Dispatcher {
  const timeoutMs = getHermesApiTimeoutMs()
  if (!apiDispatcher || apiDispatcherTimeoutMs !== timeoutMs) {
    apiDispatcher = new Agent({
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connect: { timeout: Math.min(CONNECT_TIMEOUT_MS, timeoutMs) },
    })
    apiDispatcherTimeoutMs = timeoutMs
  }
  return apiDispatcher
}

function formatDurationMs(value: number): string {
  if (value >= 60_000 && value % 60_000 === 0) return `${value / 60_000}m`
  if (value >= 1000 && value % 1000 === 0) return `${value / 1000}s`
  return `${value}ms`
}

function getErrorCauseDetails(error: unknown): {
  name?: string
  code?: string
  message?: string
} {
  const cause = asRecord((error as { cause?: unknown } | null)?.cause)
  return {
    name: readString(cause, 'name'),
    code: readString(cause, 'code'),
    message: readString(cause, 'message'),
  }
}

function formatHermesFetchError(endpointLabel: string, error: unknown, timeoutMs: number): string {
  const err = toError(error)
  const cause = getErrorCauseDetails(error)
  if (cause.code === 'UND_ERR_HEADERS_TIMEOUT') {
    return `${endpointLabel} timed out after ${formatDurationMs(timeoutMs)} waiting for Hermes to return a response. The PPT job is long-running; retry after checking Hermes status, or increase HERMES_API_TIMEOUT_MS.`
  }
  if (err.name === 'AbortError') {
    return `${endpointLabel} was aborted before Hermes returned a response`
  }

  const suffix = cause.code ? ` (${cause.code})` : ''
  return `${endpointLabel} request failed: ${err.message}${suffix}`
}

async function fetchHermesApi(
  config: HermesClientConfig,
  path: string,
  init: RequestInit,
  endpointLabel: string
): Promise<Response> {
  const timeoutMs = getHermesApiTimeoutMs()
  const startedAt = Date.now()
  const fetchInit: HermesFetchInit = {
    ...init,
    dispatcher: getHermesApiDispatcher(),
  }

  try {
    return await fetch(`${config.baseUrl}${path}`, fetchInit)
  } catch (error) {
    const err = toError(error)
    const cause = getErrorCauseDetails(error)
    logger.error(`${endpointLabel} request failed`, {
      baseUrl: config.baseUrl,
      path,
      durationMs: Date.now() - startedAt,
      timeoutMs,
      error: err.message,
      causeName: cause.name,
      causeCode: cause.code,
      causeMessage: cause.message,
    })
    throw new HermesClientError(formatHermesFetchError(endpointLabel, error, timeoutMs))
  }
}

const REQUIRED_TOOLS_BY_TOOLSET: Record<string, string[]> = {
  sim: [
    'sim_canvas_agent_run',
    'sim_canvas_query',
    'sim_canvas_task_propose',
    'sim_canvas_apply_pending',
    'sim_canvas_preview_create',
    'sim_canvas_preview_commit',
    'sim_canvas_preview_discard',
    'sim_canvas_history_query',
    'sim_canvas_media_prepare',
    'sim_presentation_generate_slide_images',
    'sim_presentation_assemble_deck',
    'sim_presentation_artifact_upload',
    'sim_presentation_editable_source_prepare',
    'sim_presentation_editable_runtime',
    'sim_skill_proposal_run',
    'sim_external_evidence_prepare',
  ],
  web: ['web_search', 'web_extract'],
  vision: ['vision_analyze'],
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readNullableString(
  record: Record<string, unknown> | undefined,
  key: string
): string | null | undefined {
  const value = record?.[key]
  if (value === null) return null
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizeBuildInfo(payload: unknown): HermesRuntimeBuildInfo {
  const record = asRecord(payload)
  const build = asRecord(record?.build)
  return {
    version: readString(build, 'version') ?? readString(record, 'version'),
    commit: readNullableString(build, 'commit') ?? readNullableString(record, 'commit'),
    release: readNullableString(build, 'release') ?? readNullableString(record, 'release'),
    buildTime:
      readNullableString(build, 'buildTime') ??
      readNullableString(build, 'build_time') ??
      readNullableString(record, 'buildTime') ??
      readNullableString(record, 'build_time'),
  }
}

function normalizeCapabilities(payload: unknown): HermesCapabilitySummary {
  const record = asRecord(payload)
  const features = asRecord(record?.features)
  return {
    chatCompletions: features?.chat_completions === true,
    responsesApi: features?.responses_api === true,
    skillsApi: features?.skills_api === true,
    sessionKeyHeader: readString(features, 'session_key_header'),
  }
}

function normalizeToolsets(
  payload: unknown,
  required: string[],
  forbidden: string[]
): HermesToolsetSummary {
  const record = asRecord(payload)
  const data = Array.isArray(record?.data) ? record.data : []
  const entries = data
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
  const enabled = entries
    .filter((item) => item.enabled === true)
    .map((item) => readString(item, 'name'))
    .filter((name): name is string => Boolean(name))
    .sort()
  const enabledSet = new Set(enabled)
  const forbiddenSet = new Set(forbidden)
  const enabledEntriesByName = new Map(
    entries
      .filter((item) => item.enabled === true)
      .map((item) => [readString(item, 'name'), item] as const)
      .filter((item): item is readonly [string, Record<string, unknown>] => Boolean(item[0]))
  )
  const requiredTools = Object.fromEntries(
    required
      .filter((name) => REQUIRED_TOOLS_BY_TOOLSET[name]?.length)
      .map((name) => [name, REQUIRED_TOOLS_BY_TOOLSET[name]])
  )
  const missingTools = Object.fromEntries(
    Object.entries(requiredTools)
      .map(([toolset, tools]) => {
        const item = enabledEntriesByName.get(toolset)
        if (!item) return [toolset, []] as const
        const actualTools = Array.isArray(item?.tools)
          ? item.tools.filter((tool): tool is string => typeof tool === 'string')
          : []
        const actualToolSet = new Set(actualTools)
        return [toolset, tools.filter((tool) => !actualToolSet.has(tool))] as const
      })
      .filter(([, tools]) => tools.length > 0)
  )
  return {
    checked: true,
    required,
    forbidden,
    enabled,
    missing: required.filter((name) => !enabledSet.has(name)),
    enabledForbidden: enabled.filter((name) => forbiddenSet.has(name)),
    requiredTools,
    missingTools,
  }
}

async function fetchHermesJson(
  config: HermesClientConfig,
  path: string,
  signal?: AbortSignal
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), getHermesHealthTimeoutMs())
  const abortFromParent = () => controller.abort()

  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', abortFromParent, { once: true })
  }

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      signal: controller.signal,
    })
    const payload = (await response.json().catch(() => ({}))) as unknown
    return { ok: response.ok, status: response.status, payload }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromParent)
  }
}

export async function checkHermesHealth(
  options: HermesHealthCheckOptions = {}
): Promise<HermesHealthCheckResult> {
  const checkedAt = new Date().toISOString()
  const config = getHermesClientConfig()
  if (!config) {
    return {
      configured: false,
      ok: false,
      status: 'unconfigured',
      checkedAt,
      error: 'HERMES_API_URL and HERMES_API_KEY must both be configured',
    }
  }

  try {
    const health = await fetchHermesJson(config, '/health', options.signal)
    const build = normalizeBuildInfo(health.payload)
    if (!health.ok) {
      return {
        configured: true,
        ok: false,
        status: 'unreachable',
        checkedAt,
        baseUrl: config.baseUrl,
        version: build.version,
        commit: build.commit,
        build,
        responseStatus: health.status,
        error: `Hermes health check failed with status ${health.status}`,
      }
    }

    const issues: string[] = []
    if (readString(asRecord(health.payload), 'status') !== 'ok') {
      issues.push('Hermes health status is not ok')
    }

    const capabilitiesResponse = await fetchHermesJson(config, '/v1/capabilities', options.signal)
    const capabilities = normalizeCapabilities(capabilitiesResponse.payload)
    if (!capabilitiesResponse.ok) {
      issues.push(`Hermes capabilities check failed with status ${capabilitiesResponse.status}`)
    }
    if (!capabilities.chatCompletions) issues.push('chat_completions capability is missing')
    if (capabilities.sessionKeyHeader !== 'X-Hermes-Session-Key') {
      issues.push('session key header capability is missing')
    }

    let toolsets: HermesToolsetSummary | undefined
    const requiredToolsets = getHermesRequiredToolsets()
    const forbiddenToolsets = getHermesForbiddenToolsets()
    if (
      options.includeToolsets !== false &&
      (requiredToolsets.length > 0 || forbiddenToolsets.length > 0)
    ) {
      const toolsetsResponse = await fetchHermesJson(config, '/v1/toolsets', options.signal)
      if (toolsetsResponse.ok) {
        toolsets = normalizeToolsets(toolsetsResponse.payload, requiredToolsets, forbiddenToolsets)
        if (toolsets.missing.length > 0) {
          issues.push(`required Hermes toolsets missing: ${toolsets.missing.join(', ')}`)
        }
        if (toolsets.enabledForbidden.length > 0) {
          issues.push(`forbidden Hermes toolsets enabled: ${toolsets.enabledForbidden.join(', ')}`)
        }
        const missingTools = Object.entries(toolsets.missingTools)
        if (missingTools.length > 0) {
          issues.push(
            `required Hermes tools missing: ${missingTools
              .map(([toolset, tools]) => `${toolset}(${tools.join(', ')})`)
              .join('; ')}`
          )
        }
      } else {
        toolsets = {
          checked: false,
          required: requiredToolsets,
          forbidden: forbiddenToolsets,
          enabled: [],
          missing: requiredToolsets,
          enabledForbidden: [],
          requiredTools: {},
          missingTools: {},
        }
        issues.push(`Hermes toolsets check failed with status ${toolsetsResponse.status}`)
      }
    }

    const ok = issues.length === 0
    return {
      configured: true,
      ok,
      status: ok ? 'healthy' : 'degraded',
      checkedAt,
      baseUrl: config.baseUrl,
      version: build.version,
      commit: build.commit,
      build,
      capabilities,
      toolsets,
      responseStatus: capabilitiesResponse.ok ? health.status : capabilitiesResponse.status,
      error: issues.length > 0 ? issues.join('; ') : undefined,
    }
  } catch (error) {
    const err = toError(error)
    logger.warn('Hermes health check failed', { error: err.message, baseUrl: config.baseUrl })
    return {
      configured: true,
      ok: false,
      status: 'unreachable',
      checkedAt,
      baseUrl: config.baseUrl,
      error: err.message,
    }
  }
}

function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  const choices = record.choices
  if (!Array.isArray(choices)) return ''
  const first = choices[0]
  if (!first || typeof first !== 'object') return ''
  const message = (first as Record<string, unknown>).message
  if (!message || typeof message !== 'object') return ''
  const content = (message as Record<string, unknown>).content
  return typeof content === 'string' ? content : ''
}

function extractResponsesContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const output = (payload as Record<string, unknown>).output
  if (!Array.isArray(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const record = block as Record<string, unknown>
      const text = record.text
      if (typeof text === 'string' && text.trim()) parts.push(text)
    }
  }
  return parts.join('\n')
}

function extractUsage(payload: unknown): HermesChatCompletionResult['usage'] {
  if (!payload || typeof payload !== 'object') return undefined
  const usage = (payload as Record<string, unknown>).usage
  if (!usage || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  const prompt = record.prompt_tokens ?? record.input_tokens
  const completion = record.completion_tokens ?? record.output_tokens
  const total = record.total_tokens
  if (typeof prompt !== 'number' || typeof completion !== 'number' || typeof total !== 'number') {
    return undefined
  }
  return { prompt, completion, total }
}

export async function callHermesChatCompletion(
  params: HermesChatCompletionParams
): Promise<HermesChatCompletionResult> {
  const config = getHermesClientConfig()
  if (!config) {
    throw new HermesClientError('Hermes API is not configured')
  }

  try {
    const response = await fetchHermesApi(
      config,
      '/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          ...(params.sessionId ? { 'x-hermes-session-id': params.sessionId } : {}),
          ...(params.sessionKey ? { 'x-hermes-session-key': params.sessionKey } : {}),
        },
        body: JSON.stringify({
          model: params.model,
          messages: params.messages,
          metadata: params.metadata,
        }),
        signal: params.signal,
      },
      'Hermes Chat Completions API'
    )

    const raw = (await response.json().catch(() => ({}))) as unknown
    if (!response.ok) {
      const message =
        raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).error === 'string'
          ? ((raw as Record<string, unknown>).error as string)
          : 'Hermes API request failed'
      throw new HermesClientError(message, response.status)
    }

    const content = extractContent(raw)
    return {
      id:
        raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).id === 'string'
          ? ((raw as Record<string, unknown>).id as string)
          : undefined,
      content,
      sessionId: response.headers.get('x-hermes-session-id') ?? undefined,
      sessionKey: response.headers.get('x-hermes-session-key') ?? undefined,
      usage: extractUsage(raw),
      raw,
    }
  } catch (error) {
    if (error instanceof HermesClientError) throw error
    const err = toError(error)
    logger.error('Hermes API request failed', { error: err.message })
    throw new HermesClientError(err.message)
  }
}

export async function callHermesResponse(
  params: HermesResponseParams
): Promise<HermesChatCompletionResult> {
  const config = getHermesClientConfig()
  if (!config) {
    throw new HermesClientError('Hermes API is not configured')
  }
  if (params.conversation && params.previousResponseId) {
    throw new HermesClientError(
      'Hermes Responses API conversation and previousResponseId are mutually exclusive'
    )
  }

  try {
    const response = await fetchHermesApi(
      config,
      '/v1/responses',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          ...(params.sessionId ? { 'x-hermes-session-id': params.sessionId } : {}),
          ...(params.sessionKey ? { 'x-hermes-session-key': params.sessionKey } : {}),
        },
        body: JSON.stringify({
          model: params.model,
          instructions: params.instructions,
          input: params.input,
          metadata: params.metadata,
          store: params.store ?? false,
          ...(params.conversation ? { conversation: params.conversation } : {}),
          ...(params.previousResponseId ? { previous_response_id: params.previousResponseId } : {}),
          ...(params.conversationHistory?.length
            ? { conversation_history: params.conversationHistory }
            : {}),
          ...(params.truncation ? { truncation: params.truncation } : {}),
        }),
        signal: params.signal,
      },
      'Hermes Responses API'
    )

    const raw = (await response.json().catch(() => ({}))) as unknown
    if (!response.ok) {
      const message =
        raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).error === 'string'
          ? ((raw as Record<string, unknown>).error as string)
          : 'Hermes API request failed'
      throw new HermesClientError(message, response.status)
    }

    return {
      id:
        raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).id === 'string'
          ? ((raw as Record<string, unknown>).id as string)
          : undefined,
      content: extractResponsesContent(raw),
      sessionId: response.headers.get('x-hermes-session-id') ?? undefined,
      sessionKey: response.headers.get('x-hermes-session-key') ?? undefined,
      usage: extractUsage(raw),
      raw,
    }
  } catch (error) {
    if (error instanceof HermesClientError) throw error
    const err = toError(error)
    logger.error('Hermes Responses API request failed', { error: err.message })
    throw new HermesClientError(err.message)
  }
}
