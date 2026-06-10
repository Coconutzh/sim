import type { z } from 'zod'
import type {
  LocalAgentToolName,
  LocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const LOCAL_AGENT_TOOL_NAMES = [
  'canvas.read_summary',
  'canvas.read_node',
  'canvas.read_selected_nodes',
  'canvas.search_nodes',
  'canvas.inspect_schema',
  'canvas.propose_patch',
  'canvas.apply_patch',
  'canvas.verify_patch',
  'canvas.generate_node_output',
  'media.analyze_node_media',
  'read_file',
  'search_workspace',
  'materialize_file',
  'query_knowledge',
  'search_docs',
  'read_tasks',
  'update_task_result',
  'submit_task_result',
] as const satisfies readonly LocalAgentToolName[]

const TOOL_NAME_ALIASES = new Map<string, LocalAgentToolName>([
  ['analyze_node_media', 'media.analyze_node_media'],
  ['apply_patch', 'canvas.apply_patch'],
  ['generate_node_output', 'canvas.generate_node_output'],
  ['inspect_schema', 'canvas.inspect_schema'],
  ['propose_patch', 'canvas.propose_patch'],
  ['read_node', 'canvas.read_node'],
  ['read_selected_nodes', 'canvas.read_selected_nodes'],
  ['read_summary', 'canvas.read_summary'],
  ['search_nodes', 'canvas.search_nodes'],
  ['verify_patch', 'canvas.verify_patch'],
])

export type LocalAgentToolInputRepairStatus = 'unchanged' | 'repaired' | 'unrepairable'

export interface LocalAgentToolInputRepairResult {
  status: LocalAgentToolInputRepairStatus
  input: unknown
  reason?: string
}

export type LocalAgentToolInputParseResult<Input extends Record<string, unknown>> =
  | {
      success: true
      data: Input
      repaired: boolean
      repairReason?: string
    }
  | {
      success: false
      error: string
      repaired: false
      repairReason?: string
      result: LocalAgentToolResult
    }

export interface LooseJsonObjectParseResult {
  success: boolean
  value?: unknown
  reason?: 'empty' | 'invalid' | 'truncated'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeAliasKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function findBalancedJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (depth === 0) return text.slice(start, index + 1)
  }
  return null
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}

function removeTrailingJsonCommas(value: string): string {
  return value.replace(/,\s*([}\]])/g, '$1')
}

function looksLikeTruncatedJson(value: string): boolean {
  const trimmed = stripJsonFence(value)
  if (!trimmed.startsWith('{')) return false
  return findBalancedJsonObject(trimmed) === null
}

export function parseLooseJsonObject(value: string): LooseJsonObjectParseResult {
  const trimmed = stripJsonFence(value)
  if (!trimmed) return { success: false, reason: 'empty' }
  try {
    return { success: true, value: JSON.parse(trimmed) }
  } catch {
    const balanced = findBalancedJsonObject(trimmed)
    if (!balanced) {
      return { success: false, reason: looksLikeTruncatedJson(trimmed) ? 'truncated' : 'invalid' }
    }
    try {
      return { success: true, value: JSON.parse(balanced) }
    } catch {
      try {
        return { success: true, value: JSON.parse(removeTrailingJsonCommas(balanced)) }
      } catch {
        return { success: false, reason: 'invalid' }
      }
    }
  }
}

export function normalizeLocalAgentToolName(value: unknown): LocalAgentToolName | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if ((LOCAL_AGENT_TOOL_NAMES as readonly string[]).includes(trimmed)) {
    return trimmed as LocalAgentToolName
  }
  const aliasKey = normalizeAliasKey(trimmed)
  const explicitAlias = TOOL_NAME_ALIASES.get(aliasKey)
  if (explicitAlias) return explicitAlias
  const suffixMatches = LOCAL_AGENT_TOOL_NAMES.filter(
    (toolName) => normalizeAliasKey(toolName.split('.').at(-1) ?? toolName) === aliasKey
  )
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined
}

function repairJsonStringInput(value: string): LocalAgentToolInputRepairResult {
  if (!value.trim()) return { status: 'repaired', input: {}, reason: 'empty_string_input' }
  const parsed = parseLooseJsonObject(value)
  if (!parsed.success) {
    return {
      status: parsed.reason === 'truncated' ? 'unrepairable' : 'unchanged',
      input: value,
      reason: parsed.reason,
    }
  }
  const record = asRecord(parsed.value)
  if (!record) return { status: 'unchanged', input: value, reason: 'json_not_object' }
  return { status: 'repaired', input: record, reason: 'json_string_input' }
}

function maybeParseJsonObjectString(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return value
  const parsed = parseLooseJsonObject(value)
  if (!parsed.success) return value
  return asRecord(parsed.value) ?? value
}

function repairPatchLikeInput(input: Record<string, unknown>): LocalAgentToolInputRepairResult {
  const patch = maybeParseJsonObjectString(input.patch)
  const patchRecord = asRecord(patch)
  if (!patchRecord) {
    return patch === input.patch
      ? { status: 'unchanged', input }
      : { status: 'repaired', input: { ...input, patch }, reason: 'json_string_patch' }
  }

  const operations = patchRecord.operations
  if (!Array.isArray(operations)) {
    return patch === input.patch
      ? { status: 'unchanged', input }
      : {
          status: 'repaired',
          input: { ...input, patch: patchRecord },
          reason: 'json_string_patch',
        }
  }

  let repairedOperation = false
  const repairedOperations = operations.map((operation) => {
    const repaired = maybeParseJsonObjectString(operation)
    if (repaired !== operation) repairedOperation = true
    return repaired
  })
  if (patch === input.patch && !repairedOperation) return { status: 'unchanged', input }
  return {
    status: 'repaired',
    input: {
      ...input,
      patch: {
        ...patchRecord,
        operations: repairedOperations,
      },
    },
    reason: repairedOperation ? 'json_string_patch_operation' : 'json_string_patch',
  }
}

export function repairLocalAgentToolInput(params: {
  toolName: LocalAgentToolName
  input: unknown
}): LocalAgentToolInputRepairResult {
  if (typeof params.input === 'string') return repairJsonStringInput(params.input)
  const record = asRecord(params.input)
  if (!record) return { status: 'unchanged', input: params.input }
  if (
    params.toolName === 'canvas.apply_patch' ||
    params.toolName === 'canvas.propose_patch' ||
    params.toolName === 'canvas.verify_patch'
  ) {
    return repairPatchLikeInput(record)
  }
  return { status: 'unchanged', input: params.input }
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join('; ')
}

export function parseLocalAgentToolInputWithRepair<Input extends Record<string, unknown>>(params: {
  toolName: LocalAgentToolName
  input: unknown
  inputSchema: z.ZodType<Input>
}): LocalAgentToolInputParseResult<Input> {
  const parsedInput = params.inputSchema.safeParse(params.input)
  if (parsedInput.success) {
    return { success: true, data: parsedInput.data, repaired: false }
  }

  const repair = repairLocalAgentToolInput({
    toolName: params.toolName,
    input: params.input,
  })
  if (repair.status !== 'repaired') {
    const error = formatZodIssues(parsedInput.error)
    return {
      success: false,
      error,
      repaired: false,
      repairReason: repair.reason,
      result: {
        name: params.toolName,
        success: false,
        error,
        summary: `Tool ${params.toolName} input was invalid: ${error}`,
      },
    }
  }

  const repairedInput = params.inputSchema.safeParse(repair.input)
  if (!repairedInput.success) {
    const error = formatZodIssues(parsedInput.error)
    return {
      success: false,
      error,
      repaired: false,
      repairReason: repair.reason,
      result: {
        name: params.toolName,
        success: false,
        error,
        summary: `Tool ${params.toolName} input was invalid: ${error}`,
      },
    }
  }

  return {
    success: true,
    data: repairedInput.data,
    repaired: true,
    repairReason: repair.reason,
  }
}
