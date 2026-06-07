import {
  CONTENT_REFERENCE_EDGE_KIND,
  CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX,
  CONTENT_REFERENCE_TARGET_HANDLE_PREFIX,
} from '@/lib/workflows/content-reference-edges'
import { validateEdges } from '@/stores/workflows/workflow/edge-validation'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'

export interface NormalizationResult {
  state: WorkflowState
  warnings: string[]
}

function isContainerType(type: string | undefined): boolean {
  return type === 'loop' || type === 'parallel'
}

function hasContentReferenceHandles(edge: {
  sourceHandle?: string | null
  targetHandle?: string | null
}): boolean {
  return (
    typeof edge.sourceHandle === 'string' &&
    edge.sourceHandle.startsWith(CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX) &&
    typeof edge.targetHandle === 'string' &&
    edge.targetHandle.startsWith(CONTENT_REFERENCE_TARGET_HANDLE_PREFIX)
  )
}

export function normalizeWorkflowState(workflowState: WorkflowState): NormalizationResult {
  const warnings: string[] = []
  const blocks = structuredClone(workflowState.blocks || {})

  for (const [blockId, block] of Object.entries(blocks)) {
    if (!block?.type || !block?.name) {
      warnings.push(`Dropped invalid block "${blockId}" because it is missing type or name`)
      delete blocks[blockId]
    }
  }

  for (const [blockId, block] of Object.entries(blocks)) {
    const parentId = block.data?.parentId
    if (!parentId) {
      continue
    }

    const parentBlock = blocks[parentId]
    const parentIsValidContainer = Boolean(parentBlock && isContainerType(parentBlock.type))

    if (!parentIsValidContainer || parentId === blockId) {
      warnings.push(`Cleared invalid parentId for block "${blockId}"`)
      block.data = {
        ...(block.data || {}),
        parentId: undefined,
        extent: undefined,
      }
      continue
    }

    if (block.data?.extent !== 'parent') {
      block.data = {
        ...(block.data || {}),
        extent: 'parent',
      }
    }
  }

  const normalizedEdges = (workflowState.edges || []).map((edge) => {
    if (
      hasContentReferenceHandles(edge) &&
      blocks[edge.source]?.type === 'content' &&
      blocks[edge.target]?.type === 'content'
    ) {
      return {
        ...edge,
        type: edge.type === 'workflowEdge' ? edge.type : 'workflowEdge',
        data: {
          ...(edge.data || {}),
          kind: CONTENT_REFERENCE_EDGE_KIND,
        },
      }
    }

    return edge
  })

  const edgeValidation = validateEdges(normalizedEdges, blocks)
  warnings.push(
    ...edgeValidation.dropped.map(({ edge, reason }) => `Dropped edge "${edge.id}": ${reason}`)
  )

  return {
    state: {
      ...workflowState,
      blocks,
      edges: edgeValidation.valid,
      loops: generateLoopBlocks(blocks),
      parallels: generateParallelBlocks(blocks),
    },
    warnings,
  }
}
