import { db } from '@sim/db'
import { copilotChats } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { processContextsServer } from '@/lib/copilot/chat/process-contents'
import {
  readCanvasNodeDetail,
  summarizeCanvas,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context'
import { resolveLocalCanvasAgentModelConfig } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
import { resolveLocalAgentPermissions } from '@/lib/copilot/request/lifecycle/local-canvas-agent/permissions'
import { redactAgentVisibleFileContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/redaction'
import { loadEnabledAgentSkills } from '@/lib/copilot/request/lifecycle/local-canvas-agent/skills'
import type {
  CanvasSnapshot,
  LocalAgentAttachedContext,
  LocalAgentAttachment,
  LocalAgentContext,
  LocalAgentMessage,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { loadWorkgroupAgentProfile } from '@/lib/copilot/request/lifecycle/local-canvas-agent/workgroup-profile'
import type {
  ExecutionContext,
  OrchestratorOptions,
  StreamingContext,
} from '@/lib/copilot/request/types'
import type { ChatContext } from '@/stores/panel'

const CONTEXT_BUDGET = {
  profile: 1600,
  permissions: 400,
  skills: 2200,
  canvasSummary: 2600,
  selectedDetails: 4500,
  relevantDetails: 2600,
  attachments: 1200,
  conversation: 2200,
  memory: 2200,
  userRequest: 1200,
} as const

type LocalContextBudget = typeof CONTEXT_BUDGET

const DEFAULT_CONTEXT_CHAR_BUDGET = Object.values(CONTEXT_BUDGET).reduce(
  (total, value) => total + value,
  0
)

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function inferModelContextWindowTokens(model: string): number {
  const normalized = model.toLowerCase()
  if (/gemini|claude|gpt-5|gpt-4\.1|o3|o4/.test(normalized)) return 64_000
  if (/mini|flash|lite/.test(normalized)) return 32_000
  return 16_000
}

function resolveContextBudget(context: LocalAgentContext): LocalContextBudget {
  const requestedTokens =
    asPositiveNumber(context.requestPayload.localCanvasContextWindowTokens) ??
    asPositiveNumber(context.requestPayload.contextWindowTokens) ??
    inferModelContextWindowTokens(context.model.model)
  const targetChars = Math.min(48_000, Math.max(10_000, Math.floor(requestedTokens * 1.6)))
  const scale = Math.min(2.25, Math.max(0.5, targetChars / DEFAULT_CONTEXT_CHAR_BUDGET))
  return {
    profile: Math.max(900, Math.floor(CONTEXT_BUDGET.profile * scale)),
    permissions: CONTEXT_BUDGET.permissions,
    skills: Math.max(1000, Math.floor(CONTEXT_BUDGET.skills * scale)),
    canvasSummary: Math.max(1400, Math.floor(CONTEXT_BUDGET.canvasSummary * scale)),
    selectedDetails: Math.max(2500, Math.floor(CONTEXT_BUDGET.selectedDetails * scale)),
    relevantDetails: Math.max(1200, Math.floor(CONTEXT_BUDGET.relevantDetails * scale)),
    attachments: Math.max(700, Math.floor(CONTEXT_BUDGET.attachments * scale)),
    conversation: Math.max(900, Math.floor(CONTEXT_BUDGET.conversation * scale)),
    memory: Math.max(900, Math.floor(CONTEXT_BUDGET.memory * scale)),
    userRequest: Math.max(1200, Math.floor(CONTEXT_BUDGET.userRequest * scale)),
  }
}

function clip(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 20))}\n...[truncated]`
}

function layer(title: string, body: string): string {
  return [`## ${title}`, body.trim() || 'none'].join('\n')
}

function stringifyCompact(value: unknown, maxLength: number): string {
  return clip(JSON.stringify(value, null, 2), maxLength)
}

function extractConversationHistory(value: unknown): LocalAgentMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .map((message) => {
      if (!message || typeof message !== 'object') return null
      const record = message as Record<string, unknown>
      const role = record.role
      const content = extractMessageText(record)
      if (
        (role === 'user' || role === 'assistant' || role === 'system') &&
        typeof content === 'string' &&
        content.trim()
      ) {
        return { role, content }
      }
      return null
    })
    .filter((message): message is LocalAgentMessage => Boolean(message))
}

function extractMessageText(record: Record<string, unknown>): string {
  if (typeof record.content === 'string') return record.content
  const blocks = record.contentBlocks
  if (!Array.isArray(blocks)) return ''
  return blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const blockRecord = block as Record<string, unknown>
      return typeof blockRecord.content === 'string' ? blockRecord.content : ''
    })
    .filter(Boolean)
    .join('\n')
}

export async function loadUserScopedAgentHistory(params: {
  userId: string
  workspaceId: string
  workflowId: string
  chatId?: string
  fallbackHistory: LocalAgentMessage[]
}): Promise<LocalAgentMessage[]> {
  if (!params.chatId) return params.fallbackHistory
  const [row] = await db
    .select({ messages: copilotChats.messages })
    .from(copilotChats)
    .where(
      and(
        eq(copilotChats.id, params.chatId),
        eq(copilotChats.userId, params.userId),
        eq(copilotChats.workspaceId, params.workspaceId),
        eq(copilotChats.workflowId, params.workflowId)
      )
    )
    .limit(1)

  const persisted = extractConversationHistory(row?.messages)
  return persisted.length ? persisted : params.fallbackHistory
}

function extractBlockIdsFromContextEntry(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const blockIds = record.blockIds
  if (Array.isArray(blockIds)) {
    return blockIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
  }
  return typeof record.blockId === 'string' && record.blockId.length > 0 ? [record.blockId] : []
}

function extractSelectedNodeIds(requestPayload: Record<string, unknown>): string[] {
  const candidates = [
    requestPayload.autoSelectionContexts,
    requestPayload.contexts,
    requestPayload.selectedContexts,
  ]
  const ids = candidates.flatMap((value) =>
    Array.isArray(value) ? value.flatMap(extractBlockIdsFromContextEntry) : []
  )
  const directIds = requestPayload.selectedNodeIds
  if (Array.isArray(directIds)) {
    ids.push(...directIds.filter((id): id is string => typeof id === 'string' && id.length > 0))
  }
  return [...new Set(ids)]
}

function extractAttachments(requestPayload: Record<string, unknown>): LocalAgentAttachment[] {
  const rawAttachments = requestPayload.fileAttachments
  if (!Array.isArray(rawAttachments)) return []
  return rawAttachments
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const name =
        typeof record.name === 'string'
          ? record.name
          : typeof record.fileName === 'string'
            ? record.fileName
            : typeof record.filename === 'string'
              ? record.filename
              : ''
      if (!name.trim()) return null
      return {
        ...(typeof record.id === 'string' ? { id: record.id } : {}),
        ...(typeof record.key === 'string' ? { key: record.key } : {}),
        name,
        ...(typeof record.type === 'string'
          ? { type: record.type }
          : typeof record.mimeType === 'string'
            ? { type: record.mimeType }
            : typeof record.media_type === 'string'
              ? { type: record.media_type }
              : {}),
        ...(typeof record.size === 'number' ? { size: record.size } : {}),
        ...(typeof record.url === 'string'
          ? { url: record.url }
          : typeof record.previewUrl === 'string'
            ? { url: record.previewUrl }
            : typeof record.path === 'string'
              ? { url: record.path }
              : {}),
      } satisfies LocalAgentAttachment
    })
    .filter((item): item is LocalAgentAttachment => Boolean(item))
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function parseChatContext(value: unknown): ChatContext | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const kind = record.kind
  const label = typeof record.label === 'string' ? record.label : ''
  if (kind === 'past_chat' && typeof record.chatId === 'string') {
    return { kind, chatId: record.chatId, label }
  }
  if (
    (kind === 'workflow' || kind === 'current_workflow') &&
    typeof record.workflowId === 'string'
  ) {
    return { kind, workflowId: record.workflowId, label }
  }
  if (kind === 'blocks' && isStringArray(record.blockIds)) {
    return { kind, blockIds: record.blockIds, label }
  }
  if (kind === 'logs') {
    return {
      kind,
      ...(typeof record.executionId === 'string' ? { executionId: record.executionId } : {}),
      label,
    }
  }
  if (
    kind === 'workflow_block' &&
    typeof record.workflowId === 'string' &&
    typeof record.blockId === 'string'
  ) {
    return { kind, workflowId: record.workflowId, blockId: record.blockId, label }
  }
  if (kind === 'knowledge') {
    return {
      kind,
      ...(typeof record.knowledgeId === 'string' ? { knowledgeId: record.knowledgeId } : {}),
      label,
    }
  }
  if (kind === 'table' && typeof record.tableId === 'string') {
    return { kind, tableId: record.tableId, label }
  }
  if (kind === 'file' && typeof record.fileId === 'string') {
    return { kind, fileId: record.fileId, label }
  }
  if (kind === 'folder' && typeof record.folderId === 'string') {
    return { kind, folderId: record.folderId, label }
  }
  if (kind === 'templates') {
    return {
      kind,
      ...(typeof record.templateId === 'string' ? { templateId: record.templateId } : {}),
      label,
    }
  }
  if (kind === 'docs') {
    return { kind, label }
  }
  return null
}

function extractManualContexts(requestPayload: Record<string, unknown>): ChatContext[] {
  const rawContexts = requestPayload.contexts
  if (!Array.isArray(rawContexts)) return []
  return rawContexts
    .map(parseChatContext)
    .filter((context): context is ChatContext => Boolean(context))
}

async function resolveAttachedContexts(params: {
  requestPayload: Record<string, unknown>
  userId: string
  workspaceId: string
  chatId?: string
  message: string
}): Promise<LocalAgentAttachedContext[]> {
  const contexts = extractManualContexts(params.requestPayload)
  if (!contexts.length) return []
  const processed = await processContextsServer(
    contexts,
    params.userId,
    params.message,
    params.workspaceId,
    params.chatId
  )
  return processed.map((context) => ({
    type: context.type,
    tag: context.tag,
    content: context.content,
  }))
}

function collectRelevantNodeIds(context: LocalAgentContext, snapshot: CanvasSnapshot): string[] {
  const selected = new Set(context.selectedNodeIds)
  const relevant = new Set<string>()
  for (const edge of snapshot.edges) {
    if (selected.has(edge.source)) relevant.add(edge.target)
    if (selected.has(edge.target)) relevant.add(edge.source)
  }

  const normalizedMessage = context.message.toLowerCase()
  for (const node of snapshot.nodes) {
    if (
      node.name &&
      normalizedMessage.includes(node.name.toLowerCase()) &&
      !selected.has(node.id)
    ) {
      relevant.add(node.id)
    }
  }

  return [...relevant].slice(0, 8)
}

function buildConversationContext(history: LocalAgentMessage[], budget: number): string {
  const maxMessages = budget < 1400 ? 4 : budget < 2200 ? 8 : 12
  const perMessageBudget = budget < 1400 ? 280 : budget < 2200 ? 360 : 500
  const recent = history.slice(-maxMessages)
  const olderCount = Math.max(0, history.length - recent.length)
  const lines = recent.map(
    (message) => `${message.role}: ${clip(message.content, perMessageBudget)}`
  )
  return [
    olderCount ? `Earlier messages compressed into memory: ${olderCount} message(s).` : '',
    ...lines,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildMemoryContext(context: LocalAgentContext): string {
  if (!context.memory) return ''
  const recentObservations = context.memory.recentObservations
    .slice(-6)
    .map(
      (observation) =>
        `- ${observation.toolName}: success=${observation.success}; ${observation.summary}`
    )
    .join('\n')
  return [
    context.memory.conversationSummary
      ? `Conversation summary:\n${context.memory.conversationSummary}`
      : '',
    context.memory.taskState.goal ? `Task goal: ${context.memory.taskState.goal}` : '',
    context.memory.taskState.completedSteps.length
      ? `Completed steps:\n${context.memory.taskState.completedSteps
          .slice(-8)
          .map((step) => `- ${step}`)
          .join('\n')}`
      : '',
    context.memory.taskState.openQuestions.length
      ? `Open questions:\n${context.memory.taskState.openQuestions
          .slice(-4)
          .map((question) => `- ${question}`)
          .join('\n')}`
      : '',
    context.memory.taskState.lastObservation
      ? `Last observation: ${context.memory.taskState.lastObservation}`
      : '',
    context.memory.canvasSummary ? `Canvas memory:\n${context.memory.canvasSummary}` : '',
    recentObservations ? `Recent observations:\n${recentObservations}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildAttachmentContext(attachments: LocalAgentAttachment[] | undefined): string {
  if (!attachments?.length) return ''
  return attachments
    .slice(0, 12)
    .map((attachment) =>
      [
        `- ${attachment.name}`,
        attachment.type ? `type=${attachment.type}` : '',
        typeof attachment.size === 'number' ? `size=${attachment.size}` : '',
      ]
        .filter(Boolean)
        .join(' ')
    )
    .join('\n')
}

function buildAttachedContextsContext(
  contexts: LocalAgentAttachedContext[] | undefined,
  budget: number
): string {
  if (!contexts?.length) return ''
  return contexts
    .slice(0, 8)
    .map((context) => {
      const content =
        context.type === 'file' ? redactAgentVisibleFileContext(context.content) : context.content
      return [
        `### ${context.type} ${context.tag}`,
        clip(content, Math.max(500, Math.floor(budget / 2))),
      ].join('\n')
    })
    .join('\n\n')
}

function buildAgentProfileContext(context: LocalAgentContext): string {
  return [
    `Agent code: ${context.agent.code}`,
    `Discipline code: ${context.discipline.code}`,
    'Agent profile instructions are internal capability context only; user-facing answers must not role-play or self-introduce as the profile.',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildTokenAwareLocalAgentContext(params: {
  context: LocalAgentContext
  snapshot: CanvasSnapshot
}): string {
  const { context, snapshot } = params
  const budget = resolveContextBudget(context)
  const canvasSummary = summarizeCanvas(snapshot, context.selectedNodeIds)
  const selectedDetails = context.selectedNodeIds
    .map((nodeId) => readCanvasNodeDetail(snapshot, nodeId, context.selectedNodeIds))
    .filter(Boolean)
  const relevantDetails = collectRelevantNodeIds(context, snapshot)
    .map((nodeId) => readCanvasNodeDetail(snapshot, nodeId, context.selectedNodeIds))
    .filter(Boolean)

  return [
    layer('Agent Profile', clip(buildAgentProfileContext(context), budget.profile)),
    layer(
      'Permissions',
      clip(
        [
          `read=${context.permissions.canRead}`,
          `write=${context.permissions.canWrite}`,
          `publish=${context.permissions.canPublish}`,
          context.permissions.readonlyReason
            ? `readonlyReason=${context.permissions.readonlyReason}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        budget.permissions
      )
    ),
    layer(
      'Enabled Skills',
      clip(
        context.skills
          .map(
            (skill) =>
              `- ${skill.name} [${skill.source}]: ${skill.description}\n${clip(skill.content, 700)}`
          )
          .join('\n\n'),
        budget.skills
      )
    ),
    layer(
      'Canvas Summary',
      stringifyCompact(
        {
          workflowId: snapshot.workflowId,
          nodeCount: snapshot.nodes.length,
          edgeCount: snapshot.edges.length,
          nodes: canvasSummary,
          edges: snapshot.edges,
        },
        budget.canvasSummary
      )
    ),
    layer('Selected Node Details', stringifyCompact(selectedDetails, budget.selectedDetails)),
    layer('Relevant Node Details', stringifyCompact(relevantDetails, budget.relevantDetails)),
    layer(
      'Attached Contexts',
      clip(
        [
          buildAttachmentContext(context.attachments),
          buildAttachedContextsContext(context.attachedContexts, budget.attachments),
        ]
          .filter(Boolean)
          .join('\n\n'),
        budget.attachments
      )
    ),
    layer(
      'Recent Conversation',
      clip(
        buildConversationContext(context.conversationHistory, budget.conversation),
        budget.conversation
      )
    ),
    layer('Long-Term Memory', clip(buildMemoryContext(context), budget.memory)),
    layer('User Request', clip(context.message, budget.userRequest)),
  ].join('\n\n')
}

export async function resolveLocalAgentContext(params: {
  requestPayload: Record<string, unknown>
  execContext: ExecutionContext
  streamContext: StreamingContext
  options: Pick<OrchestratorOptions, 'abortSignal' | 'onEvent'>
}): Promise<LocalAgentContext> {
  const message =
    typeof params.requestPayload.message === 'string' ? params.requestPayload.message : ''
  const workflowId =
    (typeof params.requestPayload.workflowId === 'string' && params.requestPayload.workflowId) ||
    params.execContext.workflowId
  const workspaceId =
    (typeof params.requestPayload.workspaceId === 'string' && params.requestPayload.workspaceId) ||
    params.execContext.workspaceId
  const userId = params.execContext.userId

  if (!workflowId) throw new Error('Local canvas agent requires a workflowId')
  if (!workspaceId) throw new Error('Local canvas agent requires a workspaceId')
  if (!userId) throw new Error('Local canvas agent requires an authenticated user')

  const profile = await loadWorkgroupAgentProfile({ userId, workspaceId })
  const permissions = await resolveLocalAgentPermissions({ userId, workflowId })
  const skills = await loadEnabledAgentSkills({
    organizationId: profile.workgroup.organizationId,
    agentCode: profile.agent.code,
    workgroupId: profile.workgroup.id,
    teamWorkspaceId: profile.workgroup.teamWorkspaceId,
  })

  const chatId =
    typeof params.requestPayload.chatId === 'string'
      ? params.requestPayload.chatId
      : params.execContext.chatId
  const fallbackHistory = extractConversationHistory(params.requestPayload.conversationHistory)
  const conversationHistory = await loadUserScopedAgentHistory({
    userId,
    workspaceId,
    workflowId,
    chatId,
    fallbackHistory,
  })
  const attachedContexts = await resolveAttachedContexts({
    requestPayload: params.requestPayload,
    userId,
    workspaceId,
    chatId,
    message,
  })

  return {
    userId,
    workspaceId,
    workflowId,
    chatId,
    message,
    sessionScope: 'personal',
    ...profile,
    permissions,
    selectedNodeIds: extractSelectedNodeIds(params.requestPayload),
    attachments: extractAttachments(params.requestPayload),
    attachedContexts,
    conversationHistory,
    skills,
    model: resolveLocalCanvasAgentModelConfig(),
    confirmationMode:
      params.requestPayload.confirmationMode === 'manual' ||
      params.requestPayload.confirmationMode === 'auto'
        ? params.requestPayload.confirmationMode
        : 'auto',
    thinkingLevel:
      params.requestPayload.thinkingLevel === 'standard' ||
      params.requestPayload.thinkingLevel === 'extra'
        ? params.requestPayload.thinkingLevel
        : 'extra',
    requestPayload: params.requestPayload,
    execContext: params.execContext,
    streamContext: params.streamContext,
    options: params.options,
  }
}
