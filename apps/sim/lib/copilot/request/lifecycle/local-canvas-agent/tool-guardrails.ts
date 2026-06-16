import { createLogger } from '@sim/logger'
import { isLocalAgentGuardrailTelemetryEnabled } from '@/lib/copilot/request/lifecycle/local-canvas-agent/feature-flags'
import { recordLocalAgentPerformanceMetric } from '@/lib/copilot/request/lifecycle/local-canvas-agent/observability'
import type {
  LocalAgentContext,
  LocalAgentToolCall,
  LocalAgentToolName,
  LocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const logger = createLogger('LocalCanvasAgentToolGuardrails')

export interface LocalAgentToolGuardrailHistoryEntry {
  toolName: LocalAgentToolName
  inputKey: string
  resultKey?: string
  success?: boolean
  readOnly: boolean
}

export interface LocalAgentToolGuardrailAssessment {
  repeatCount: number
  repeatedFailureCount: number
  noProgressRepeatCount: number
  warnings: string[]
}

function normalizeForStableJson(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(normalizeForStableJson)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeForStableJson(item)])
  )
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(normalizeForStableJson(value))
  } catch {
    return String(value)
  }
}

function clipSignature(value: string): string {
  return value.length > 600 ? value.slice(0, 600) : value
}

function buildInputKey(call: LocalAgentToolCall): string {
  return `${call.name}:${clipSignature(stableStringify(call.input))}`
}

function buildResultKey(result: LocalAgentToolResult): string {
  return clipSignature(
    stableStringify({
      success: result.success,
      summary: result.summary,
      output: result.output,
      error: result.error,
    })
  )
}

export function assessLocalAgentToolGuardrails(params: {
  history: LocalAgentToolGuardrailHistoryEntry[]
  call: LocalAgentToolCall
  readOnly: boolean
}): LocalAgentToolGuardrailAssessment {
  const inputKey = buildInputKey(params.call)
  const matching = params.history.filter((entry) => entry.inputKey === inputKey)
  const repeatedFailureCount = matching.filter((entry) => entry.success === false).length
  const latestResultKey = matching.at(-1)?.resultKey
  const noProgressRepeatCount =
    params.readOnly && latestResultKey
      ? matching.filter((entry) => entry.success && entry.resultKey === latestResultKey).length
      : 0
  const warnings: string[] = []
  if (repeatedFailureCount > 0) {
    warnings.push(
      `Tool ${params.call.name} already failed ${repeatedFailureCount} time(s) with the same input.`
    )
  }
  if (matching.length >= 2) {
    warnings.push(`Tool ${params.call.name} is being repeated with the same input.`)
  }
  if (noProgressRepeatCount >= 2) {
    warnings.push(
      `Read-only tool ${params.call.name} returned the same result ${noProgressRepeatCount} time(s).`
    )
  }
  return {
    repeatCount: matching.length,
    repeatedFailureCount,
    noProgressRepeatCount,
    warnings,
  }
}

export function recordLocalAgentToolGuardrailHistory(params: {
  history: LocalAgentToolGuardrailHistoryEntry[]
  call: LocalAgentToolCall
  result: LocalAgentToolResult
  readOnly: boolean
}): void {
  params.history.push({
    toolName: params.call.name,
    inputKey: buildInputKey(params.call),
    resultKey: buildResultKey(params.result),
    success: params.result.success,
    readOnly: params.readOnly,
  })
}

export function reportLocalAgentToolGuardrailAssessment(params: {
  context: LocalAgentContext
  call: LocalAgentToolCall
  assessment: LocalAgentToolGuardrailAssessment
}): void {
  if (!isLocalAgentGuardrailTelemetryEnabled() || params.assessment.warnings.length === 0) return
  const warning = params.assessment.warnings.join(' ')
  logger.warn('Local canvas agent tool guardrail warning', {
    workspaceId: params.context.workspaceId,
    workflowId: params.context.workflowId,
    chatId: params.context.chatId,
    toolName: params.call.name,
    repeatCount: params.assessment.repeatCount,
    repeatedFailureCount: params.assessment.repeatedFailureCount,
    noProgressRepeatCount: params.assessment.noProgressRepeatCount,
    warning,
  })
  recordLocalAgentPerformanceMetric({
    kind: 'tool_guardrail',
    workspaceId: params.context.workspaceId,
    workflowId: params.context.workflowId,
    chatId: params.context.chatId,
    toolName: params.call.name,
    repeatCount: params.assessment.repeatCount,
    repeatedFailureCount: params.assessment.repeatedFailureCount,
    noProgressRepeatCount: params.assessment.noProgressRepeatCount,
    warning,
  })
}
