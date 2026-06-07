import { db } from '@sim/db'
import { agentSkillBinding, skill } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type { LocalAgentSkill } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

interface AgentSkillBindingRow {
  id: string
  name: string
  description: string
  content: string
  enabled: boolean
  scope: 'agent_template' | 'team_override'
  workgroupId: string | null
}

export function mergeAgentSkillRows(params: {
  rows: AgentSkillBindingRow[]
  workgroupId: string
}): LocalAgentSkill[] {
  const merged = new Map<string, LocalAgentSkill>()
  for (const row of params.rows.filter(
    (item) => item.scope === 'agent_template' && item.workgroupId === null
  )) {
    if (row.enabled) {
      merged.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        content: row.content,
        enabled: true,
        source: 'agent_template',
      })
    }
  }

  for (const row of params.rows.filter(
    (item) => item.scope === 'team_override' && item.workgroupId === params.workgroupId
  )) {
    if (row.enabled) {
      merged.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        content: row.content,
        enabled: true,
        source: 'team_override',
      })
    } else {
      merged.delete(row.id)
    }
  }

  return [...merged.values()]
}

export async function loadEnabledAgentSkills(params: {
  organizationId: string
  agentCode: string
  workgroupId: string
  teamWorkspaceId: string | null
}): Promise<LocalAgentSkill[]> {
  if (!params.teamWorkspaceId) return []

  const rows = await db
    .select({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      enabled: agentSkillBinding.enabled,
      scope: agentSkillBinding.scope,
      workgroupId: agentSkillBinding.workgroupId,
    })
    .from(agentSkillBinding)
    .innerJoin(skill, eq(agentSkillBinding.skillId, skill.id))
    .where(
      and(
        eq(agentSkillBinding.organizationId, params.organizationId),
        eq(agentSkillBinding.agentCode, params.agentCode),
        eq(skill.workspaceId, params.teamWorkspaceId)
      )
    )

  return mergeAgentSkillRows({ rows, workgroupId: params.workgroupId })
}
