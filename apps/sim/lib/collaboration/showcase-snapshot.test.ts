/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { publicationDetailSchema } from '@/lib/api/contracts/collaboration'
import {
  createReadOnlyShowcaseCanvasModel,
  SHOWCASE_READ_ONLY_CANVAS_MODE,
} from '@/lib/collaboration/showcase-snapshot'

const validSnapshot = {
  blocks: {
    'block-1': {
      id: 'block-1',
      type: 'agent',
      name: 'Director Agent',
      position: { x: 120, y: 80 },
      subBlocks: {},
      outputs: {},
      enabled: true,
    },
    'block-2': {
      id: 'block-2',
      type: 'api',
      name: 'Stage API',
      position: { x: 420, y: 80 },
      subBlocks: {},
      outputs: {},
      enabled: true,
    },
  },
  edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2' }],
}

describe('showcase snapshot canvas', () => {
  it('normalizes publication snapshots into read-only workflow state', () => {
    const model = createReadOnlyShowcaseCanvasModel(validSnapshot)

    expect(model.isRenderable).toBe(true)
    expect(model.blockCount).toBe(2)
    expect(model.edgeCount).toBe(1)
    expect(model.workflowState?.loops).toEqual({})
    expect(model.workflowState?.parallels).toEqual({})
  })

  it('keeps invalid snapshots non-renderable without losing diagnostics counts', () => {
    const model = createReadOnlyShowcaseCanvasModel({
      blocks: { legacy: { id: 'legacy' } },
      edges: ['legacy-edge'],
    })

    expect(model.isRenderable).toBe(false)
    expect(model.workflowState).toBeNull()
    expect(model.blockCount).toBe(1)
    expect(model.edgeCount).toBe(1)
  })

  it('declares showcase canvas mode as read-only', () => {
    expect(SHOWCASE_READ_ONLY_CANVAS_MODE).toMatchObject({
      mode: 'read-only',
      reason: expect.any(String),
    })
  })

  it('strips writable source identifiers from publication detail responses', () => {
    const detail = publicationDetailSchema.parse({
      id: 'publication-1',
      title: 'Published Plan',
      description: null,
      sourceWorkgroup: { id: 'workgroup-1', name: 'Lighting' },
      sourceDiscipline: { code: 'lighting_sound', name: '灯光音响' },
      agentCode: 'lighting_sound',
      versionNumber: 1,
      status: 'published',
      visibility: 'organization',
      parentVersionId: null,
      snapshotState: validSnapshot,
      snapshotMetadata: { sourceWorkflowName: 'Team Draft' },
      publishedAt: new Date('2026-05-21T00:00:00.000Z').toISOString(),
      sourceWorkflowId: 'writable-workflow-1',
      sourceWorkspaceId: 'writable-workspace-1',
      teamWorkspaceId: 'team-workspace-1',
    })

    expect('sourceWorkflowId' in detail).toBe(false)
    expect('sourceWorkspaceId' in detail).toBe(false)
    expect('teamWorkspaceId' in detail).toBe(false)
  })
})
