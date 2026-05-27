import type { EdgeTypes, NodeTypes } from 'reactflow'
import { ContentBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/content-block'
import { NoteBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/note-block/note-block'
import { SubflowNodeComponent } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'
import { WorkflowBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { WorkflowEdge } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-edge/workflow-edge'

/** Full custom node types for the interactive workflow editor. */
export const fullNodeTypes: NodeTypes = {
  workflowBlock: WorkflowBlock,
  noteBlock: NoteBlock,
  contentBlock: ContentBlock,
  subflowNode: SubflowNodeComponent,
}

/** Full custom edge types for the interactive workflow editor. */
export const fullEdgeTypes: EdgeTypes = {
  custom: WorkflowEdge,
  default: WorkflowEdge,
  workflowEdge: WorkflowEdge,
}
