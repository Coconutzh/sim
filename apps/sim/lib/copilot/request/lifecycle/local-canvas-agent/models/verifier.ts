import {
  buildDeterministicLocalAgentAnswer,
  hasInternalFieldLeak,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/actor'
import { executeLocalAgentModelRequest } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
import { buildLocalAgentRoleSystemPrompt } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts'
import type {
  LocalAgentContext,
  LocalAgentObservation,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function buildVerifierFallback(params: {
  context: LocalAgentContext
  observations: LocalAgentObservation[]
}): string {
  return buildDeterministicLocalAgentAnswer({
    context: params.context,
    observations: params.observations,
  })
}

function buildVerifierPrompt(params: {
  context: LocalAgentContext
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
  answer: string
}): string {
  return [
    `User request:\n${params.context.message}`,
    `Plan goal:\n${params.plan.goal}`,
    `Success criteria:\n${params.plan.successCriteria.join('\n')}`,
    `Tool observations:\n${params.observations
      .map(
        (observation) =>
          `- ${observation.toolName}: success=${observation.success}; ${observation.summary}`
      )
      .join('\n')}`,
    `Candidate answer:\n${params.answer}`,
    [
      'You are the Verifier in a local canvas agent runtime.',
      'Return PASS if the answer is safe, user-facing, and consistent with the observations.',
      'Return REPLACE: followed by a concise Chinese replacement if it exposes internals, overclaims, or misses a failed tool.',
    ].join('\n'),
  ].join('\n\n')
}

function isDeterministicReadOnlyPlan(plan: LocalAgentPlan): boolean {
  return (
    !plan.patch &&
    !(plan.generateNodeIds?.length ?? 0) &&
    plan.steps.every((step) =>
      step.toolHints.every(
        (toolName) =>
          toolName === 'canvas.read_summary' ||
          toolName === 'canvas.read_node' ||
          toolName === 'canvas.read_selected_nodes' ||
          toolName === 'canvas.search_nodes' ||
          toolName === 'canvas.inspect_schema' ||
          toolName === 'read_file' ||
          toolName === 'search_workspace' ||
          toolName === 'query_knowledge' ||
          toolName === 'search_docs' ||
          toolName === 'read_tasks'
      )
    )
  )
}

function isReadOnlyContextTool(toolName: LocalAgentObservation['toolName']): boolean {
  return (
    toolName === 'read_file' ||
    toolName === 'search_workspace' ||
    toolName === 'query_knowledge' ||
    toolName === 'search_docs' ||
    toolName === 'read_tasks'
  )
}

function hasSuccessfulCanvasRead(observations: LocalAgentObservation[]): boolean {
  return observations.some(
    (observation) =>
      observation.success &&
      (observation.toolName === 'canvas.read_summary' ||
        observation.toolName === 'canvas.read_node' ||
        observation.toolName === 'canvas.read_selected_nodes' ||
        observation.toolName === 'canvas.search_nodes' ||
        observation.toolName === 'canvas.inspect_schema')
  )
}

function hasSuccessfulVerifiedCanvasMutation(observations: LocalAgentObservation[]): boolean {
  const hasMutation = observations.some(
    (observation) =>
      observation.success &&
      (observation.toolName === 'canvas.apply_patch' ||
        observation.toolName === 'canvas.generate_node_output')
  )
  const hasVerification = observations.some(
    (observation) => observation.success && observation.toolName === 'canvas.verify_patch'
  )
  return hasMutation && hasVerification
}

function getSupersededFailureCutoff(observations: LocalAgentObservation[]): number {
  let lastSuccessfulMutationIndex = -1
  let lastSuccessfulVerificationAfterMutationIndex = -1
  observations.forEach((observation, index) => {
    if (
      observation.success &&
      (observation.toolName === 'canvas.apply_patch' ||
        observation.toolName === 'canvas.generate_node_output')
    ) {
      lastSuccessfulMutationIndex = index
    }
    if (
      observation.success &&
      observation.toolName === 'canvas.verify_patch' &&
      lastSuccessfulMutationIndex !== -1
    ) {
      lastSuccessfulVerificationAfterMutationIndex = index
    }
  })
  return lastSuccessfulVerificationAfterMutationIndex
}

function hasLaterSuccessfulObservation(params: {
  observations: LocalAgentObservation[]
  index: number
  toolName: LocalAgentObservation['toolName']
  beforeOrAtIndex: number
}): boolean {
  return params.observations.some(
    (observation, index) =>
      index > params.index &&
      index <= params.beforeOrAtIndex &&
      observation.success &&
      observation.toolName === params.toolName
  )
}

function canSupersedeFailure(params: {
  observations: LocalAgentObservation[]
  observation: LocalAgentObservation
  index: number
  cutoff: number
}): boolean {
  if (params.observation.toolName === 'decision') return true
  if (
    params.observation.toolName === 'canvas.apply_patch' ||
    params.observation.toolName === 'canvas.verify_patch' ||
    params.observation.toolName === 'canvas.generate_node_output'
  ) {
    return hasLaterSuccessfulObservation({
      observations: params.observations,
      index: params.index,
      toolName: params.observation.toolName,
      beforeOrAtIndex: params.cutoff,
    })
  }
  return false
}

function getBlockingFailures(observations: LocalAgentObservation[]): LocalAgentObservation[] {
  const cutoff = getSupersededFailureCutoff(observations)
  return observations.filter((observation, index) => {
    if (observation.success) return false
    return !(
      cutoff !== -1 &&
      index < cutoff &&
      canSupersedeFailure({ observations, observation, index, cutoff })
    )
  })
}

function isReportedGenerationFailure(params: {
  answer: string
  failures: LocalAgentObservation[]
}): boolean {
  return params.failures.every((failure) => {
    const summary = failure.summary.trim()
    return (
      (summary.length > 0 && params.answer.includes(summary)) ||
      /(?:失败|未完成|部分|failed|failure|error|partial)/i.test(params.answer)
    )
  })
}

export async function verifyLocalAgentFinalAnswer(params: {
  context: LocalAgentContext
  plan: LocalAgentPlan
  observations: LocalAgentObservation[]
  answer: string
}): Promise<string> {
  const answer = params.answer.trim()
  const failed = getBlockingFailures(params.observations)
  if (failed.length) {
    const onlyDecisionFailures = failed.every((observation) => observation.toolName === 'decision')
    if (
      onlyDecisionFailures &&
      hasSuccessfulVerifiedCanvasMutation(params.observations) &&
      answer &&
      !hasInternalFieldLeak(answer)
    ) {
      return answer
    }
    const onlyGenerationFailures = failed.every(
      (observation) => observation.toolName === 'canvas.generate_node_output'
    )
    if (
      onlyGenerationFailures &&
      hasSuccessfulVerifiedCanvasMutation(params.observations) &&
      answer &&
      !hasInternalFieldLeak(answer) &&
      isReportedGenerationFailure({ answer, failures: failed })
    ) {
      return answer
    }
    const onlyOptionalReadFailures = failed.every((observation) =>
      isReadOnlyContextTool(observation.toolName)
    )
    if (
      onlyOptionalReadFailures &&
      isDeterministicReadOnlyPlan(params.plan) &&
      hasSuccessfulCanvasRead(params.observations) &&
      answer &&
      !hasInternalFieldLeak(answer)
    ) {
      return answer
    }
    return `我已停止在安全边界内执行：${failed[0]?.summary ?? '工具执行失败'}`
  }

  if (!answer || hasInternalFieldLeak(answer)) {
    return buildVerifierFallback(params)
  }

  if (isDeterministicReadOnlyPlan(params.plan)) {
    return answer
  }

  try {
    const response = await executeLocalAgentModelRequest(params.context.model, {
      role: 'verifier',
      workspaceId: params.context.workspaceId,
      systemPrompt: buildLocalAgentRoleSystemPrompt({
        context: params.context,
        role: 'verifier',
        roleInstruction:
          'You are the Verifier in a local canvas agent runtime. Verify the candidate answer only against tool observations and the user request.',
      }),
      prompt: buildVerifierPrompt(params),
      temperature: 0,
      maxTokens: 1200,
      abortSignal: params.context.options.abortSignal,
    })
    const verdict = response.content?.trim() ?? ''
    if (/^PASS\b/i.test(verdict)) return answer
    const replacement = verdict.match(/^REPLACE:\s*([\s\S]+)/i)?.[1]?.trim()
    if (replacement && !hasInternalFieldLeak(replacement)) return replacement
  } catch {
    return answer
  }

  return answer
}
