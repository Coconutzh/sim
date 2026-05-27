'use client'

import type { EdgeProps, EdgeTypes, NodeTypes } from 'reactflow'
import { getBezierPath } from 'reactflow'
import { ContentBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-block'
import { NoteBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block'
import { SubflowNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'

function LiteEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <path
      id={id}
      d={edgePath}
      className='react-flow__edge-path fill-none stroke-[var(--workflow-edge)]'
    />
  )
}

export const liteNodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  noteBlock: NoteBlock,
  contentBlock: ContentBlock,
  subflowNode: SubflowNodeComponent,
}

export const liteEdgeTypes: EdgeTypes = {
  custom: LiteEdge,
  default: LiteEdge,
  workflowEdge: LiteEdge,
}
