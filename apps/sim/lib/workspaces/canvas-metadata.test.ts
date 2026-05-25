/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  deriveWorkspaceCanvasCreationCapabilities,
  mergeWorkspaceCanvasMetadata,
} from '@/lib/workspaces/canvas-metadata'

describe('mergeWorkspaceCanvasMetadata', () => {
  it('marks personal canvas workspace rows with their owning workgroup and discipline', () => {
    const [workspace] = mergeWorkspaceCanvasMetadata(
      [{ id: 'ws-personal', name: 'Personal Draft', workgroupId: null }],
      {
        personalWorkspaces: [{ workspaceId: 'ws-personal', workgroupId: 'wg-stage' }],
        workgroups: [{ id: 'wg-stage', disciplineId: 'discipline-stage' }],
      }
    )

    expect(workspace).toMatchObject({
      id: 'ws-personal',
      canvasScope: 'personal',
      workgroupId: 'wg-stage',
      disciplineId: 'discipline-stage',
      isInternalWorkspace: true,
    })
  })

  it('marks team canvas workspace rows from the workspace workgroup id', () => {
    const [workspace] = mergeWorkspaceCanvasMetadata(
      [{ id: 'ws-team', name: 'Team Canvas', workgroupId: 'wg-visual' }],
      {
        personalWorkspaces: [],
        workgroups: [{ id: 'wg-visual', disciplineId: 'discipline-visual' }],
      }
    )

    expect(workspace).toMatchObject({
      id: 'ws-team',
      canvasScope: 'team',
      workgroupId: 'wg-visual',
      disciplineId: 'discipline-visual',
      isInternalWorkspace: true,
    })
  })

  it('leaves legacy workspace rows explicitly outside the collaboration canvas scopes', () => {
    const [workspace] = mergeWorkspaceCanvasMetadata(
      [{ id: 'ws-legacy', name: 'Legacy Workspace' }],
      {
        personalWorkspaces: [],
        workgroups: [],
      }
    )

    expect(workspace).toMatchObject({
      id: 'ws-legacy',
      canvasScope: null,
      workgroupId: null,
      disciplineId: null,
      isInternalWorkspace: false,
    })
  })
})

describe('deriveWorkspaceCanvasCreationCapabilities', () => {
  it('allows personal draft canvas creation for any active workgroup member', () => {
    expect(
      deriveWorkspaceCanvasCreationCapabilities([{ role: 'member', teamWorkspaceId: 'ws-team' }])
    ).toEqual({
      canCreatePersonalCanvas: true,
      canCreateTeamCanvas: false,
    })
  })

  it('allows team canvas creation only for admins of workgroups without a team canvas', () => {
    expect(
      deriveWorkspaceCanvasCreationCapabilities([
        { role: 'member', teamWorkspaceId: null },
        { role: 'admin', teamWorkspaceId: 'ws-existing-team' },
        { role: 'admin', teamWorkspaceId: null },
      ])
    ).toEqual({
      canCreatePersonalCanvas: true,
      canCreateTeamCanvas: true,
    })
  })

  it('blocks canvas creation capabilities when the user has no active workgroup memberships', () => {
    expect(deriveWorkspaceCanvasCreationCapabilities([])).toEqual({
      canCreatePersonalCanvas: false,
      canCreateTeamCanvas: false,
    })
  })
})
