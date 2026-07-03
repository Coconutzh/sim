/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { WorkgroupSummary } from '@/lib/api/contracts/collaboration'
import { buildProjectWorkspaceEntries } from '@/app/workspace/[workspaceId]/lite-canvas-projects'

function workgroup(overrides: Partial<WorkgroupSummary> = {}): WorkgroupSummary {
  const id = overrides.id ?? 'wg-director'
  const organizationId = overrides.organizationId ?? 'org-1'
  return {
    id,
    name: overrides.name ?? '导演组',
    organizationId,
    organization: {
      id: organizationId,
      name: '制作协作测试组织',
      logo: null,
      projectStatus: 'active',
      estimatedDueAt: null,
      phases: [],
      canManageProject: false,
      taskStats: { completed: 0, total: 0, unfinished: 0 },
      ...overrides.organization,
    },
    discipline: {
      id: 'discipline_chief_director',
      code: 'chief_director',
      name: '总导演',
      agentCode: 'chief_director',
      ...overrides.discipline,
    },
    role: overrides.role ?? 'admin',
    teamWorkspaceId: overrides.teamWorkspaceId ?? `${id}-workspace`,
    memberCount: overrides.memberCount ?? 1,
  }
}

describe('buildProjectWorkspaceEntries', () => {
  it('keeps a director workgroup as the project entry even if the stale active workgroup is lighting', () => {
    const entries = buildProjectWorkspaceEntries({
      defaultWorkgroupId: 'wg-lighting',
      fallbackWorkspaceId: 'fallback-workspace',
      workgroups: [
        workgroup({
          id: 'wg-director',
          name: '导演组',
          teamWorkspaceId: 'director-workspace',
        }),
        workgroup({
          id: 'wg-lighting',
          name: '灯光音响组',
          discipline: {
            id: 'discipline_lighting_sound',
            code: 'lighting_sound',
            name: '灯光/音响团队',
            agentCode: 'lighting_sound',
          },
          role: 'member',
          teamWorkspaceId: 'lighting-workspace',
        }),
      ],
    })

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      primaryWorkgroupId: 'wg-director',
      primaryWorkgroupName: '导演组',
      disciplineName: '总导演',
      teamWorkspaceId: 'director-workspace',
      href: '/workspace/director-workspace/w',
      teamCount: 2,
    })
  })

  it('uses the default workgroup when the user only has non-director roles in a project', () => {
    const entries = buildProjectWorkspaceEntries({
      defaultWorkgroupId: 'wg-stage',
      fallbackWorkspaceId: 'fallback-workspace',
      workgroups: [
        workgroup({
          id: 'wg-lighting',
          name: '灯光音响组',
          discipline: {
            id: 'discipline_lighting_sound',
            code: 'lighting_sound',
            name: '灯光/音响团队',
            agentCode: 'lighting_sound',
          },
          role: 'admin',
          teamWorkspaceId: 'lighting-workspace',
        }),
        workgroup({
          id: 'wg-stage',
          name: '舞美组',
          discipline: {
            id: 'discipline_stage_design',
            code: 'stage_design',
            name: '舞美师',
            agentCode: 'stage_design',
          },
          role: 'member',
          teamWorkspaceId: 'stage-workspace',
        }),
      ],
    })

    expect(entries[0]).toMatchObject({
      primaryWorkgroupId: 'wg-stage',
      primaryWorkgroupName: '舞美组',
      teamWorkspaceId: 'stage-workspace',
    })
  })

  it('treats PMO as a director-like project entry', () => {
    const entries = buildProjectWorkspaceEntries({
      defaultWorkgroupId: 'wg-lighting',
      fallbackWorkspaceId: 'fallback-workspace',
      workgroups: [
        workgroup({
          id: 'wg-lighting',
          name: '灯光音响组',
          discipline: {
            id: 'discipline_lighting_sound',
            code: 'lighting_sound',
            name: '灯光/音响团队',
            agentCode: 'lighting_sound',
          },
          teamWorkspaceId: 'lighting-workspace',
        }),
        workgroup({
          id: 'wg-pmo',
          name: '项目总控',
          discipline: {
            id: 'discipline_pmo',
            code: 'pmo',
            name: '项目总控/PMO',
            agentCode: 'chief_director',
          },
          teamWorkspaceId: 'pmo-workspace',
        }),
      ],
    })

    expect(entries[0]).toMatchObject({
      primaryWorkgroupId: 'wg-pmo',
      teamWorkspaceId: 'pmo-workspace',
    })
  })
})
