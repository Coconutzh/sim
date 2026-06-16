/**
 * @vitest-environment node
 */
import type { Node } from 'reactflow'
import { describe, expect, it } from 'vitest'
import {
  getMinimapNodeRects,
  getMinimapNodeSize,
  getMinimapSceneBounds,
  getMinimapTransform,
  getRectBounds,
  getViewportForMinimapPoint,
  projectRectToMinimap,
  unprojectPointFromMinimap,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-minimap/workflow-minimap-geometry'
import { getVisibleFlowRect } from '@/hooks/use-canvas-viewport'
import type { BlockState } from '@/stores/workflows/workflow/types'

function createNode(id: string, position: { x: number; y: number }, options?: Partial<Node>): Node {
  return {
    id,
    type: 'workflowBlock',
    position,
    data: {},
    ...options,
  } as Node
}

describe('workflow minimap geometry', () => {
  it('returns no bounds for an empty canvas', () => {
    expect(getMinimapNodeRects([], {})).toEqual([])
    expect(getRectBounds([])).toBeNull()
  })

  it('uses container data dimensions and nested absolute positions', () => {
    const nodes = [
      createNode(
        'loop-1',
        { x: 100, y: 200 },
        {
          type: 'subflowNode',
          data: { width: 600, height: 360 },
        }
      ),
      createNode('child-1', { x: 24, y: 36 }),
    ]
    const blocks = {
      'loop-1': {
        id: 'loop-1',
        type: 'loop',
        name: 'Loop',
        position: { x: 100, y: 200 },
        data: { width: 600, height: 360 },
        enabled: true,
      },
      'child-1': {
        id: 'child-1',
        type: 'function',
        name: 'Function',
        position: { x: 24, y: 36 },
        data: { parentId: 'loop-1' },
        enabled: true,
      },
    } as Record<string, BlockState>

    const rects = getMinimapNodeRects(nodes, blocks)

    expect(rects).toEqual([
      { x: 100, y: 200, width: 600, height: 360 },
      { x: 140, y: 302, width: 250, height: 100 },
    ])
  })

  it('falls back to block layout dimensions for regular nodes', () => {
    const node = createNode('text-1', { x: 0, y: 0 })
    const block = {
      id: 'text-1',
      type: 'content',
      name: 'Text',
      position: { x: 0, y: 0 },
      data: {},
      layout: { measuredWidth: 420, measuredHeight: 260 },
      enabled: true,
    } as BlockState

    expect(getMinimapNodeSize(node, block)).toEqual({ width: 420, height: 260 })
  })

  it('projects node and viewport rectangles through the same transform', () => {
    const transform = getMinimapTransform(
      { x: 100, y: 200, width: 400, height: 200 },
      { width: 200, height: 128, padding: 12 }
    )

    expect(transform).toEqual({ scale: 0.44, offsetX: -32, offsetY: -68 })
    expect(projectRectToMinimap({ x: 100, y: 200, width: 200, height: 100 }, transform!)).toEqual({
      x: 12,
      y: 20,
      width: 88,
      height: 44,
    })

    const visibleFlowRect = getVisibleFlowRect(
      { x: -80, y: -120, zoom: 0.5 },
      { width: 300, height: 180, offsetLeft: 40, offsetRight: 0, offsetBottom: 0 }
    )

    expect(visibleFlowRect).toEqual({ x: 240, y: 240, width: 600, height: 360 })
    expect(projectRectToMinimap(visibleFlowRect!, transform!)).toEqual({
      x: 73.6,
      y: 37.599999999999994,
      width: 264,
      height: 158.4,
    })
  })

  it('expands the minimap scene to include blank visible canvas area', () => {
    const nodeRects = [{ x: 100, y: 100, width: 100, height: 80 }]
    const sceneBounds = getMinimapSceneBounds(nodeRects, {
      x: 600,
      y: 220,
      width: 300,
      height: 200,
    })

    expect(sceneBounds).toEqual({ x: 100, y: 100, width: 800, height: 320 })

    const transform = getMinimapTransform(sceneBounds!, { width: 200, height: 128, padding: 12 })
    expect(transform).toEqual({ scale: 0.22, offsetX: -10, offsetY: 6.799999999999997 })
    expect(projectRectToMinimap(nodeRects[0], transform!)).toEqual({
      x: 12,
      y: 28.799999999999997,
      width: 22,
      height: 17.6,
    })
  })

  it('maps minimap clicks back to a centered React Flow viewport', () => {
    const transform = { scale: 0.5, offsetX: -20, offsetY: 10 }

    expect(unprojectPointFromMinimap({ x: 80, y: 60 }, transform)).toEqual({
      x: 200,
      y: 100,
    })

    expect(
      getViewportForMinimapPoint(
        { x: 80, y: 60 },
        transform,
        { x: -50, y: -25, zoom: 0.75 },
        { width: 400, height: 200, offsetLeft: 30 }
      )
    ).toEqual({
      x: 80,
      y: 25,
      zoom: 0.75,
    })
  })
})
