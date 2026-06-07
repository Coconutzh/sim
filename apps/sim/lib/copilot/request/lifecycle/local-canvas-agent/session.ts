import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'
import type { LocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const logger = createLogger('LocalCanvasAgentSession')
const LOCAL_AGENT_VERSION = 'v1'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export async function persistLocalAgentSessionMetadata(context: LocalAgentContext): Promise<void> {
  if (!context.chatId) return
  try {
    const [row] = await db
      .select({ config: copilotChats.config })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, context.chatId),
          eq(copilotChats.userId, context.userId),
          eq(copilotChats.workspaceId, context.workspaceId),
          eq(copilotChats.workflowId, context.workflowId)
        )
      )
      .limit(1)

    if (!row) return

    await db
      .update(copilotChats)
      .set({
        config: {
          ...asRecord(row.config),
          localCanvasAgent: {
            scope: context.sessionScope,
            agentCode: context.agent.code,
            organizationId: context.workgroup.organizationId,
            workgroupId: context.workgroup.id || undefined,
            disciplineId: context.discipline.id || undefined,
            localAgentVersion: LOCAL_AGENT_VERSION,
          },
        },
      })
      .where(
        and(
          eq(copilotChats.id, context.chatId),
          eq(copilotChats.userId, context.userId),
          eq(copilotChats.workspaceId, context.workspaceId),
          eq(copilotChats.workflowId, context.workflowId)
        )
      )
  } catch (error) {
    logger.warn('Failed to persist local canvas agent session metadata', {
      chatId: context.chatId,
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      error: toError(error).message,
    })
  }
}
