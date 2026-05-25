import { describe, expect, it } from 'vitest'
import { selectCanvasLandingTarget } from '@/app/workspace/canvas-landing-target'
import type { Workspace } from '@/hooks/queries/workspace'

function workspace(id: string, overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    name: id,
    ownerId: 'user-1',
    organizationId: 'org-1',
    workspaceMode: 'organization',
    permissions: 'admin',
    ...overrides,
  }
}

describe('selectCanvasLandingTarget', () => {
  const personalCanvas = workspace('personal-canvas', {
    canvasScope: 'personal',
    workgroupId: 'wg-1',
  })
  const teamCanvas = workspace('team-canvas', {
    canvasScope: 'team',
    workgroupId: 'wg-1',
  })
  const legacyCanvas = workspace('legacy-canvas', {
    organizationId: null,
    workspaceMode: 'personal',
  })

  it('keeps the locally recent canvas ahead of the default team canvas', () => {
    expect(
      selectCanvasLandingTarget({
        workspaces: [teamCanvas, personalCanvas],
        workgroups: [{ id: 'wg-1', teamWorkspaceId: teamCanvas.id }],
        defaultWorkgroupId: 'wg-1',
        localRecentWorkspaceId: personalCanvas.id,
        lastActiveWorkspaceId: null,
      })?.id
    ).toBe(personalCanvas.id)
  })

  it('uses the server last-active canvas when no local recent canvas is available', () => {
    expect(
      selectCanvasLandingTarget({
        workspaces: [teamCanvas, personalCanvas],
        workgroups: [{ id: 'wg-1', teamWorkspaceId: teamCanvas.id }],
        defaultWorkgroupId: 'wg-1',
        localRecentWorkspaceId: 'deleted-canvas',
        lastActiveWorkspaceId: personalCanvas.id,
      })?.id
    ).toBe(personalCanvas.id)
  })

  it('falls back to the default workgroup team canvas for first entry', () => {
    expect(
      selectCanvasLandingTarget({
        workspaces: [legacyCanvas, teamCanvas, personalCanvas],
        workgroups: [{ id: 'wg-1', teamWorkspaceId: teamCanvas.id }],
        defaultWorkgroupId: 'wg-1',
        localRecentWorkspaceId: null,
        lastActiveWorkspaceId: null,
      })?.id
    ).toBe(teamCanvas.id)
  })
})
