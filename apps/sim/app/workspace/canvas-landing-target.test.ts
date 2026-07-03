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

  it('corrects stale lighting recency to the director team canvas in the same project', () => {
    const directorCanvas = workspace('director-canvas', {
      canvasScope: 'team',
      workgroupId: 'wg-director',
    })
    const lightingCanvas = workspace('lighting-canvas', {
      canvasScope: 'team',
      workgroupId: 'wg-lighting',
    })

    expect(
      selectCanvasLandingTarget({
        workspaces: [lightingCanvas, directorCanvas],
        workgroups: [
          {
            id: 'wg-lighting',
            organizationId: 'org-1',
            teamWorkspaceId: lightingCanvas.id,
            discipline: { code: 'lighting_sound', agentCode: 'lighting_sound' },
          },
          {
            id: 'wg-director',
            organizationId: 'org-1',
            teamWorkspaceId: directorCanvas.id,
            discipline: { code: 'chief_director', agentCode: 'chief_director' },
          },
        ],
        defaultWorkgroupId: 'wg-lighting',
        localRecentWorkspaceId: lightingCanvas.id,
        lastActiveWorkspaceId: lightingCanvas.id,
      })?.id
    ).toBe(directorCanvas.id)
  })

  it('keeps default fallback scoped to the default workgroup project', () => {
    const projectADirectorCanvas = workspace('project-a-director-canvas', {
      organizationId: 'org-a',
      canvasScope: 'team',
      workgroupId: 'wg-project-a-director',
    })
    const projectBLightingCanvas = workspace('project-b-lighting-canvas', {
      organizationId: 'org-b',
      canvasScope: 'team',
      workgroupId: 'wg-project-b-lighting',
    })

    expect(
      selectCanvasLandingTarget({
        workspaces: [projectADirectorCanvas, projectBLightingCanvas],
        workgroups: [
          {
            id: 'wg-project-a-director',
            organizationId: 'org-a',
            teamWorkspaceId: projectADirectorCanvas.id,
            discipline: { code: 'chief_director', agentCode: 'chief_director' },
          },
          {
            id: 'wg-project-b-lighting',
            organizationId: 'org-b',
            teamWorkspaceId: projectBLightingCanvas.id,
            discipline: { code: 'lighting_sound', agentCode: 'lighting_sound' },
          },
        ],
        defaultWorkgroupId: 'wg-project-b-lighting',
        localRecentWorkspaceId: null,
        lastActiveWorkspaceId: null,
      })?.id
    ).toBe(projectBLightingCanvas.id)
  })
})
