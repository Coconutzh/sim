import { db } from '@sim/db'
import { memory } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type {
  LocalAgentContext,
  LocalAgentMemoryData,
  LocalAgentObservation,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export function buildLocalAgentMemoryKey(
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

function createEmptyMemory(context: LocalAgentContext): LocalAgentMemoryData {
  return {
    version: 1,
    scope: 'personal',
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
    updatedAt: new Date().toISOString(),
  }
}

function parseMemoryData(value: unknown, context: LocalAgentContext): LocalAgentMemoryData {
  if (!value || typeof value !== 'object') return createEmptyMemory(context)
  const data = value as Partial<LocalAgentMemoryData>
  if (data.version !== 1 || data.scope !== 'personal') return createEmptyMemory(context)
  return {
    ...createEmptyMemory(context),
    ...data,
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
        }))
      : [],
  }
}

export async function loadLocalAgentMemory(
  context: LocalAgentContext
): Promise<LocalAgentMemoryData> {
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
  return parseMemoryData(row?.data, context)
}

export async function saveLocalAgentMemory(
  context: LocalAgentContext,
  data: LocalAgentMemoryData
): Promise<void> {
  const key = buildLocalAgentMemoryKey(context)
  const now = new Date()
  await db
    .insert(memory)
    .values({
      id: generateId(),
      workspaceId: context.workspaceId,
      key,
      data: { ...data, updatedAt: now.toISOString() },
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [memory.workspaceId, memory.key],
      set: {
        data: sql`${JSON.stringify({ ...data, updatedAt: now.toISOString() })}::jsonb`,
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
      })),
    ].slice(-20),
    taskState: {
      ...memoryData.taskState,
      lastObservation: observations.at(-1)?.summary ?? memoryData.taskState.lastObservation,
    },
  }
}
