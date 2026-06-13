import { generateId } from '@sim/utils/id'
import { observationFromToolResult } from '@/lib/copilot/request/lifecycle/local-canvas-agent/observation'
import { executeLocalAgentTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge'
import type {
  LocalAgentContext,
  LocalAgentObservation,
  LocalAgentPlan,
  LocalAgentToolCall,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export const LOCAL_CANVAS_CONFIRM_PREFIX = '__local_canvas_confirm__:'
export const LOCAL_CANVAS_REVISE_PREFIX = '__local_canvas_revise__:'

const PENDING_PLAN_TTL_MS = 30 * 60 * 1000

export interface LocalAgentPendingPlan {
  id: string
  userId: string
  workspaceId: string
  workflowId: string
  chatId?: string
  plan: LocalAgentPlan
  source: 'sim_ui' | 'hermes'
  createdAt: number
}

export type LocalAgentPendingPlanLookup =
  | { status: 'found'; pending: LocalAgentPendingPlan }
  | { status: 'expired' }
  | { status: 'not_found' }

export type LocalAgentPendingPlanConsumeResult =
  | { status: 'found'; pending: LocalAgentPendingPlan }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'id_mismatch' }

const pendingPlans = new Map<string, LocalAgentPendingPlan>()

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function getPendingKey(
  context: Pick<LocalAgentContext, 'userId' | 'workspaceId' | 'workflowId' | 'chatId'>
): string {
  return [
    context.userId,
    context.workspaceId,
    context.workflowId,
    context.chatId ?? 'no-chat',
  ].join(':')
}

function isPendingPlanExpired(
  pending: Pick<LocalAgentPendingPlan, 'createdAt'>,
  now = Date.now()
): boolean {
  return now - pending.createdAt > PENDING_PLAN_TTL_MS
}

function deleteExpiredPendingPlans(now = Date.now()): void {
  for (const [key, pending] of pendingPlans) {
    if (isPendingPlanExpired(pending, now)) pendingPlans.delete(key)
  }
}

export function parseLocalAgentPendingPlanCommand(
  message: string
): { action: 'confirm' | 'revise'; id: string } | null {
  if (message.startsWith(LOCAL_CANVAS_CONFIRM_PREFIX)) {
    return { action: 'confirm', id: message.slice(LOCAL_CANVAS_CONFIRM_PREFIX.length) }
  }
  if (message.startsWith(LOCAL_CANVAS_REVISE_PREFIX)) {
    return { action: 'revise', id: message.slice(LOCAL_CANVAS_REVISE_PREFIX.length) }
  }
  return null
}

export function isSimpleLocalAgentPendingPlanConfirm(message: string): boolean {
  return /^(确认|继续|执行|开始执行|可以执行|yes|confirm|go ahead|run it)$/i.test(message.trim())
}

export function putLocalAgentPendingPlan(params: {
  context: LocalAgentContext
  plan: LocalAgentPlan
  source: LocalAgentPendingPlan['source']
}): LocalAgentPendingPlan {
  deleteExpiredPendingPlans()
  const pending: LocalAgentPendingPlan = {
    id: generateId(),
    userId: params.context.userId,
    workspaceId: params.context.workspaceId,
    workflowId: params.context.workflowId,
    chatId: params.context.chatId,
    plan: params.plan,
    source: params.source,
    createdAt: Date.now(),
  }
  pendingPlans.set(getPendingKey(params.context), pending)
  return pending
}

export function getLocalAgentPendingPlan(context: LocalAgentContext): LocalAgentPendingPlan | null {
  const result = peekLocalAgentPendingPlan(context)
  return result.status === 'found' ? result.pending : null
}

export function peekLocalAgentPendingPlan(context: LocalAgentContext): LocalAgentPendingPlanLookup {
  const pendingKey = getPendingKey(context)
  const pending = pendingPlans.get(pendingKey)
  if (!pending) {
    deleteExpiredPendingPlans()
    return { status: 'not_found' }
  }
  if (isPendingPlanExpired(pending)) {
    pendingPlans.delete(pendingKey)
    return { status: 'expired' }
  }
  deleteExpiredPendingPlans()
  return { status: 'found', pending }
}

export function deleteLocalAgentPendingPlan(context: LocalAgentContext): void {
  pendingPlans.delete(getPendingKey(context))
}

export function consumeLocalAgentPendingPlan(params: {
  context: LocalAgentContext
  pendingActionId: string
}): LocalAgentPendingPlanConsumeResult {
  const pendingKey = getPendingKey(params.context)
  const pending = pendingPlans.get(pendingKey)
  if (!pending) {
    deleteExpiredPendingPlans()
    return { status: 'not_found' }
  }
  if (isPendingPlanExpired(pending)) {
    pendingPlans.delete(pendingKey)
    return { status: 'expired' }
  }
  deleteExpiredPendingPlans()
  if (pending.id !== params.pendingActionId) {
    pendingPlans.delete(pendingKey)
    return { status: 'id_mismatch' }
  }
  pendingPlans.delete(pendingKey)
  return { status: 'found', pending }
}

function throwIfAborted(context: LocalAgentContext): void {
  if (context.options?.abortSignal?.aborted) {
    context.streamContext.wasAborted = true
    throw new Error('Request was cancelled')
  }
}

function buildGenerationVerifyInput(output: unknown): Record<string, unknown> {
  const record = asRecord(output)
  const nodeId = typeof record.nodeId === 'string' ? record.nodeId : ''
  const field = typeof record.verifiedField === 'string' ? record.verifiedField : ''
  return nodeId && field ? { generation: { nodeId, field } } : {}
}

function readCreatedNodeMapFromObservations(
  observations: LocalAgentObservation[]
): Record<string, string> {
  const createdNodeMap: Record<string, string> = {}
  for (const observation of observations) {
    const output = asRecord(observation.output)
    const direct = asRecord(output.createdNodeMap)
    const machine = asRecord(output.machineSummary)
    const nested = asRecord(machine.createdNodeMap)
    for (const [key, value] of Object.entries({ ...direct, ...nested })) {
      if (typeof value === 'string' && value.trim()) createdNodeMap[key] = value
    }
  }
  return createdNodeMap
}

function readCreatedOperationNodeMapFromObservations(
  observations: LocalAgentObservation[]
): Record<string, string> {
  const operationNodeMap: Record<string, string> = {}
  for (const observation of observations) {
    const output = asRecord(observation.output)
    const patch = asRecord(output.patch)
    const operations = Array.isArray(patch.operations) ? patch.operations : []
    const verification = asRecord(output.verification)
    const operationResults = Array.isArray(verification.operationResults)
      ? verification.operationResults.map(asRecord)
      : []
    operations.forEach((operationValue, index) => {
      const operation = asRecord(operationValue)
      const operationId =
        typeof operation.operationId === 'string'
          ? operation.operationId
          : `${typeof operation.type === 'string' ? operation.type : 'operation'}:${index + 1}`
      const result = operationResults.find(
        (item) => typeof item.operationId === 'string' && item.operationId === operationId
      )
      const nodeId = typeof result?.nodeId === 'string' ? result.nodeId : undefined
      if (nodeId) operationNodeMap[operationId] = nodeId
    })
  }
  return operationNodeMap
}

function resolveGenerationNodeIds(
  plan: LocalAgentPlan,
  observations: LocalAgentObservation[]
): string[] {
  const createdNodeMap = readCreatedNodeMapFromObservations(observations)
  const operationNodeMap = readCreatedOperationNodeMapFromObservations(observations)
  const ids = [...(plan.generateNodeIds ?? [])]
  for (const target of plan.generationTargets ?? []) {
    if (target.nodeId) {
      ids.push(target.nodeId)
      continue
    }
    if (target.clientNodeId && createdNodeMap[target.clientNodeId]) {
      ids.push(createdNodeMap[target.clientNodeId])
      continue
    }
    if (target.afterOperationId && operationNodeMap[target.afterOperationId]) {
      ids.push(operationNodeMap[target.afterOperationId])
    }
  }
  return ids.filter((nodeId, index, items) => nodeId && items.indexOf(nodeId) === index)
}

export async function executeConfirmedLocalAgentPlan(
  context: LocalAgentContext,
  plan: LocalAgentPlan
): Promise<LocalAgentObservation[]> {
  const observations: LocalAgentObservation[] = []
  if (plan.patch) {
    throwIfAborted(context)
    const result = await executeLocalAgentTool(context, {
      name: 'canvas.apply_patch',
      input: { patch: plan.patch },
    } satisfies LocalAgentToolCall)
    observations.push(observationFromToolResult(result))
    if (!result.success) return observations

    throwIfAborted(context)
    const verifyResult = await executeLocalAgentTool(context, {
      name: 'canvas.verify_patch',
      input: { patch: plan.patch },
    })
    observations.push(observationFromToolResult(verifyResult))
    if (!verifyResult.success) return observations
  }

  for (const nodeId of resolveGenerationNodeIds(plan, observations)) {
    throwIfAborted(context)
    const result = await executeLocalAgentTool(context, {
      name: 'canvas.generate_node_output',
      input: { nodeId },
    })
    observations.push(observationFromToolResult(result))
    if (!result.success) return observations

    throwIfAborted(context)
    const verifyResult = await executeLocalAgentTool(context, {
      name: 'canvas.verify_patch',
      input: buildGenerationVerifyInput(result.output),
    })
    observations.push(observationFromToolResult(verifyResult))
    if (!verifyResult.success) return observations
  }

  return observations
}
