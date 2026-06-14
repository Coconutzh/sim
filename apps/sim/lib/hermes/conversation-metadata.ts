import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { and, eq } from 'drizzle-orm'

const logger = createLogger('HermesConversationMetadata')
const HERMES_METADATA_VERSION = 'v1'
const MAX_HERMES_CONVERSATION_KEY_LENGTH = 240

export interface HermesConversationScope {
  organizationId?: string
  userId: string
  workspaceId?: string
  workflowId?: string
  chatId?: string
}

export interface HermesConversationMetadataScope extends HermesConversationScope {
  organizationId: string
  workspaceId: string
  workflowId: string
  chatId: string
}

export interface HermesConversationMetadata {
  generation: number
  conversation: string
  latestResponseId?: string
  latestSessionId?: string
  latestSessionKey?: string
}

export interface PersistHermesConversationMetadataParams {
  scope: HermesConversationMetadataScope
  metadata: HermesConversationMetadata
  responseId?: string
  sessionId?: string
  sessionKey?: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function readGeneration(config: unknown): number {
  const hermes = asRecord(asRecord(config).hermes)
  const generation = hermes.generation
  return typeof generation === 'number' && Number.isInteger(generation) && generation >= 0
    ? generation
    : 0
}

function sanitizeConversationPart(value: string): string {
  return value.replace(/[^\w:.-]/g, '_')
}

function shortenConversationKey(key: string): string {
  if (key.length <= MAX_HERMES_CONVERSATION_KEY_LENGTH) return key
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 24)
  const prefix = key.slice(0, MAX_HERMES_CONVERSATION_KEY_LENGTH - hash.length - 7)
  return `${prefix}:hash:${hash}`
}

export function buildHermesConversationKey(
  scope: HermesConversationMetadataScope,
  generation: number
): string {
  const raw = [
    'sim',
    `org:${scope.organizationId}`,
    `user:${scope.userId}`,
    `workspace:${scope.workspaceId}`,
    `workflow:${scope.workflowId}`,
    `chat:${scope.chatId}`,
    `gen:${generation}`,
  ]
    .map(sanitizeConversationPart)
    .join(':')
  return shortenConversationKey(raw)
}

export function getHermesConversationMetadataScope(
  scope: HermesConversationScope
): HermesConversationMetadataScope | null {
  if (!scope.organizationId || !scope.workspaceId || !scope.workflowId || !scope.chatId) return null
  return {
    organizationId: scope.organizationId,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    workflowId: scope.workflowId,
    chatId: scope.chatId,
  }
}

export async function loadHermesConversationMetadata(
  scope: HermesConversationMetadataScope
): Promise<HermesConversationMetadata> {
  try {
    const [row] = await db
      .select({ config: copilotChats.config })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, scope.chatId),
          eq(copilotChats.userId, scope.userId),
          eq(copilotChats.workspaceId, scope.workspaceId),
          eq(copilotChats.workflowId, scope.workflowId)
        )
      )
      .limit(1)
    const generation = row ? readGeneration(row.config) : 0
    const conversation = buildHermesConversationKey(scope, generation)
    const hermes = asRecord(asRecord(row?.config).hermes)
    return {
      generation,
      conversation,
      latestResponseId:
        typeof hermes.latestResponseId === 'string' ? hermes.latestResponseId : undefined,
      latestSessionId:
        typeof hermes.latestSessionId === 'string' ? hermes.latestSessionId : undefined,
      latestSessionKey:
        typeof hermes.latestSessionKey === 'string' ? hermes.latestSessionKey : undefined,
    }
  } catch (error) {
    logger.warn('Failed to load Hermes conversation metadata', {
      chatId: scope.chatId,
      workspaceId: scope.workspaceId,
      workflowId: scope.workflowId,
      error: toError(error).message,
    })
    return {
      generation: 0,
      conversation: buildHermesConversationKey(scope, 0),
    }
  }
}

export async function persistHermesConversationMetadata(
  params: PersistHermesConversationMetadataParams
): Promise<void> {
  try {
    const [row] = await db
      .select({ config: copilotChats.config })
      .from(copilotChats)
      .where(
        and(
          eq(copilotChats.id, params.scope.chatId),
          eq(copilotChats.userId, params.scope.userId),
          eq(copilotChats.workspaceId, params.scope.workspaceId),
          eq(copilotChats.workflowId, params.scope.workflowId)
        )
      )
      .limit(1)
    if (!row) return

    await db
      .update(copilotChats)
      .set({
        config: {
          ...asRecord(row.config),
          hermes: {
            ...asRecord(asRecord(row.config).hermes),
            version: HERMES_METADATA_VERSION,
            nativeConversationChainEnabled: true,
            conversation: params.metadata.conversation,
            generation: params.metadata.generation,
            latestResponseId: params.responseId ?? params.metadata.latestResponseId,
            latestSessionId: params.sessionId ?? params.metadata.latestSessionId,
            latestSessionKey: params.sessionKey ?? params.metadata.latestSessionKey,
            updatedAt: new Date().toISOString(),
          },
        },
      })
      .where(
        and(
          eq(copilotChats.id, params.scope.chatId),
          eq(copilotChats.userId, params.scope.userId),
          eq(copilotChats.workspaceId, params.scope.workspaceId),
          eq(copilotChats.workflowId, params.scope.workflowId)
        )
      )
  } catch (error) {
    logger.warn('Failed to persist Hermes conversation metadata', {
      chatId: params.scope.chatId,
      workspaceId: params.scope.workspaceId,
      workflowId: params.scope.workflowId,
      error: toError(error).message,
    })
  }
}
