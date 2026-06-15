'use client'

import type { PointerEvent } from 'react'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type { Node } from 'reactflow'
import { useReactFlow, useViewport } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/core/utils/cn'
import {
  getMinimapNodeRects,
  getMinimapSceneBounds,
  getMinimapTransform,
  getViewportForMinimapPoint,
  projectRectToMinimap,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-minimap/workflow-minimap-geometry'
import { getVisibleCanvasBounds, getVisibleFlowRect } from '@/hooks/use-canvas-viewport'
import { usePanelStore } from '@/stores/panel/store'
import { useSidebarStore } from '@/stores/sidebar/store'
import { useTerminalStore } from '@/stores/terminal'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const MINIMAP_SIZE = {
  width: 200,
  height: 128,
  padding: 12,
} as const

interface WorkflowMinimapProps {
  nodes: Node[]
}

function WorkflowMinimapComponent({ nodes }: WorkflowMinimapProps) {
  const reactFlowInstance = useReactFlow()
  const viewport = useViewport()
  const blocks = useWorkflowStore((state) => state.blocks)
  const [resizeTick, setResizeTick] = useState(0)

  useSidebarStore(
    useShallow((state) => ({
      sidebarWidth: state.sidebarWidth,
      isCollapsed: state.isCollapsed,
    }))
  )
  usePanelStore((state) => state.panelWidth)
  useTerminalStore((state) => state.terminalHeight)

  useEffect(() => {
    const handleResize = () => setResizeTick((tick) => tick + 1)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const liveNodes = reactFlowInstance.getNodes()
  const nodesForMinimap = liveNodes.length > 0 ? liveNodes : nodes

  const minimapData = useMemo(() => {
    const nodeRects = getMinimapNodeRects(nodesForMinimap, blocks)
    if (nodeRects.length === 0) return null

    const visibleBounds = getVisibleCanvasBounds()
    const visibleFlowRect = getVisibleFlowRect(viewport, visibleBounds)
    const sceneBounds = getMinimapSceneBounds(nodeRects, visibleFlowRect)
    if (!sceneBounds) return null

    const transform = getMinimapTransform(sceneBounds, MINIMAP_SIZE)
    if (!transform) return null

    const viewportRect = visibleFlowRect ? projectRectToMinimap(visibleFlowRect, transform) : null

    return {
      transform,
      nodeRects: nodeRects.map((rect) => projectRectToMinimap(rect, transform)),
      viewportRect,
    }
  }, [blocks, nodesForMinimap, viewport, resizeTick])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.button !== 0 || !minimapData) return

      const rect = event.currentTarget.getBoundingClientRect()
      const visibleBounds = getVisibleCanvasBounds()
      const nextViewport = getViewportForMinimapPoint(
        {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        },
        minimapData.transform,
        viewport,
        visibleBounds
      )

      if (!nextViewport) return

      reactFlowInstance.setViewport(nextViewport, { duration: 180 })
    },
    [minimapData, reactFlowInstance, viewport]
  )

  if (!minimapData || minimapData.nodeRects.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        'nodrag nopan absolute bottom-[60px] left-[16px] z-10 hidden h-[128px] w-[200px] cursor-crosshair overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)] shadow-lg sm:block'
      )}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className='pointer-events-none absolute inset-x-0 top-[26px] h-px bg-[var(--border)]' />
      <div className='pointer-events-none absolute inset-x-0 bottom-[24px] h-px bg-[var(--border)]' />

      {minimapData.nodeRects.map((rect, index) => (
        <div
          key={`${index}-${rect.x}-${rect.y}`}
          className='pointer-events-none absolute rounded-[1px] bg-[var(--surface-7)]'
          style={{
            transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`,
            width: Math.max(2, rect.width),
            height: Math.max(2, rect.height),
          }}
        />
      ))}

      {minimapData.viewportRect && (
        <div
          className='pointer-events-none absolute rounded-[2px] border border-[var(--text-secondary)] bg-[var(--surface-2)]/35'
          style={{
            transform: `translate3d(${minimapData.viewportRect.x}px, ${minimapData.viewportRect.y}px, 0)`,
            width: Math.max(6, minimapData.viewportRect.width),
            height: Math.max(6, minimapData.viewportRect.height),
          }}
        />
      )}
    </div>
  )
}

export const WorkflowMinimap = memo(WorkflowMinimapComponent)
