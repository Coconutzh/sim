import type {
  LocalAgentObservation,
  LocalAgentToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const DEFAULT_MAX_OUTPUT_CHARS = 2400
const DEFAULT_MAX_OBSERVATIONS = 8
const DEFAULT_MAX_PROMPT_CHARS = 9000
const PREVIEW_SUFFIX = '\n...[truncated]'

interface BudgetedObservationPromptOptions {
  maxOutputChars?: number
  maxObservations?: number
  maxPromptChars?: number
}

function stringifyForPrompt(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function safeToolName(toolName: LocalAgentObservation['toolName']): string {
  return toolName.replace(/[^a-zA-Z0-9_-]+/g, '_')
}

export function buildLocalAgentToolResultRef(params: {
  toolName: LocalAgentObservation['toolName']
  index: number
}): string {
  return `tool_result_${params.index}_${safeToolName(params.toolName)}`
}

export function compactLocalAgentObservationForPrompt(
  observation: LocalAgentObservation,
  index: number,
  maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS
): string {
  const outputText = stringifyForPrompt(observation.output)
  const ref = buildLocalAgentToolResultRef({ toolName: observation.toolName, index })
  const clipped =
    outputText.length > maxOutputChars
      ? `${outputText.slice(0, Math.max(0, maxOutputChars - PREVIEW_SUFFIX.length))}${PREVIEW_SUFFIX}`
      : outputText
  return [
    `#${index + 1} ${observation.success ? 'success' : 'failed'} ${observation.toolName}`,
    `summary: ${observation.summary}`,
    outputText
      ? `outputRef: ${ref}\noutputPreviewChars: ${Math.min(outputText.length, maxOutputChars)}/${outputText.length}\noutputPreview: ${clipped}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildBudgetedObservationPrompt(observations: LocalAgentObservation[]): string {
  if (observations.length === 0) return 'No tool observations yet.'
  return buildBudgetedObservationPromptWithOptions(observations)
}

export function buildBudgetedObservationPromptWithOptions(
  observations: LocalAgentObservation[],
  options: BudgetedObservationPromptOptions = {}
): string {
  if (observations.length === 0) return 'No tool observations yet.'
  const maxObservations = Math.max(1, options.maxObservations ?? DEFAULT_MAX_OBSERVATIONS)
  const maxOutputChars = Math.max(120, options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS)
  const maxPromptChars = Math.max(1200, options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS)
  const startIndex = Math.max(0, observations.length - maxObservations)
  const omitted =
    startIndex > 0 ? `Omitted ${startIndex} older tool observations from this prompt.` : ''
  const prompt = [
    omitted,
    ...observations
      .slice(startIndex)
      .map((observation, offset) =>
        compactLocalAgentObservationForPrompt(observation, startIndex + offset, maxOutputChars)
      ),
  ]
    .filter(Boolean)
    .join('\n\n')
  if (prompt.length <= maxPromptChars) return prompt
  const prefix = '...[older observation context truncated]\n'
  return `${prefix}${prompt.slice(Math.max(0, prompt.length - maxPromptChars + prefix.length))}`
}

export function summarizeAvailableToolNames(toolNames: LocalAgentToolName[]): string {
  return toolNames.length ? toolNames.join(', ') : 'none'
}
