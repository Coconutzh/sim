import { db } from '@sim/db'
import {
  agentProfile,
  discipline,
  organizationAgentTemplate,
  personalCanvasWorkspace,
  workgroup,
  workspace,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { getAgentProfile } from '@/lib/collaboration/definitions'
import { assertWorkgroupMember } from '@/lib/collaboration/service'
import type { LocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const logger = createLogger('LocalCanvasAgentProfile')
const INTERNAL_FALLBACK_AGENT_CODE = 'local_canvas_agent'
const INTERNAL_FALLBACK_DISCIPLINE_CODE = 'canvas_runtime'

const GENERIC_CANVAS_AGENT_PROMPT = [
  'You are a local canvas agent embedded in the Sim workflow canvas.',
  'Help the user understand and safely edit the current canvas.',
  'Use any resolved agent profile only as internal domain context.',
  'Do not role-play, introduce yourself as an agent persona, or speak as a director unless the user explicitly asks for that style.',
].join('\n')
const LOCAL_CANVAS_RUNTIME_GUARD = [
  'Local canvas runtime guard:',
  'The resolved discipline and agent profile are internal capability context.',
  'User-facing replies must not introduce the agent persona, address a team, or speak as chief director/director unless the user explicitly asks for that voice.',
].join('\n')

function withLocalCanvasRuntimeGuard(systemPrompt: string): string {
  return [systemPrompt.trim(), LOCAL_CANVAS_RUNTIME_GUARD].filter(Boolean).join('\n\n')
}

export async function loadWorkgroupAgentProfile(params: {
  userId: string
  workspaceId: string
}): Promise<Pick<LocalAgentContext, 'agent' | 'discipline' | 'workgroup'>> {
  const [personalRow] = await db
    .select({ workgroupId: personalCanvasWorkspace.workgroupId })
    .from(personalCanvasWorkspace)
    .where(
      and(
        eq(personalCanvasWorkspace.workspaceId, params.workspaceId),
        eq(personalCanvasWorkspace.userId, params.userId)
      )
    )
    .limit(1)

  const [workspaceRow] = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      organizationId: workspace.organizationId,
      workgroupId: workspace.workgroupId,
    })
    .from(workspace)
    .where(eq(workspace.id, params.workspaceId))
    .limit(1)
  if (!workspaceRow) throw new Error('Workspace not found')

  const workgroupId = personalRow?.workgroupId ?? workspaceRow?.workgroupId
  if (!workgroupId) {
    logger.warn('Workspace is not attached to a workgroup, using local canvas fallback agent', {
      workspaceId: params.workspaceId,
    })

    return {
      agent: {
        code: INTERNAL_FALLBACK_AGENT_CODE,
        name: 'Canvas Agent',
        description: 'Local canvas assistant',
        systemPrompt: withLocalCanvasRuntimeGuard(GENERIC_CANVAS_AGENT_PROMPT),
      },
      discipline: {
        id: '',
        code: INTERNAL_FALLBACK_DISCIPLINE_CODE,
        name: 'Canvas Runtime',
      },
      workgroup: {
        id: '',
        name: workspaceRow.name,
        organizationId: workspaceRow.organizationId ?? '',
        teamWorkspaceId: null,
      },
    }
  }
  await assertWorkgroupMember(params.userId, workgroupId)

  const [row] = await db
    .select({
      workgroupId: workgroup.id,
      workgroupName: workgroup.name,
      organizationId: workgroup.organizationId,
      teamWorkspaceId: workgroup.teamWorkspaceId,
      disciplineId: discipline.id,
      disciplineCode: discipline.code,
      disciplineName: discipline.name,
      disciplineAgentCode: discipline.agentCode,
    })
    .from(workgroup)
    .leftJoin(discipline, eq(workgroup.disciplineId, discipline.id))
    .where(eq(workgroup.id, workgroupId))
    .limit(1)

  if (!row) throw new Error('Workgroup not found')
  if (!row.disciplineAgentCode) {
    logger.warn('Workgroup has no discipline agent code, using local canvas fallback agent', {
      workgroupId,
    })
  }

  const fallbackAgent = row.disciplineAgentCode ? getAgentProfile(row.disciplineAgentCode) : null
  const [dbAgent] = await db
    .select({
      code: agentProfile.code,
      name: agentProfile.name,
      description: agentProfile.description,
      systemPrompt: agentProfile.defaultSystemPrompt,
    })
    .from(agentProfile)
    .where(eq(agentProfile.code, fallbackAgent?.code ?? INTERNAL_FALLBACK_AGENT_CODE))
    .limit(1)

  const [template] = row.disciplineAgentCode
    ? await db
        .select({ projectInstructions: organizationAgentTemplate.projectInstructions })
        .from(organizationAgentTemplate)
        .where(
          and(
            eq(organizationAgentTemplate.organizationId, row.organizationId),
            eq(organizationAgentTemplate.agentCode, row.disciplineAgentCode)
          )
        )
        .limit(1)
    : []

  const basePrompt =
    dbAgent?.systemPrompt ?? fallbackAgent?.defaultSystemPrompt ?? GENERIC_CANVAS_AGENT_PROMPT
  const projectInstructions = template?.projectInstructions?.trim()
  const systemPrompt = row.disciplineAgentCode ? basePrompt : GENERIC_CANVAS_AGENT_PROMPT
  const resolvedAgentCode =
    row.disciplineAgentCode && (dbAgent?.code || fallbackAgent?.code)
      ? (dbAgent?.code ?? fallbackAgent?.code ?? row.disciplineAgentCode)
      : INTERNAL_FALLBACK_AGENT_CODE
  const resolvedAgentName =
    row.disciplineAgentCode && (dbAgent?.name || fallbackAgent?.name)
      ? (dbAgent?.name ?? fallbackAgent?.name ?? 'Canvas Agent')
      : 'Canvas Agent'
  const resolvedAgentDescription =
    row.disciplineAgentCode && (dbAgent?.description || fallbackAgent?.description)
      ? (dbAgent?.description ?? fallbackAgent?.description ?? 'Local canvas assistant')
      : 'Local canvas assistant'

  return {
    agent: {
      code: resolvedAgentCode,
      name: resolvedAgentName,
      description: resolvedAgentDescription,
      systemPrompt: withLocalCanvasRuntimeGuard(
        projectInstructions
          ? `${systemPrompt}\n\nProject instructions:\n${projectInstructions}`
          : systemPrompt
      ),
    },
    discipline: {
      id: row.disciplineId ?? '',
      code: row.disciplineCode ?? INTERNAL_FALLBACK_DISCIPLINE_CODE,
      name: row.disciplineName ?? 'Canvas Runtime',
    },
    workgroup: {
      id: row.workgroupId,
      name: row.workgroupName,
      organizationId: row.organizationId,
      teamWorkspaceId: row.teamWorkspaceId,
    },
  }
}
