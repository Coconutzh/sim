/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getWorkspaceCanvasKindLabel, getWorkspaceCanvasSearchValue } from './utils'

describe('search modal canvas labels', () => {
  it('labels personal and team workspace rows as canvases', () => {
    expect(
      getWorkspaceCanvasKindLabel({
        id: 'ws-personal',
        name: 'Actor notes',
        href: '/workspace/ws-personal/w',
        canvasScope: 'personal',
        isInternalWorkspace: true,
      })
    ).toBe('Personal draft canvas')

    expect(
      getWorkspaceCanvasKindLabel({
        id: 'ws-team',
        name: 'Stage Team',
        href: '/workspace/ws-team/w',
        canvasScope: 'team',
        isInternalWorkspace: true,
      })
    ).toBe('Team canvas')
  })

  it('keeps legacy workspace rows searchable through canvas language', () => {
    const searchValue = getWorkspaceCanvasSearchValue({
      id: 'ws-legacy',
      name: 'Imported Workspace',
      href: '/workspace/ws-legacy/w',
      canvasScope: null,
      isInternalWorkspace: false,
    })

    expect(searchValue).toContain('Legacy canvas')
    expect(searchValue).toContain('canvas-ws-legacy')
    expect(searchValue).not.toContain('workspace-ws-legacy')
  })
})
