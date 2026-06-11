import { isLocalAgentAggregateObservationBudgetEnabled } from '@/lib/copilot/request/lifecycle/local-canvas-agent/feature-flags'
import { recordLocalAgentPerformanceMetric } from '@/lib/copilot/request/lifecycle/local-canvas-agent/observability'
import type {
  LocalAgentContext,
  LocalAgentObservation,
  LocalAgentRole,
  LocalAgentToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const DEFAULT_MAX_OUTPUT_CHARS = 2400
const DEFAULT_MAX_OBSERVATIONS = 8
const DEFAULT_MAX_PROMPT_CHARS = 9000
const PREVIEW_SUFFIX = '\n...[truncated]'
const OMITTED_OUTPUT_PREVIEW = '[output preview omitted by turn-level observation budget]'
const PROTECTED_OBSERVATION_TOOLS = new Set<LocalAgentObservation['toolName']>([
  'canvas.apply_patch',
  'canvas.verify_patch',
  'canvas.generate_node_output',
  'decision',
  'verifier',
])

interface BudgetedObservationPromptOptions {
  maxOutputChars?: number
  maxObservations?: number
  maxPromptChars?: number
  context?: LocalAgentContext
  role?: LocalAgentRole
}

export interface BudgetedObservationPromptResult {
  prompt: string
  rawOutputChars: number
  budgetedPromptChars: number
  omittedObservations: number
  truncatedOutputs: number
}

interface IndexedObservation {
  index: number
  observation: LocalAgentObservation
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

function isProtectedObservation(observation: LocalAgentObservation): boolean {
  return !observation.success || PROTECTED_OBSERVATION_TOOLS.has(observation.toolName)
}

function countRawOutputChars(observations: LocalAgentObservation[]): number {
  return observations.reduce((total, observation) => {
    return total + stringifyForPrompt(observation.output).length
  }, 0)
}

function selectObservationWindow(
  observations: LocalAgentObservation[],
  maxObservations: number
): IndexedObservation[] {
  const recentStart = Math.max(0, observations.length - maxObservations)
  const selected = new Map<number, IndexedObservation>()
  for (let index = recentStart; index < observations.length; index += 1) {
    selected.set(index, { index, observation: observations[index] })
  }

  const protectedOlder = observations
    .map((observation, index) => ({ index, observation }))
    .filter((item) => item.index < recentStart && isProtectedObservation(item.observation))
    .slice(-4)
  for (const item of protectedOlder) selected.set(item.index, item)

  return [...selected.values()].sort((left, right) => left.index - right.index)
}

export function buildLocalAgentToolResultRef(params: {
  toolName: LocalAgentObservation['toolName']
  index: number
}): string {
  return `tool_result_${params.index}_${safeToolName(params.toolName)}`
}

function compactObservationForPrompt(
  observation: LocalAgentObservation,
  index: number,
  maxOutputChars: number
): {
  text: string
  rawOutputChars: number
  truncated: boolean
} {
  const outputText = stringifyForPrompt(observation.output)
  const ref =
    observation.outputRef ?? buildLocalAgentToolResultRef({ toolName: observation.toolName, index })
  const clipped =
    maxOutputChars <= 0
      ? OMITTED_OUTPUT_PREVIEW
      : outputText.length > maxOutputChars
        ? `${outputText.slice(0, Math.max(0, maxOutputChars - PREVIEW_SUFFIX.length))}${PREVIEW_SUFFIX}`
        : outputText
  const previewChars = maxOutputChars <= 0 ? 0 : Math.min(outputText.length, maxOutputChars)
  return {
    text: [
      `#${index + 1} ${observation.success ? 'success' : 'failed'} ${observation.toolName}`,
      `summary: ${observation.summary}`,
      outputText
        ? `outputRef: ${ref}\noutputPreviewChars: ${previewChars}/${outputText.length}\noutputPreview: ${clipped}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    rawOutputChars: outputText.length,
    truncated: outputText.length > previewChars,
  }
}

export function compactLocalAgentObservationForPrompt(
  observation: LocalAgentObservation,
  index: number,
  maxOutputChars = DEFAULT_MAX_OUTPUT_CHARS
): string {
  return compactObservationForPrompt(observation, index, maxOutputChars).text
}

function renderObservationPrompt(params: {
  selected: IndexedObservation[]
  totalObservations: number
  omittedObservations: number
  maxOutputChars: (item: IndexedObservation) => number
}): BudgetedObservationPromptResult {
  const omitted =
    params.omittedObservations > 0
      ? `Omitted ${params.omittedObservations} older tool observations from this prompt.`
      : ''
  const compacted = params.selected.map((item) =>
    compactObservationForPrompt(item.observation, item.index, params.maxOutputChars(item))
  )
  const prompt = [omitted, ...compacted.map((item) => item.text)].filter(Boolean).join('\n\n')
  return {
    prompt,
    rawOutputChars: compacted.reduce((total, item) => total + item.rawOutputChars, 0),
    budgetedPromptChars: prompt.length,
    omittedObservations: params.omittedObservations,
    truncatedOutputs: compacted.filter((item) => item.truncated).length,
  }
}

function buildLegacyBudgetedObservationPromptResult(
  observations: LocalAgentObservation[],
  options: BudgetedObservationPromptOptions
): BudgetedObservationPromptResult {
  const maxObservations = Math.max(1, options.maxObservations ?? DEFAULT_MAX_OBSERVATIONS)
  const maxOutputChars = Math.max(120, options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS)
  const maxPromptChars = Math.max(1200, options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS)
  const startIndex = Math.max(0, observations.length - maxObservations)
  const selected = observations.slice(startIndex).map((observation, offset) => ({
    index: startIndex + offset,
    observation,
  }))
  const initial = renderObservationPrompt({
    selected,
    totalObservations: observations.length,
    omittedObservations: startIndex,
    maxOutputChars: () => maxOutputChars,
  })
  if (initial.prompt.length <= maxPromptChars) return initial
  const prefix = '...[older observation context truncated]\n'
  const prompt = `${prefix}${initial.prompt.slice(
    Math.max(0, initial.prompt.length - maxPromptChars + prefix.length)
  )}`
  return {
    ...initial,
    prompt,
    budgetedPromptChars: prompt.length,
  }
}

function shrinkSelectedObservations(
  selected: IndexedObservation[],
  maxPromptChars: number
): IndexedObservation[] {
  const retained = [...selected]
  while (retained.length > 1) {
    const removeIndex = retained.findIndex((item, index) => {
      return index < retained.length - 1 && !isProtectedObservation(item.observation)
    })
    if (removeIndex < 0) return retained
    retained.splice(removeIndex, 1)
    const candidate = renderObservationPrompt({
      selected: retained,
      totalObservations: retained.length,
      omittedObservations: 0,
      maxOutputChars: () => 0,
    })
    if (candidate.prompt.length <= maxPromptChars) return retained
  }
  return retained
}

export function buildBudgetedObservationPromptResult(
  observations: LocalAgentObservation[],
  options: BudgetedObservationPromptOptions = {}
): BudgetedObservationPromptResult {
  if (observations.length === 0) {
    return {
      prompt: 'No tool observations yet.',
      rawOutputChars: 0,
      budgetedPromptChars: 'No tool observations yet.'.length,
      omittedObservations: 0,
      truncatedOutputs: 0,
    }
  }
  if (!isLocalAgentAggregateObservationBudgetEnabled()) {
    return buildLegacyBudgetedObservationPromptResult(observations, options)
  }

  const maxObservations = Math.max(1, options.maxObservations ?? DEFAULT_MAX_OBSERVATIONS)
  const maxOutputChars = Math.max(120, options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS)
  const maxPromptChars = Math.max(1200, options.maxPromptChars ?? DEFAULT_MAX_PROMPT_CHARS)
  const selected = selectObservationWindow(observations, maxObservations)
  const omittedObservations = observations.length - selected.length

  const attempts = [
    renderObservationPrompt({
      selected,
      totalObservations: observations.length,
      omittedObservations,
      maxOutputChars: () => maxOutputChars,
    }),
    renderObservationPrompt({
      selected,
      totalObservations: observations.length,
      omittedObservations,
      maxOutputChars: (item) =>
        isProtectedObservation(item.observation) ? Math.min(maxOutputChars, 640) : 180,
    }),
    renderObservationPrompt({
      selected,
      totalObservations: observations.length,
      omittedObservations,
      maxOutputChars: (item) =>
        isProtectedObservation(item.observation) ? Math.min(maxOutputChars, 260) : 0,
    }),
  ]
  const fittingAttempt = attempts.find((attempt) => attempt.prompt.length <= maxPromptChars)
  const shrunkenSelected = fittingAttempt
    ? selected
    : shrinkSelectedObservations(selected, maxPromptChars)
  const result =
    fittingAttempt ??
    renderObservationPrompt({
      selected: shrunkenSelected,
      totalObservations: observations.length,
      omittedObservations: observations.length - shrunkenSelected.length,
      maxOutputChars: () => 0,
    })

  const metric = {
    ...result,
    rawOutputChars: countRawOutputChars(observations),
  }
  if (options.context) {
    recordLocalAgentPerformanceMetric({
      kind: 'observation_budget',
      workspaceId: options.context.workspaceId,
      workflowId: options.context.workflowId,
      chatId: options.context.chatId,
      role: options.role,
      rawChars: metric.rawOutputChars,
      budgetedChars: metric.budgetedPromptChars,
      omittedCount: metric.omittedObservations,
      truncatedCount: metric.truncatedOutputs,
    })
  }
  return metric
}

export function buildBudgetedObservationPrompt(observations: LocalAgentObservation[]): string {
  return buildBudgetedObservationPromptResult(observations).prompt
}

export function buildBudgetedObservationPromptWithOptions(
  observations: LocalAgentObservation[],
  options: BudgetedObservationPromptOptions = {}
): string {
  return buildBudgetedObservationPromptResult(observations, options).prompt
}

export function summarizeAvailableToolNames(toolNames: LocalAgentToolName[]): string {
  return toolNames.length ? toolNames.join(', ') : 'none'
}
