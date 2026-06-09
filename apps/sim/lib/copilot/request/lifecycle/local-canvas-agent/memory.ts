import { db } from '@sim/db'
import { memory } from '@sim/db/schema'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type {
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentObservation,
  LocalAgentToolName,
  LocalAgentToolResultRef,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const MAX_TOOL_RESULT_REFS = 24
const TOOL_RESULT_PREVIEW_CHARS = 1200

export function buildLocalAgentMemoryKey(
  context: Pick<LocalAgentContext, 'userId' | 'workspaceId' | 'workflowId' | 'chatId' | 'agent'>
): string {
  const chatId = context.chatId?.trim() || 'no-chat'
  return [
    'local-canvas-agent',
    'v2',
    'thread',
    context.userId,
    context.workspaceId,
    context.workflowId,
    context.agent.code,
    chatId,
  ].join(':')
}

export function buildLocalAgentToolResultStorageKey(params: {
  context: Pick<LocalAgentContext, 'userId' | 'workspaceId' | 'workflowId' | 'chatId' | 'agent'>
  refId: string
}): string {
  const chatId = params.context.chatId?.trim() || 'no-chat'
  return [
    'local-canvas-agent',
    'v2',
    'tool-result',
    params.context.userId,
    params.context.workspaceId,
    params.context.workflowId,
    params.context.agent.code,
    chatId,
    params.refId,
  ].join(':')
}

function buildLegacyLocalAgentMemoryKey(
  context: Pick<LocalAgentContext, 'userId' | 'workspaceId' | 'workflowId' | 'chatId' | 'agent'>
): string {
  return [
    'local-canvas-agent',
    'v1',
    'personal',
    context.userId,
    context.workspaceId,
    context.workflowId,
    context.agent.code,
    context.chatId ?? 'no-chat',
  ].join(':')
}

export function canPersistLocalAgentThreadMemory(
  context: Pick<LocalAgentContext, 'chatId'>
): boolean {
  return Boolean(context.chatId?.trim())
}

function createEmptyMemory(context: LocalAgentContext): LocalAgentMemoryData {
  return {
    version: 2,
    scope: 'thread',
    userId: context.userId,
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    agentCode: context.agent.code,
    chatId: context.chatId,
    conversationSummary: '',
    taskState: {
      completedSteps: [],
      openQuestions: [],
    },
    canvasSummary: '',
    recentObservations: [],
    toolResultRefs: [],
    updatedAt: new Date().toISOString(),
  }
}

function stringifyForPreview(value: unknown): string {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 16))}\n...[truncated]`
}

function isRuntimeToolName(
  toolName: LocalAgentObservation['toolName']
): toolName is LocalAgentToolName {
  return (
    toolName !== 'planner' &&
    toolName !== 'verifier' &&
    toolName !== 'memory' &&
    toolName !== 'decision'
  )
}

function normalizeToolResultRefs(value: unknown): LocalAgentToolResultRef[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Partial<LocalAgentToolResultRef>
      if (
        typeof record.id !== 'string' ||
        typeof record.toolName !== 'string' ||
        typeof record.summary !== 'string' ||
        typeof record.storageKey !== 'string' ||
        typeof record.createdAt !== 'string'
      ) {
        return null
      }
      return {
        id: record.id,
        toolName: record.toolName as LocalAgentToolName,
        summary: record.summary,
        storageKey: record.storageKey,
        ...(typeof record.outputPreview === 'string'
          ? { outputPreview: record.outputPreview }
          : {}),
        ...(typeof record.outputSizeChars === 'number'
          ? { outputSizeChars: record.outputSizeChars }
          : {}),
        createdAt: record.createdAt,
      } satisfies LocalAgentToolResultRef
    })
    .filter((item): item is LocalAgentToolResultRef => Boolean(item))
    .slice(-MAX_TOOL_RESULT_REFS)
}

function parseMemoryData(value: unknown, context: LocalAgentContext): LocalAgentMemoryData {
  if (!value || typeof value !== 'object') return createEmptyMemory(context)
  const data = value as Partial<LocalAgentMemoryData>
  if (
    (data.version !== 1 && data.version !== 2) ||
    (data.scope !== 'personal' && data.scope !== 'thread')
  )
    return createEmptyMemory(context)
  return {
    ...createEmptyMemory(context),
    ...data,
    version: 2,
    scope: 'thread',
    chatId: context.chatId,
    taskState: {
      completedSteps: data.taskState?.completedSteps ?? [],
      openQuestions: data.taskState?.openQuestions ?? [],
      goal: data.taskState?.goal,
      lastObservation: data.taskState?.lastObservation,
    },
    recentObservations: Array.isArray(data.recentObservations)
      ? data.recentObservations.map((observation) => ({
          toolName: observation.toolName,
          summary: observation.summary,
          success: observation.success,
          timestamp: observation.timestamp,
          ...(typeof observation.outputRef === 'string'
            ? { outputRef: observation.outputRef }
            : {}),
        }))
      : [],
    toolResultRefs: normalizeToolResultRefs(data.toolResultRefs),
  }
}

export async function loadLocalAgentMemory(
  context: LocalAgentContext
): Promise<LocalAgentMemoryData> {
  if (!canPersistLocalAgentThreadMemory(context)) return createEmptyMemory(context)
  const key = buildLocalAgentMemoryKey(context)
  const [row] = await db
    .select({ data: memory.data })
    .from(memory)
    .where(
      and(
        eq(memory.workspaceId, context.workspaceId),
        eq(memory.key, key),
        isNull(memory.deletedAt)
      )
    )
    .limit(1)
  if (row?.data) return parseMemoryData(row.data, context)

  const [legacyRow] = await db
    .select({ data: memory.data })
    .from(memory)
    .where(
      and(
        eq(memory.workspaceId, context.workspaceId),
        eq(memory.key, buildLegacyLocalAgentMemoryKey(context)),
        isNull(memory.deletedAt)
      )
    )
    .limit(1)
  return parseMemoryData(legacyRow?.data, context)
}

export async function saveLocalAgentMemory(
  context: LocalAgentContext,
  data: LocalAgentMemoryData
): Promise<void> {
  if (!canPersistLocalAgentThreadMemory(context)) return
  const key = buildLocalAgentMemoryKey(context)
  const now = new Date()
  const normalizedData = {
    ...data,
    version: 2,
    scope: 'thread',
    chatId: context.chatId,
    updatedAt: now.toISOString(),
  } satisfies LocalAgentMemoryData
  await db
    .insert(memory)
    .values({
      id: generateId(),
      workspaceId: context.workspaceId,
      key,
      data: normalizedData,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [memory.workspaceId, memory.key],
      set: {
        data: sql`${JSON.stringify(normalizedData)}::jsonb`,
        updatedAt: now,
        deletedAt: null,
      },
    })
}

export function appendLocalAgentObservations(
  memoryData: LocalAgentMemoryData,
  observations: LocalAgentObservation[]
): LocalAgentMemoryData {
  return {
    ...memoryData,
    recentObservations: [
      ...memoryData.recentObservations,
      ...observations.map((observation) => ({
        toolName: observation.toolName,
        summary: observation.summary,
        success: observation.success,
        timestamp: observation.timestamp,
        ...(observation.outputRef ? { outputRef: observation.outputRef } : {}),
      })),
    ].slice(-20),
    taskState: {
      ...memoryData.taskState,
      lastObservation: observations.at(-1)?.summary ?? memoryData.taskState.lastObservation,
    },
  }
}

export function appendLocalAgentToolResultRefs(
  memoryData: LocalAgentMemoryData,
  refs: LocalAgentToolResultRef[]
): LocalAgentMemoryData {
  if (!refs.length) return memoryData
  return {
    ...memoryData,
    toolResultRefs: [...(memoryData.toolResultRefs ?? []), ...refs].slice(-MAX_TOOL_RESULT_REFS),
  }
}

export async function persistLocalAgentToolResultRefs(params: {
  context: LocalAgentContext
  observations: LocalAgentObservation[]
}): Promise<LocalAgentToolResultRef[]> {
  if (!canPersistLocalAgentThreadMemory(params.context)) return []
  const persisted: LocalAgentToolResultRef[] = []
  for (const observation of params.observations) {
    if (!observation.success || observation.output === undefined) continue
    if (!isRuntimeToolName(observation.toolName)) continue
    const outputText = stringifyForPreview(observation.output)
    const refId = `tool_result_${generateShortId(10)}`
    const storageKey = buildLocalAgentToolResultStorageKey({
      context: params.context,
      refId,
    })
    const createdAt = new Date()
    const ref = {
      id: refId,
      toolName: observation.toolName,
      summary: observation.summary,
      storageKey,
      outputPreview: clip(outputText, TOOL_RESULT_PREVIEW_CHARS),
      outputSizeChars: outputText.length,
      createdAt: createdAt.toISOString(),
    } satisfies LocalAgentToolResultRef
    await db.insert(memory).values({
      id: generateId(),
      workspaceId: params.context.workspaceId,
      key: storageKey,
      data: {
        version: 1,
        ref,
        output: observation.output,
      },
      createdAt,
      updatedAt: createdAt,
    })
    persisted.push(ref)
  }
  return persisted
}

export async function loadLocalAgentToolResultRefOutput(params: {
  context: LocalAgentContext
  refId: string
}): Promise<unknown> {
  if (!canPersistLocalAgentThreadMemory(params.context)) return undefined
  const storageKey = buildLocalAgentToolResultStorageKey({
    context: params.context,
    refId: params.refId,
  })
  const [row] = await db
    .select({ data: memory.data })
    .from(memory)
    .where(
      and(
        eq(memory.workspaceId, params.context.workspaceId),
        eq(memory.key, storageKey),
        isNull(memory.deletedAt)
      )
    )
    .limit(1)
  const data = row?.data
  return data && typeof data === 'object' ? (data as { output?: unknown }).output : undefined
}
