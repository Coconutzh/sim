import { generateShortId } from '@sim/utils/id'
import type {
  LocalAgentContext,
  LocalAgentToolCall,
  LocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const REDACTED_KEYS = new Set([
  'apiKey',
  'authorization',
  'base64',
  'binary',
  'content',
  'contentHtml',
  'cookie',
  'file',
  'image',
  'password',
  'secret',
  'token',
  'url',
  'video',
])
const MAX_STRING_PREVIEW = 160
const MAX_ARRAY_PREVIEW = 6
const MAX_OBJECT_KEYS = 12

export interface LocalAgentOperationTrace {
  id: string
  kind: 'tool'
  name: string
  startedAtMs: number
}

export interface LocalAgentTraceLogFields {
  traceId: string
  elapsedMs: number
  chatId?: string
  workspaceId: string
  workflowId: string
  toolName?: string
  success?: boolean
  summary?: string
  inputPreview?: unknown
  outputPreview?: unknown
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return [...REDACTED_KEYS].some((redacted) => normalized.includes(redacted.toLowerCase()))
}

function redactString(value: string): string {
  if (value.length <= MAX_STRING_PREVIEW) return value
  return `${value.slice(0, MAX_STRING_PREVIEW)}...[truncated]`
}

export function redactLocalAgentTelemetryValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return redactString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (depth >= 3) return '[redacted-depth]'
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_PREVIEW)
      .map((item) => redactLocalAgentTelemetryValue(item, depth + 1))
  }
  if (typeof value !== 'object') return String(value)
  const record = value as Record<string, unknown>
  const preview: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(record).slice(0, MAX_OBJECT_KEYS)) {
    preview[key] = shouldRedactKey(key)
      ? '[redacted]'
      : redactLocalAgentTelemetryValue(item, depth + 1)
  }
  return preview
}

export function createLocalAgentOperationTrace(params: {
  kind: LocalAgentOperationTrace['kind']
  name: string
  startedAtMs?: number
}): LocalAgentOperationTrace {
  return {
    id: generateShortId(),
    kind: params.kind,
    name: params.name,
    startedAtMs: params.startedAtMs ?? Date.now(),
  }
}

export function buildLocalAgentToolTraceFields(params: {
  context: LocalAgentContext
  trace: LocalAgentOperationTrace
  call: LocalAgentToolCall
  result?: LocalAgentToolResult
  nowMs?: number
}): LocalAgentTraceLogFields {
  const nowMs = params.nowMs ?? Date.now()
  return {
    traceId: params.trace.id,
    elapsedMs: Math.max(0, nowMs - params.trace.startedAtMs),
    chatId: params.context.chatId,
    workspaceId: params.context.workspaceId,
    workflowId: params.context.workflowId,
    toolName: params.call.name,
    success: params.result?.success,
    summary: params.result?.summary,
    inputPreview: redactLocalAgentTelemetryValue(params.call.input),
    outputPreview:
      params.result?.output === undefined
        ? undefined
        : redactLocalAgentTelemetryValue(params.result.output),
  }
}
