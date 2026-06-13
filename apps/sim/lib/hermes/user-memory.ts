import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  hermesUserMemory,
  member,
  organization,
  user,
  workgroup,
  workgroupMember,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import type {
  HermesUserMemoryAdminEntry,
  ListHermesUserMemoriesQuery,
} from '@/lib/api/contracts/hermes-user-memories'
import type {
  HermesUserMemoryCategory,
  HermesUserMemoryEntry,
  ParsedHermesUserMemoryRunBody,
} from '@/lib/api/contracts/internal/hermes-user-memory'
import { assertOrganizationAdmin } from '@/lib/collaboration/service'

const MAX_MEMORY_CONTENT_LENGTH = 1000
const MAX_METADATA_STRING_LENGTH = 500
const MAX_METADATA_ARRAY_ITEMS = 20
const MAX_METADATA_OBJECT_KEYS = 20
const PREFETCH_CANDIDATE_LIMIT = 50

const MEMORY_CATEGORIES = new Set<HermesUserMemoryCategory>([
  'preference',
  'communication_style',
  'content_interest',
  'workflow_habit',
  'tool_habit',
  'correction',
  'other',
])

const STABLE_MEMORY_SIGNAL_RE =
  /(记住|以后|长期|我喜欢|我不喜欢|我偏好|偏好|习惯|请总是|不要给我|先给|prefer|remember|from now on|always|when I ask|my workflow|I like|I don't like|I usually|please don't)/i

const SECRET_RE =
  /(api[_\s-]?key|token|password|passwd|secret|authorization|bearer\s+[a-z0-9._-]+|sk-[a-z0-9]{12,}|密码|密钥|令牌)/i

const EPHEMERAL_CANVAS_RE =
  /(当前画布|这个画布|当前节点|这个节点|本次任务|这次任务|刚才那次|pendingActionId|workflowId|workspaceId|toolResultRef|recentObservations|taskState|current canvas|this canvas|current task|this task|node id)/i

export class HermesUserMemoryScopeError extends Error {}
export class HermesUserMemoryContentError extends Error {}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function clip(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function sanitizeMetadataValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return clip(value, MAX_METADATA_STRING_LENGTH)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_ARRAY_ITEMS)
      .map((item) => sanitizeMetadataValue(item, depth + 1))
  }
  if (typeof value !== 'object' || depth > 2) return undefined

  const output: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value).slice(0, MAX_METADATA_OBJECT_KEYS)) {
    const cleanValue = sanitizeMetadataValue(nestedValue, depth + 1)
    if (cleanValue !== undefined) output[key] = cleanValue
  }
  return output
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const clean = sanitizeMetadataValue(metadata ?? {})
  return clean && typeof clean === 'object' && !Array.isArray(clean)
    ? (clean as Record<string, unknown>)
    : {}
}

function sanitizeEvidenceRefs(value: string[] | undefined): string[] {
  return Array.isArray(value)
    ? value
        .filter((item) => typeof item === 'string' && item.trim().length > 0)
        .map((item) => clip(item.trim(), 200))
        .slice(0, 20)
    : []
}

function toCategory(value: string | null | undefined): HermesUserMemoryCategory {
  return value && MEMORY_CATEGORIES.has(value as HermesUserMemoryCategory)
    ? (value as HermesUserMemoryCategory)
    : 'other'
}

function serializeMemory(row: typeof hermesUserMemory.$inferSelect): HermesUserMemoryEntry {
  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    category: toCategory(row.category),
    content: row.content,
    source: row.source,
    sourceHermesRunId: row.sourceHermesRunId,
    sourceTraceId: row.sourceTraceId,
    evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [],
    metadata:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata
        : {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }
}

function serializeAdminMemory(
  row: typeof hermesUserMemory.$inferSelect
): HermesUserMemoryAdminEntry {
  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    category: toCategory(row.category),
    content: row.content,
    source: row.source,
    sourceHermesRunId: row.sourceHermesRunId,
    sourceTraceId: row.sourceTraceId,
    evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }
}

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1)
  return row?.role === 'admin'
}

async function assertUserBelongsToOrganization(params: {
  userId: string
  organizationId: string
}): Promise<void> {
  if (await isPlatformAdmin(params.userId)) return

  const [directMember] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, params.userId), eq(member.organizationId, params.organizationId)))
    .limit(1)
  if (directMember) return

  const [workgroupMembership] = await db
    .select({ id: workgroupMember.id })
    .from(workgroupMember)
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .where(
      and(
        eq(workgroupMember.userId, params.userId),
        eq(workgroupMember.organizationId, params.organizationId),
        isNull(workgroup.archivedAt)
      )
    )
    .limit(1)
  if (workgroupMembership) return

  throw new HermesUserMemoryScopeError('User does not belong to this organization')
}

async function assertWorkspaceScope(params: {
  organizationId: string
  workspaceId?: string
}): Promise<void> {
  if (!params.workspaceId) return
  const [row] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(eq(workspace.id, params.workspaceId), eq(workspace.organizationId, params.organizationId))
    )
    .limit(1)
  if (!row) throw new HermesUserMemoryScopeError('Workspace does not belong to this organization')
}

export async function assertHermesUserMemoryScope(params: {
  userId: string
  organizationId: string
  workspaceId?: string
}): Promise<void> {
  const [orgRow] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.id, params.organizationId))
    .limit(1)
  if (!orgRow) throw new HermesUserMemoryScopeError('Organization not found')

  await assertUserBelongsToOrganization(params)
  await assertWorkspaceScope(params)
}

function validateLongTermMemoryContent(content: string): string {
  const normalized = normalizeText(content)
  if (!normalized) throw new HermesUserMemoryContentError('Memory content is required')
  if (SECRET_RE.test(normalized)) {
    throw new HermesUserMemoryContentError(
      'Secret-like content cannot be stored in Hermes user memory'
    )
  }
  if (EPHEMERAL_CANVAS_RE.test(normalized)) {
    throw new HermesUserMemoryContentError(
      'Canvas task state cannot be stored in Hermes user memory'
    )
  }
  return clip(normalized, MAX_MEMORY_CONTENT_LENGTH)
}

function shouldExtractStableMemory(userContent: string): boolean {
  return STABLE_MEMORY_SIGNAL_RE.test(userContent) && !SECRET_RE.test(userContent)
}

function categorizeMemory(content: string): HermesUserMemoryCategory {
  if (/(纠正|更正|以后不要|别再|correction|please don't|do not)/i.test(content)) {
    return 'correction'
  }
  if (
    /(格式|语气|简洁|详细|先结论|列表|中文|英文|tone|style|format|concise|verbose)/i.test(content)
  ) {
    return 'communication_style'
  }
  if (/(工具|浏览器|网页|搜索|终端|tool|browser|search|terminal)/i.test(content)) {
    return 'tool_habit'
  }
  if (/(流程|步骤|先.*再|分镜|hook|workflow|process|usually|habit)/i.test(content)) {
    return 'workflow_habit'
  }
  if (/(内容|文章|资料|视频|镜头|脚本|主题|content|article|video|topic)/i.test(content)) {
    return 'content_interest'
  }
  return 'preference'
}

export function extractHermesUserMemoryCandidates(params: {
  userContent: string
  assistantContent?: string
}): Array<{
  content: string
  category: HermesUserMemoryCategory
  metadata: Record<string, unknown>
}> {
  const userContent = normalizeText(params.userContent)
  if (!shouldExtractStableMemory(userContent)) return []

  try {
    const content = validateLongTermMemoryContent(userContent)
    return [
      {
        content,
        category: categorizeMemory(content),
        metadata: {
          extraction: 'conservative_signal',
          assistantResponseLength: params.assistantContent?.length ?? 0,
        },
      },
    ]
  } catch {
    return []
  }
}

async function upsertHermesUserMemory(params: {
  userId: string
  organizationId: string
  workspaceId?: string
  category: HermesUserMemoryCategory
  content: string
  sourceHermesRunId?: string
  sourceTraceId?: string
  evidenceRefs?: string[]
  metadata?: Record<string, unknown>
}): Promise<HermesUserMemoryEntry> {
  const now = new Date()
  const [existing] = await db
    .select()
    .from(hermesUserMemory)
    .where(
      and(
        eq(hermesUserMemory.userId, params.userId),
        eq(hermesUserMemory.organizationId, params.organizationId),
        params.workspaceId
          ? eq(hermesUserMemory.workspaceId, params.workspaceId)
          : isNull(hermesUserMemory.workspaceId),
        eq(hermesUserMemory.category, params.category),
        eq(hermesUserMemory.content, params.content),
        isNull(hermesUserMemory.deletedAt)
      )
    )
    .limit(1)

  if (existing) {
    const [row] = await db
      .update(hermesUserMemory)
      .set({
        lastSeenAt: now,
        updatedAt: now,
        sourceHermesRunId: params.sourceHermesRunId ?? existing.sourceHermesRunId,
        sourceTraceId: params.sourceTraceId ?? existing.sourceTraceId,
        evidenceRefs: sanitizeEvidenceRefs(params.evidenceRefs).length
          ? sanitizeEvidenceRefs(params.evidenceRefs)
          : existing.evidenceRefs,
        metadata: {
          ...(existing.metadata ?? {}),
          ...sanitizeMetadata(params.metadata),
        },
      })
      .where(eq(hermesUserMemory.id, existing.id))
      .returning()
    return serializeMemory(row ?? existing)
  }

  const [row] = await db
    .insert(hermesUserMemory)
    .values({
      id: generateId(),
      userId: params.userId,
      organizationId: params.organizationId,
      workspaceId: params.workspaceId,
      category: params.category,
      content: params.content,
      source: 'hermes',
      sourceHermesRunId: params.sourceHermesRunId,
      sourceTraceId: params.sourceTraceId,
      evidenceRefs: sanitizeEvidenceRefs(params.evidenceRefs),
      metadata: sanitizeMetadata(params.metadata),
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    })
    .returning()

  if (!row) throw new HermesUserMemoryContentError('Failed to create Hermes user memory')
  return serializeMemory(row)
}

function queryTerms(query: string): string[] {
  return normalizeText(query)
    .toLowerCase()
    .split(/[\s,.;:!?，。；：！？、]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 12)
}

function rankMemories(memories: HermesUserMemoryEntry[], query: string): HermesUserMemoryEntry[] {
  const terms = queryTerms(query)
  if (!terms.length) return memories

  return [...memories].sort((a, b) => {
    const aText = a.content.toLowerCase()
    const bText = b.content.toLowerCase()
    const aScore = terms.reduce((score, term) => score + (aText.includes(term) ? 1 : 0), 0)
    const bScore = terms.reduce((score, term) => score + (bText.includes(term) ? 1 : 0), 0)
    if (aScore !== bScore) return bScore - aScore
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}

export function formatHermesUserMemoryContext(memories: HermesUserMemoryEntry[]): string {
  if (!memories.length) return ''
  const lines = memories.map((memory) => `- [${memory.category}] ${memory.content}`)
  return ['SIM user memory:', ...lines].join('\n')
}

async function prefetchHermesUserMemory(
  body: Extract<ParsedHermesUserMemoryRunBody, { operation: 'prefetch' }>
) {
  await assertHermesUserMemoryScope(body)

  const rows = await db
    .select()
    .from(hermesUserMemory)
    .where(
      and(
        eq(hermesUserMemory.userId, body.userId),
        eq(hermesUserMemory.organizationId, body.organizationId),
        isNull(hermesUserMemory.deletedAt),
        body.workspaceId
          ? or(
              isNull(hermesUserMemory.workspaceId),
              eq(hermesUserMemory.workspaceId, body.workspaceId)
            )
          : isNull(hermesUserMemory.workspaceId)
      )
    )
    .orderBy(desc(hermesUserMemory.lastSeenAt), desc(hermesUserMemory.updatedAt))
    .limit(Math.max(PREFETCH_CANDIDATE_LIMIT, body.limit * 4))

  const memories = rankMemories(rows.map(serializeMemory), body.query).slice(0, body.limit)
  return {
    operation: body.operation,
    answer: memories.length
      ? `Loaded ${memories.length} SIM user memory item(s).`
      : 'No SIM user memory matched this turn.',
    memories,
    context: formatHermesUserMemoryContext(memories),
    traceId: body.traceId,
  }
}

async function syncHermesUserMemoryTurn(
  body: Extract<ParsedHermesUserMemoryRunBody, { operation: 'sync_turn' }>
) {
  await assertHermesUserMemoryScope(body)

  const candidates = extractHermesUserMemoryCandidates({
    userContent: body.userContent,
    assistantContent: body.assistantContent,
  })
  if (!candidates.length) {
    return {
      operation: body.operation,
      answer: 'No stable user preference was extracted from this turn.',
      created: 0,
      skippedReason: 'no_stable_preference_signal',
      traceId: body.traceId,
    }
  }

  const memories: HermesUserMemoryEntry[] = []
  for (const candidate of candidates) {
    memories.push(
      await upsertHermesUserMemory({
        userId: body.userId,
        organizationId: body.organizationId,
        category: candidate.category,
        content: candidate.content,
        sourceHermesRunId: body.hermesRunId,
        sourceTraceId: body.traceId,
        evidenceRefs: body.sessionId ? [`hermes-session:${body.sessionId}`] : [],
        metadata: {
          ...candidate.metadata,
          sourceWorkspaceId: body.workspaceId,
          sessionId: body.sessionId,
        },
      })
    )
  }

  return {
    operation: body.operation,
    answer: `Stored ${memories.length} SIM user memory item(s).`,
    created: memories.length,
    memories,
    traceId: body.traceId,
  }
}

async function writeHermesUserMemory(
  body: Extract<ParsedHermesUserMemoryRunBody, { operation: 'write' }>
) {
  await assertHermesUserMemoryScope(body)
  const content = validateLongTermMemoryContent(body.content)
  const memory = await upsertHermesUserMemory({
    userId: body.userId,
    organizationId: body.organizationId,
    category: body.category,
    content,
    sourceHermesRunId: body.hermesRunId,
    sourceTraceId: body.traceId,
    evidenceRefs: body.evidenceRefs,
    metadata: {
      ...body.metadata,
      sourceWorkspaceId: body.workspaceId,
      explicitWrite: true,
    },
  })

  return {
    operation: body.operation,
    answer: 'Stored SIM user memory.',
    created: 1,
    memory,
    traceId: body.traceId,
  }
}

export async function runHermesUserMemoryOperation(body: ParsedHermesUserMemoryRunBody) {
  if (body.operation === 'prefetch') return prefetchHermesUserMemory(body)
  if (body.operation === 'sync_turn') return syncHermesUserMemoryTurn(body)
  return writeHermesUserMemory(body)
}

export async function listHermesUserMemories(params: {
  requesterUserId: string
  organizationId: string
  query: ListHermesUserMemoriesQuery
}): Promise<HermesUserMemoryAdminEntry[]> {
  await assertOrganizationAdmin(params.requesterUserId, params.organizationId)

  const rows = await db
    .select()
    .from(hermesUserMemory)
    .where(
      and(
        eq(hermesUserMemory.organizationId, params.organizationId),
        isNull(hermesUserMemory.deletedAt),
        params.query.userId ? eq(hermesUserMemory.userId, params.query.userId) : undefined,
        params.query.workspaceId
          ? eq(hermesUserMemory.workspaceId, params.query.workspaceId)
          : undefined,
        params.query.category ? eq(hermesUserMemory.category, params.query.category) : undefined
      )
    )
    .orderBy(desc(hermesUserMemory.lastSeenAt), desc(hermesUserMemory.updatedAt))
    .limit(params.query.limit)

  return rows.map(serializeAdminMemory)
}

export async function deleteHermesUserMemory(params: {
  requesterUserId: string
  organizationId: string
  memoryId: string
  reason?: string
}): Promise<{ memory: HermesUserMemoryAdminEntry; deletedAt: string }> {
  await assertOrganizationAdmin(params.requesterUserId, params.organizationId)

  const [existing] = await db
    .select()
    .from(hermesUserMemory)
    .where(
      and(
        eq(hermesUserMemory.id, params.memoryId),
        eq(hermesUserMemory.organizationId, params.organizationId),
        isNull(hermesUserMemory.deletedAt)
      )
    )
    .limit(1)
  if (!existing) throw new HermesUserMemoryScopeError('Hermes user memory not found')

  const now = new Date()
  const [deleted] = await db
    .update(hermesUserMemory)
    .set({
      deletedAt: now,
      updatedAt: now,
      metadata: {
        ...(existing.metadata ?? {}),
        adminDeletedBy: params.requesterUserId,
        adminDeletedAt: now.toISOString(),
        adminDeleteReason: params.reason?.trim() || null,
      },
    })
    .where(eq(hermesUserMemory.id, existing.id))
    .returning()

  recordAudit({
    actorId: params.requesterUserId,
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: params.organizationId,
    resourceName: 'Hermes user memory',
    description: `Deleted Hermes user memory ${existing.id}`,
    metadata: {
      organizationId: params.organizationId,
      memoryId: existing.id,
      memoryUserId: existing.userId,
      workspaceId: existing.workspaceId,
      category: existing.category,
      deletionEvent: 'hermes_user_memory.deleted',
      reason: params.reason?.trim() || null,
    },
  })

  return {
    memory: serializeAdminMemory(deleted ?? existing),
    deletedAt: now.toISOString(),
  }
}
