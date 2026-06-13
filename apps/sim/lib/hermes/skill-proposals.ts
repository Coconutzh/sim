import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  agentSkillBinding,
  discipline,
  member,
  skill,
  skillProposal,
  skillRevision,
  user,
  workgroup,
  workgroupMember,
  workspace,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import type {
  HermesPublishedSkill,
  HermesSkillProposal,
  HermesSkillProposalComparison,
  ParsedHermesSkillProposalRunBody,
} from '@/lib/api/contracts/internal/hermes-skill-proposals'
import type { SkillRevision } from '@/lib/api/contracts/skill-proposals'
import { type AgentCode, isAgentCode } from '@/lib/collaboration/definitions'
import { assertOrganizationAdmin } from '@/lib/collaboration/service'

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function normalizeAgentCode(value: string | null | undefined): AgentCode {
  return value && isAgentCode(value) ? value : 'chief_director'
}

function serializeProposal(row: typeof skillProposal.$inferSelect): HermesSkillProposal {
  return {
    id: row.id,
    organizationId: row.organizationId,
    workspaceId: row.workspaceId,
    workgroupId: row.workgroupId,
    agentCode: row.agentCode && isAgentCode(row.agentCode) ? row.agentCode : null,
    sourceUserId: row.sourceUserId,
    sourceHermesRunId: row.sourceHermesRunId,
    targetSkillId: row.targetSkillId,
    publishedSkillId: row.publishedSkillId,
    type: row.type,
    title: row.title,
    description: row.description,
    proposedContent: row.proposedContent,
    proposedDiff: row.proposedDiff,
    evidenceRefs: asStringArray(row.evidenceRefs),
    risk: row.risk,
    status: row.status,
    reviewerId: row.reviewerId,
    reviewNote: row.reviewNote,
    reviewedAt: toIsoString(row.reviewedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function serializeRevision(row: typeof skillRevision.$inferSelect): SkillRevision {
  return {
    id: row.id,
    skillId: row.skillId,
    version: row.version,
    content: row.content,
    diff: row.diff,
    authorType: row.authorType,
    authorId: row.authorId,
    sourceProposalId: row.sourceProposalId,
    rollbackTargetRevisionId: row.rollbackTargetRevisionId,
    createdAt: row.createdAt.toISOString(),
  }
}

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1)
  return row?.role === 'admin'
}

async function assertProposalSourceAccess(params: {
  userId: string
  organizationId: string
}): Promise<void> {
  if (await isPlatformAdmin(params.userId)) return

  const [organizationMember] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, params.userId), eq(member.organizationId, params.organizationId)))
    .limit(1)
  if (organizationMember) return

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

  throw new Error('User does not belong to this organization')
}

async function resolveWorkgroupContext(params: {
  organizationId: string
  workgroupId?: string
  agentCode?: string
}): Promise<{ workgroupId?: string; workspaceId?: string; agentCode?: string }> {
  if (!params.workgroupId) return { agentCode: params.agentCode }

  const [row] = await db
    .select({
      workgroupId: workgroup.id,
      teamWorkspaceId: workgroup.teamWorkspaceId,
      disciplineAgentCode: discipline.agentCode,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(
      and(
        eq(workgroup.id, params.workgroupId),
        eq(workgroup.organizationId, params.organizationId),
        isNull(workgroup.archivedAt)
      )
    )
    .limit(1)

  if (!row) throw new Error('Workgroup not found')
  const agentCode = row.disciplineAgentCode ?? params.agentCode
  if (params.agentCode && agentCode !== params.agentCode) {
    throw new Error('Workgroup does not belong to the requested agent')
  }
  return {
    workgroupId: row.workgroupId,
    workspaceId: row.teamWorkspaceId ?? undefined,
    agentCode: agentCode && isAgentCode(agentCode) ? agentCode : params.agentCode,
  }
}

async function assertWorkspaceBelongsToOrganization(params: {
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
  if (!row) throw new Error('Workspace not found')
}

async function readPublishedSkill(params: { organizationId: string; skillId: string }): Promise<
  | (HermesPublishedSkill & {
      content: string
    })
  | null
> {
  const [row] = await db
    .select({
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      workgroupId: workgroup.id,
      workgroupName: workgroup.name,
      teamWorkspaceId: workgroup.teamWorkspaceId,
      disciplineAgentCode: discipline.agentCode,
      bindingEnabled: agentSkillBinding.enabled,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .innerJoin(skill, eq(skill.workspaceId, workgroup.teamWorkspaceId))
    .leftJoin(
      agentSkillBinding,
      and(
        eq(agentSkillBinding.organizationId, params.organizationId),
        eq(agentSkillBinding.skillId, skill.id),
        eq(agentSkillBinding.scope, 'agent_template'),
        isNull(agentSkillBinding.workgroupId)
      )
    )
    .where(
      and(
        eq(workgroup.organizationId, params.organizationId),
        isNull(workgroup.archivedAt),
        eq(skill.id, params.skillId)
      )
    )
    .limit(1)

  if (!row) return null
  const agentCode = normalizeAgentCode(row.disciplineAgentCode)
  return {
    id: row.skillId,
    name: row.name,
    description: row.description,
    content: row.content,
    agentCode,
    workgroupId: row.workgroupId,
    workgroupName: row.workgroupName,
    teamWorkspaceId: row.teamWorkspaceId ?? '',
    enabledByDefault: row.bindingEnabled ?? true,
  }
}

async function listPublishedSkills(params: {
  organizationId: string
  agentCode?: string
  workgroupId?: string
  limit: number
}): Promise<HermesPublishedSkill[]> {
  const rows = await db
    .select({
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
      workgroupId: workgroup.id,
      workgroupName: workgroup.name,
      teamWorkspaceId: workgroup.teamWorkspaceId,
      disciplineAgentCode: discipline.agentCode,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .innerJoin(skill, eq(skill.workspaceId, workgroup.teamWorkspaceId))
    .where(
      and(
        eq(workgroup.organizationId, params.organizationId),
        isNull(workgroup.archivedAt),
        params.workgroupId ? eq(workgroup.id, params.workgroupId) : undefined,
        params.agentCode ? eq(discipline.agentCode, params.agentCode) : undefined
      )
    )
    .orderBy(asc(workgroup.name), asc(skill.name))
    .limit(params.limit)

  const skillIds = rows.map((row) => row.skillId)
  const agentCodes = rows
    .map((row) => normalizeAgentCode(row.disciplineAgentCode))
    .filter((agentCode, index, items) => items.indexOf(agentCode) === index)

  const bindings =
    skillIds.length > 0 && agentCodes.length > 0
      ? await db
          .select({
            skillId: agentSkillBinding.skillId,
            agentCode: agentSkillBinding.agentCode,
            enabled: agentSkillBinding.enabled,
          })
          .from(agentSkillBinding)
          .where(
            and(
              eq(agentSkillBinding.organizationId, params.organizationId),
              eq(agentSkillBinding.scope, 'agent_template'),
              isNull(agentSkillBinding.workgroupId),
              inArray(agentSkillBinding.skillId, skillIds),
              inArray(agentSkillBinding.agentCode, agentCodes)
            )
          )
      : []
  const bindingByAgentSkill = new Map(
    bindings.map((binding) => [`${binding.agentCode}:${binding.skillId}`, binding])
  )

  return rows.map((row) => {
    const agentCode = normalizeAgentCode(row.disciplineAgentCode)
    return {
      id: row.skillId,
      name: row.name,
      description: row.description,
      agentCode,
      workgroupId: row.workgroupId,
      workgroupName: row.workgroupName,
      teamWorkspaceId: row.teamWorkspaceId ?? '',
      enabledByDefault: bindingByAgentSkill.get(`${agentCode}:${row.skillId}`)?.enabled ?? true,
    }
  })
}

async function resolveWorkspaceContext(params: {
  organizationId: string
  workspaceId?: string | null
}): Promise<{ workspaceId?: string; workgroupId?: string; agentCode?: AgentCode }> {
  if (!params.workspaceId) return {}

  const [row] = await db
    .select({
      workspaceId: workspace.id,
      workgroupId: workspace.workgroupId,
      disciplineAgentCode: discipline.agentCode,
    })
    .from(workspace)
    .leftJoin(workgroup, eq(workspace.workgroupId, workgroup.id))
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(
      and(eq(workspace.id, params.workspaceId), eq(workspace.organizationId, params.organizationId))
    )
    .limit(1)

  if (!row) throw new Error('Workspace not found')
  return {
    workspaceId: row.workspaceId,
    workgroupId: row.workgroupId ?? undefined,
    agentCode: row.disciplineAgentCode ? normalizeAgentCode(row.disciplineAgentCode) : undefined,
  }
}

async function getNextSkillRevisionVersion(skillId: string): Promise<number> {
  const [lastRevision] = await db
    .select({ version: skillRevision.version })
    .from(skillRevision)
    .where(eq(skillRevision.skillId, skillId))
    .orderBy(desc(skillRevision.version))
    .limit(1)
  return (lastRevision?.version ?? 0) + 1
}

async function createSkillRevision(params: {
  skillId: string
  content: string
  diff?: string | null
  authorId: string
  sourceProposalId?: string | null
  rollbackTargetRevisionId?: string | null
}): Promise<SkillRevision> {
  const [row] = await db
    .insert(skillRevision)
    .values({
      id: generateId(),
      skillId: params.skillId,
      version: await getNextSkillRevisionVersion(params.skillId),
      content: params.content,
      diff: params.diff ?? null,
      authorType: 'admin',
      authorId: params.authorId,
      sourceProposalId: params.sourceProposalId ?? null,
      rollbackTargetRevisionId: params.rollbackTargetRevisionId ?? null,
      createdAt: new Date(),
    })
    .returning()

  if (!row) throw new Error('Failed to create skill revision')
  return serializeRevision(row)
}

async function ensureBaselineRevision(params: {
  skillId: string
  content: string
  actorUserId: string
}): Promise<void> {
  const [existingRevision] = await db
    .select({ id: skillRevision.id })
    .from(skillRevision)
    .where(eq(skillRevision.skillId, params.skillId))
    .limit(1)

  if (existingRevision) return
  await createSkillRevision({
    skillId: params.skillId,
    content: params.content,
    diff: 'Baseline before Hermes proposal publishing',
    authorId: params.actorUserId,
  })
}

async function ensureAgentTemplateBinding(params: {
  organizationId: string
  agentCode: AgentCode
  skillId: string
  enabled: boolean
}): Promise<void> {
  const now = new Date()
  const [existingBinding] = await db
    .select({ id: agentSkillBinding.id })
    .from(agentSkillBinding)
    .where(
      and(
        eq(agentSkillBinding.organizationId, params.organizationId),
        eq(agentSkillBinding.agentCode, params.agentCode),
        eq(agentSkillBinding.skillId, params.skillId),
        eq(agentSkillBinding.scope, 'agent_template'),
        isNull(agentSkillBinding.workgroupId)
      )
    )
    .limit(1)

  if (existingBinding) {
    await db
      .update(agentSkillBinding)
      .set({ enabled: params.enabled, updatedAt: now })
      .where(eq(agentSkillBinding.id, existingBinding.id))
    return
  }

  await db.insert(agentSkillBinding).values({
    id: generateId(),
    organizationId: params.organizationId,
    agentCode: params.agentCode,
    workgroupId: null,
    skillId: params.skillId,
    enabled: params.enabled,
    scope: 'agent_template',
    createdAt: now,
    updatedAt: now,
  })
}

async function getProposalForOrganization(params: {
  organizationId: string
  proposalId: string
}): Promise<typeof skillProposal.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(skillProposal)
    .where(
      and(
        eq(skillProposal.id, params.proposalId),
        eq(skillProposal.organizationId, params.organizationId)
      )
    )
    .limit(1)
  return row ?? null
}

async function createProposal(params: {
  body: Extract<ParsedHermesSkillProposalRunBody, { operation: 'propose_create' | 'propose_patch' }>
}): Promise<HermesSkillProposal> {
  await assertProposalSourceAccess({
    userId: params.body.userId,
    organizationId: params.body.organizationId,
  })

  const workgroupContext = await resolveWorkgroupContext({
    organizationId: params.body.organizationId,
    workgroupId: params.body.workgroupId,
    agentCode: params.body.agentCode,
  })
  const workspaceId = params.body.workspaceId ?? workgroupContext.workspaceId
  await assertWorkspaceBelongsToOrganization({
    organizationId: params.body.organizationId,
    workspaceId,
  })

  let targetSkillId: string | null = null
  let type: 'create' | 'patch' = 'create'
  if (params.body.operation === 'propose_patch') {
    const target = await readPublishedSkill({
      organizationId: params.body.organizationId,
      skillId: params.body.targetSkillId,
    })
    if (!target) throw new Error('Skill not found')
    targetSkillId = target.id
    type = 'patch'
  }

  const now = new Date()
  const id = generateId()
  const [row] = await db
    .insert(skillProposal)
    .values({
      id,
      organizationId: params.body.organizationId,
      workspaceId: workspaceId ?? null,
      workgroupId: workgroupContext.workgroupId ?? params.body.workgroupId ?? null,
      agentCode: workgroupContext.agentCode ?? params.body.agentCode ?? null,
      sourceUserId: params.body.userId,
      sourceHermesRunId: params.body.hermesRunId ?? null,
      targetSkillId,
      type,
      title: params.body.title,
      description: params.body.description,
      proposedContent: params.body.proposedContent ?? null,
      proposedDiff:
        params.body.operation === 'propose_patch' ? (params.body.proposedDiff ?? null) : null,
      evidenceRefs: params.body.evidenceRefs,
      risk: params.body.risk,
      status: params.body.status,
      createdAt: now,
      updatedAt: now,
    })
    .returning()

  if (!row) throw new Error('Failed to create skill proposal')

  recordAudit({
    actorId: params.body.userId,
    action: AuditAction.SKILL_CREATED,
    resourceType: AuditResourceType.SKILL,
    resourceId: row.id,
    resourceName: row.title,
    description: `Hermes submitted a ${row.type} skill proposal for review`,
    metadata: {
      organizationId: row.organizationId,
      workgroupId: row.workgroupId,
      agentCode: row.agentCode,
      targetSkillId: row.targetSkillId,
      sourceHermesRunId: row.sourceHermesRunId,
      status: row.status,
    },
  })

  return serializeProposal(row)
}

async function submitProposalForReview(params: {
  body: Extract<ParsedHermesSkillProposalRunBody, { operation: 'submit_review' }>
}): Promise<HermesSkillProposal> {
  await assertProposalSourceAccess({
    userId: params.body.userId,
    organizationId: params.body.organizationId,
  })

  const proposal = await getProposalForOrganization({
    organizationId: params.body.organizationId,
    proposalId: params.body.proposalId,
  })
  if (!proposal) throw new Error('Proposal not found')

  const now = new Date()
  const [row] = await db
    .update(skillProposal)
    .set({ status: 'pending_review', updatedAt: now })
    .where(
      and(
        eq(skillProposal.id, params.body.proposalId),
        eq(skillProposal.organizationId, params.body.organizationId),
        or(eq(skillProposal.status, 'draft'), eq(skillProposal.status, 'pending_review'))
      )
    )
    .returning()

  return serializeProposal(row ?? proposal)
}

async function compareProposal(params: {
  body: Extract<ParsedHermesSkillProposalRunBody, { operation: 'compare' }>
}): Promise<HermesSkillProposalComparison> {
  await assertProposalSourceAccess({
    userId: params.body.userId,
    organizationId: params.body.organizationId,
  })

  const proposal = await getProposalForOrganization({
    organizationId: params.body.organizationId,
    proposalId: params.body.proposalId,
  })
  if (!proposal) throw new Error('Proposal not found')

  const targetSkill = proposal.targetSkillId
    ? await readPublishedSkill({
        organizationId: params.body.organizationId,
        skillId: proposal.targetSkillId,
      })
    : null
  return {
    proposalId: proposal.id,
    targetSkillId: proposal.targetSkillId,
    targetContent: targetSkill?.content ?? null,
    proposedContent: proposal.proposedContent,
    proposedDiff: proposal.proposedDiff,
  }
}

export async function listSkillProposalsForReview(params: {
  userId: string
  organizationId: string
  status?: HermesSkillProposal['status']
  limit: number
}): Promise<HermesSkillProposal[]> {
  await assertOrganizationAdmin(params.userId, params.organizationId)

  const rows = await db
    .select()
    .from(skillProposal)
    .where(
      and(
        eq(skillProposal.organizationId, params.organizationId),
        params.status ? eq(skillProposal.status, params.status) : undefined
      )
    )
    .orderBy(desc(skillProposal.updatedAt))
    .limit(params.limit)

  return rows.map(serializeProposal)
}

export async function reviewSkillProposal(params: {
  actorUserId: string
  organizationId: string
  proposalId: string
  action: 'approve' | 'reject'
  reviewNote?: string
}): Promise<HermesSkillProposal> {
  await assertOrganizationAdmin(params.actorUserId, params.organizationId)

  const proposal = await getProposalForOrganization({
    organizationId: params.organizationId,
    proposalId: params.proposalId,
  })
  if (!proposal) throw new Error('Proposal not found')
  if (proposal.status === 'published') throw new Error('Published proposals cannot be reviewed')

  const now = new Date()
  const [row] = await db
    .update(skillProposal)
    .set({
      status: params.action === 'approve' ? 'approved' : 'rejected',
      reviewerId: params.actorUserId,
      reviewNote: params.reviewNote?.trim() || null,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(skillProposal.id, params.proposalId),
        eq(skillProposal.organizationId, params.organizationId)
      )
    )
    .returning()

  const reviewed = row ?? proposal
  recordAudit({
    actorId: params.actorUserId,
    action: AuditAction.SKILL_UPDATED,
    resourceType: AuditResourceType.SKILL,
    resourceId: reviewed.id,
    resourceName: reviewed.title,
    description:
      params.action === 'approve'
        ? `Approved Hermes skill proposal "${reviewed.title}"`
        : `Rejected Hermes skill proposal "${reviewed.title}"`,
    metadata: {
      organizationId: reviewed.organizationId,
      proposalId: reviewed.id,
      status: reviewed.status,
      targetSkillId: reviewed.targetSkillId,
      sourceHermesRunId: reviewed.sourceHermesRunId,
    },
  })

  return serializeProposal(reviewed)
}

async function publishCreateProposal(params: {
  actorUserId: string
  proposal: typeof skillProposal.$inferSelect
  enableBinding: boolean
}): Promise<{ skill: HermesPublishedSkill; revision: SkillRevision }> {
  if (!params.proposal.proposedContent) {
    throw new Error('Approved create proposal must include proposedContent before publish')
  }

  const workgroupContext = await resolveWorkgroupContext({
    organizationId: params.proposal.organizationId,
    workgroupId: params.proposal.workgroupId ?? undefined,
    agentCode: params.proposal.agentCode ?? undefined,
  })
  const workspaceContext = await resolveWorkspaceContext({
    organizationId: params.proposal.organizationId,
    workspaceId: params.proposal.workspaceId,
  })
  const workspaceId =
    params.proposal.workspaceId ?? workgroupContext.workspaceId ?? workspaceContext.workspaceId
  const workgroupId =
    params.proposal.workgroupId ?? workgroupContext.workgroupId ?? workspaceContext.workgroupId
  const agentCode = normalizeAgentCode(
    params.proposal.agentCode ?? workgroupContext.agentCode ?? workspaceContext.agentCode
  )

  if (!workspaceId || !workgroupId) {
    throw new Error('Approved create proposal must target a team workspace before publish')
  }
  if (workgroupContext.workspaceId && workspaceId !== workgroupContext.workspaceId) {
    throw new Error('Proposal workspace does not match the target workgroup')
  }

  const [existingSkill] = await db
    .select({ id: skill.id })
    .from(skill)
    .where(and(eq(skill.workspaceId, workspaceId), eq(skill.name, params.proposal.title)))
    .limit(1)
  if (existingSkill)
    throw new Error('A skill with this name already exists in the target workspace')

  const now = new Date()
  const skillId = generateId()
  await db.insert(skill).values({
    id: skillId,
    workspaceId,
    userId: params.actorUserId,
    name: params.proposal.title,
    description: params.proposal.description,
    content: params.proposal.proposedContent,
    createdAt: now,
    updatedAt: now,
  })
  await ensureAgentTemplateBinding({
    organizationId: params.proposal.organizationId,
    agentCode,
    skillId,
    enabled: params.enableBinding,
  })
  const revision = await createSkillRevision({
    skillId,
    content: params.proposal.proposedContent,
    diff: params.proposal.proposedDiff,
    authorId: params.actorUserId,
    sourceProposalId: params.proposal.id,
  })

  const publishedSkill = await readPublishedSkill({
    organizationId: params.proposal.organizationId,
    skillId,
  })
  if (!publishedSkill) throw new Error('Published skill could not be read after publish')

  return { skill: publishedSkill, revision }
}

async function publishPatchProposal(params: {
  actorUserId: string
  proposal: typeof skillProposal.$inferSelect
  enableBinding: boolean
}): Promise<{ skill: HermesPublishedSkill; revision: SkillRevision }> {
  if (!params.proposal.targetSkillId) throw new Error('Patch proposal is missing targetSkillId')
  if (!params.proposal.proposedContent) {
    throw new Error('Approved patch proposal must include proposedContent before publish')
  }

  const targetSkill = await readPublishedSkill({
    organizationId: params.proposal.organizationId,
    skillId: params.proposal.targetSkillId,
  })
  if (!targetSkill) throw new Error('Skill not found')

  await ensureBaselineRevision({
    skillId: targetSkill.id,
    content: targetSkill.content,
    actorUserId: params.actorUserId,
  })

  const now = new Date()
  await db
    .update(skill)
    .set({
      description: params.proposal.description || targetSkill.description,
      content: params.proposal.proposedContent,
      updatedAt: now,
    })
    .where(eq(skill.id, targetSkill.id))
  await ensureAgentTemplateBinding({
    organizationId: params.proposal.organizationId,
    agentCode: targetSkill.agentCode,
    skillId: targetSkill.id,
    enabled: params.enableBinding,
  })

  const revision = await createSkillRevision({
    skillId: targetSkill.id,
    content: params.proposal.proposedContent,
    diff: params.proposal.proposedDiff,
    authorId: params.actorUserId,
    sourceProposalId: params.proposal.id,
  })
  const publishedSkill = await readPublishedSkill({
    organizationId: params.proposal.organizationId,
    skillId: targetSkill.id,
  })
  if (!publishedSkill) throw new Error('Published skill could not be read after publish')

  return { skill: publishedSkill, revision }
}

export async function publishSkillProposal(params: {
  actorUserId: string
  organizationId: string
  proposalId: string
  enableBinding: boolean
}): Promise<{
  proposal: HermesSkillProposal
  skill: HermesPublishedSkill
  revision: SkillRevision
}> {
  await assertOrganizationAdmin(params.actorUserId, params.organizationId)

  const proposal = await getProposalForOrganization({
    organizationId: params.organizationId,
    proposalId: params.proposalId,
  })
  if (!proposal) throw new Error('Proposal not found')
  if (proposal.status !== 'approved') throw new Error('Proposal must be approved before publish')

  const result =
    proposal.type === 'create'
      ? await publishCreateProposal({
          actorUserId: params.actorUserId,
          proposal,
          enableBinding: params.enableBinding,
        })
      : await publishPatchProposal({
          actorUserId: params.actorUserId,
          proposal,
          enableBinding: params.enableBinding,
        })

  const now = new Date()
  const [publishedProposal] = await db
    .update(skillProposal)
    .set({
      status: 'published',
      reviewerId: proposal.reviewerId ?? params.actorUserId,
      reviewedAt: proposal.reviewedAt ?? now,
      updatedAt: now,
      publishedSkillId: result.skill.id,
    })
    .where(
      and(
        eq(skillProposal.id, proposal.id),
        eq(skillProposal.organizationId, params.organizationId)
      )
    )
    .returning()

  recordAudit({
    actorId: params.actorUserId,
    action: AuditAction.SKILL_UPDATED,
    resourceType: AuditResourceType.SKILL,
    resourceId: result.skill.id,
    resourceName: result.skill.name,
    description: `Published Hermes skill proposal "${proposal.title}"`,
    metadata: {
      organizationId: params.organizationId,
      proposalId: proposal.id,
      revisionVersion: result.revision.version,
      agentCode: result.skill.agentCode,
      workgroupId: result.skill.workgroupId,
      enableBinding: params.enableBinding,
    },
  })

  return {
    proposal: serializeProposal(publishedProposal ?? proposal),
    skill: result.skill,
    revision: result.revision,
  }
}

export async function rollbackSkillRevision(params: {
  actorUserId: string
  organizationId: string
  skillId: string
  version: number
  reason?: string
}): Promise<{ skill: HermesPublishedSkill; revision: SkillRevision }> {
  await assertOrganizationAdmin(params.actorUserId, params.organizationId)

  const targetSkill = await readPublishedSkill({
    organizationId: params.organizationId,
    skillId: params.skillId,
  })
  if (!targetSkill) throw new Error('Skill not found')

  const [targetRevision] = await db
    .select()
    .from(skillRevision)
    .where(
      and(eq(skillRevision.skillId, params.skillId), eq(skillRevision.version, params.version))
    )
    .limit(1)
  if (!targetRevision) throw new Error('Skill revision not found')

  await db
    .update(skill)
    .set({ content: targetRevision.content, updatedAt: new Date() })
    .where(eq(skill.id, params.skillId))

  const revision = await createSkillRevision({
    skillId: params.skillId,
    content: targetRevision.content,
    diff: params.reason?.trim()
      ? `Rollback to version ${params.version}: ${params.reason.trim()}`
      : `Rollback to version ${params.version}`,
    authorId: params.actorUserId,
    rollbackTargetRevisionId: targetRevision.id,
  })
  const rolledBackSkill = await readPublishedSkill({
    organizationId: params.organizationId,
    skillId: params.skillId,
  })
  if (!rolledBackSkill) throw new Error('Rolled back skill could not be read')

  recordAudit({
    actorId: params.actorUserId,
    action: AuditAction.SKILL_UPDATED,
    resourceType: AuditResourceType.SKILL,
    resourceId: params.skillId,
    resourceName: rolledBackSkill.name,
    description: `Rolled back SIM skill "${rolledBackSkill.name}" to revision ${params.version}`,
    metadata: {
      organizationId: params.organizationId,
      rollbackToVersion: params.version,
      rollbackTargetRevisionId: targetRevision.id,
      newRevisionVersion: revision.version,
      reason: params.reason ?? null,
    },
  })

  return { skill: rolledBackSkill, revision }
}

export async function runHermesSkillProposalOperation(body: ParsedHermesSkillProposalRunBody) {
  await assertProposalSourceAccess({ userId: body.userId, organizationId: body.organizationId })

  if (body.operation === 'list_published') {
    const skills = await listPublishedSkills({
      organizationId: body.organizationId,
      agentCode: body.agentCode,
      workgroupId: body.workgroupId,
      limit: body.limit,
    })
    return {
      operation: body.operation,
      answer: `Found ${skills.length} published SIM skill(s).`,
      skills,
    }
  }

  if (body.operation === 'read') {
    const skillRow = await readPublishedSkill({
      organizationId: body.organizationId,
      skillId: body.skillId,
    })
    if (!skillRow) throw new Error('Skill not found')
    return {
      operation: body.operation,
      answer: `Read SIM skill "${skillRow.name}".`,
      skill: skillRow,
    }
  }

  if (body.operation === 'propose_create' || body.operation === 'propose_patch') {
    const proposal = await createProposal({ body })
    return {
      operation: body.operation,
      answer: `Created SIM skill proposal "${proposal.title}" with status ${proposal.status}.`,
      proposal,
    }
  }

  if (body.operation === 'submit_review') {
    const proposal = await submitProposalForReview({ body })
    return {
      operation: body.operation,
      answer: `Submitted SIM skill proposal "${proposal.title}" for review.`,
      proposal,
    }
  }

  const comparison = await compareProposal({ body })
  return {
    operation: body.operation,
    answer: `Prepared comparison for SIM skill proposal ${comparison.proposalId}.`,
    comparison,
  }
}
