import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import type { Node } from 'reactflow'
import { useReactFlow } from 'reactflow'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import {
  calculateContainerDimensions,
  clampPositionToContainer,
  estimateBlockDimensions,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/node-position-utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('NodeUtilities')

const CONTAINER_HEADER_HEIGHT = 50
const CONTAINER_LEFT_PADDING = 16
const CONTAINER_TOP_PADDING = 16

type GeometryBlockRecord = Record<
  string,
  {
    type?: string
    data?: {
      parentId?: string
      width?: number
      height?: number
    }
    height?: number
  }
>

interface ContainerHit {
  loopId: string
  loopPosition: { x: number; y: number }
  dimensions: { width: number; height: number }
}

interface NodeGeometrySnapshot {
  nodeById: Map<string, Node>
  getNodeDepth: (nodeId: string, maxDepth?: number) => number
  getNodeHierarchy: (nodeId: string, maxDepth?: number) => string[]
  isDescendantOf: (ancestorId: string, nodeId: string) => boolean
  getNodeAbsolutePosition: (nodeId: string) => { x: number; y: number }
  getContainingContainers: (position: { x: number; y: number }, isContainerType: (type: string) => boolean) => ContainerHit[]
}

export function createNodeGeometrySnapshot(
  nodes: Node[],
  blocks: GeometryBlockRecord
): NodeGeometrySnapshot {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const depthCache = new Map<string, number>()
  const hierarchyCache = new Map<string, string[]>()
  const absolutePositionCache = new Map<string, { x: number; y: number }>()

  const getParentId = (nodeId: string): string | undefined => blocks[nodeId]?.data?.parentId

  const getNodeDepth = (nodeId: string, maxDepth = 100, visited = new Set<string>()): number => {
    const cached = depthCache.get(nodeId)
    if (cached !== undefined) return cached

    const node = nodeById.get(nodeId)
    const parentId = getParentId(nodeId)
    if (!node || !parentId || maxDepth <= 0 || visited.has(nodeId)) {
      return 0
    }

    visited.add(nodeId)
    const depth = 1 + getNodeDepth(parentId, maxDepth - 1, visited)
    depthCache.set(nodeId, depth)
    return depth
  }

  const getNodeHierarchy = (
    nodeId: string,
    maxDepth = 100,
    visited = new Set<string>()
  ): string[] => {
    const cached = hierarchyCache.get(nodeId)
    if (cached) return cached

    const node = nodeById.get(nodeId)
    const parentId = getParentId(nodeId)
    if (!node || maxDepth <= 0 || visited.has(nodeId)) {
      return [nodeId]
    }

    if (!parentId) {
      const hierarchy = [nodeId]
      hierarchyCache.set(nodeId, hierarchy)
      return hierarchy
    }

    visited.add(nodeId)
    const hierarchy = [...getNodeHierarchy(parentId, maxDepth - 1, visited), nodeId]
    hierarchyCache.set(nodeId, hierarchy)
    return hierarchy
  }

  const isDescendantOf = (ancestorId: string, nodeId: string): boolean => {
    const visited = new Set<string>()
    let currentId: string | undefined = nodeId
    let depth = 0

    while (currentId && depth < 100) {
      if (currentId === ancestorId) return true
      if (visited.has(currentId)) return false
      visited.add(currentId)
      currentId = getParentId(currentId)
      depth += 1
    }

    return false
  }

  const getNodeAbsolutePosition = (
    nodeId: string,
    visited = new Set<string>()
  ): { x: number; y: number } => {
    const cached = absolutePositionCache.get(nodeId)
    if (cached) return cached

    const node = nodeById.get(nodeId)
    if (!node) {
      return { x: 0, y: 0 }
    }

    const parentId = getParentId(nodeId)
    if (!parentId) {
      absolutePositionCache.set(nodeId, node.position)
      return node.position
    }

    if (isDescendantOf(nodeId, parentId)) {
      absolutePositionCache.set(nodeId, node.position)
      return node.position
    }

    if (visited.has(nodeId)) {
      return node.position
    }

    const parentNode = nodeById.get(parentId)
    if (!parentNode) {
      absolutePositionCache.set(nodeId, node.position)
      return node.position
    }

    visited.add(nodeId)
    const parentPosition = getNodeAbsolutePosition(parentId, visited)
    const absolutePosition = {
      x: parentPosition.x + CONTAINER_LEFT_PADDING + node.position.x,
      y: parentPosition.y + CONTAINER_HEADER_HEIGHT + CONTAINER_TOP_PADDING + node.position.y,
    }
    absolutePositionCache.set(nodeId, absolutePosition)
    return absolutePosition
  }

  const getContainingContainers = (
    position: { x: number; y: number },
    isContainerType: (type: string) => boolean
  ): ContainerHit[] => {
    return nodes
      .filter((node) => node.type && isContainerType(node.type))
      .filter((node) => {
        const absolutePosition = getNodeAbsolutePosition(node.id)
        const rect = {
          left: absolutePosition.x,
          right: absolutePosition.x + (node.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH),
          top: absolutePosition.y,
          bottom: absolutePosition.y + (node.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
        }

        return (
          position.x >= rect.left &&
          position.x <= rect.right &&
          position.y >= rect.top &&
          position.y <= rect.bottom
        )
      })
      .map((node) => ({
        loopId: node.id,
        loopPosition: getNodeAbsolutePosition(node.id),
        dimensions: {
          width: node.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
          height: node.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
        },
      }))
  }

  return {
    nodeById,
    getNodeDepth: (nodeId: string, maxDepth = 100) => getNodeDepth(nodeId, maxDepth),
    getNodeHierarchy: (nodeId: string, maxDepth = 100) => getNodeHierarchy(nodeId, maxDepth),
    isDescendantOf,
    getNodeAbsolutePosition: (nodeId: string) => getNodeAbsolutePosition(nodeId),
    getContainingContainers,
  }
}

/**
 * Hook providing utilities for node position, hierarchy, and dimension calculations
 */
export function useNodeUtilities(blocks: Record<string, any>) {
  const { getNodes } = useReactFlow()

  /**
   * Check if a block is a container type (loop, parallel, or subflow)
   */
  const isContainerType = useCallback((blockType: string): boolean => {
    return blockType === 'loop' || blockType === 'parallel' || blockType === 'subflowNode'
  }, [])

  /**
   * Get the dimensions of a block.
   * For regular blocks, uses stored height or estimates based on block config.
   */
  const getBlockDimensions = useCallback(
    (blockId: string): { width: number; height: number } => {
      const block = blocks[blockId]
      if (!block) {
        return { width: BLOCK_DIMENSIONS.FIXED_WIDTH, height: BLOCK_DIMENSIONS.MIN_HEIGHT }
      }

      if (isContainerType(block.type)) {
        return {
          width: block.data?.width
            ? Math.max(block.data.width, CONTAINER_DIMENSIONS.MIN_WIDTH)
            : CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
          height: block.data?.height
            ? Math.max(block.data.height, CONTAINER_DIMENSIONS.MIN_HEIGHT)
            : CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
        }
      }

      if (block.height) {
        return {
          width: BLOCK_DIMENSIONS.FIXED_WIDTH,
          height: Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT),
        }
      }

      return estimateBlockDimensions(block.type)
    },
    [blocks, isContainerType]
  )

  /**
   * Calculates the depth of a node in the hierarchy tree
   * @param nodeId ID of the node to check
   * @param maxDepth Maximum depth to prevent stack overflow
   * @returns Depth level (0 for root nodes, increasing for nested nodes)
   */
  const getNodeDepth = useCallback(
    (nodeId: string, maxDepth = 100): number => {
      const snapshot = createNodeGeometrySnapshot(getNodes(), blocks)
      return snapshot.getNodeDepth(nodeId, maxDepth)
    },
    [getNodes, blocks]
  )

  /**
   * Gets the full hierarchy path of a node (its parent chain)
   * @param nodeId ID of the node to check
   * @returns Array of node IDs representing the hierarchy path
   */
  const getNodeHierarchy = useCallback(
    (nodeId: string, maxDepth = 100): string[] => {
      const snapshot = createNodeGeometrySnapshot(getNodes(), blocks)
      return snapshot.getNodeHierarchy(nodeId, maxDepth)
    },
    [getNodes, blocks]
  )

  /**
   * Returns true if nodeId is in the subtree of ancestorId (i.e. walking from nodeId
   * up the parentId chain we reach ancestorId). Used to reject parent assignments that
   * would create a cycle (e.g. setting dragged node's parent to a container inside it).
   *
   * @param ancestorId - Node that might be an ancestor
   * @param nodeId - Node to walk from (upward)
   * @returns True if ancestorId appears in the parent chain of nodeId
   */
  const isDescendantOf = useCallback(
    (ancestorId: string, nodeId: string): boolean => {
      const snapshot = createNodeGeometrySnapshot(getNodes(), blocks)
      return snapshot.isDescendantOf(ancestorId, nodeId)
    },
    [getNodes, blocks]
  )

  /**
   * Gets the absolute position of a node (accounting for nested parents).
   * For nodes inside containers, accounts for header and padding offsets.
   * @param nodeId ID of the node to check
   * @returns Absolute position coordinates {x, y}
   */
  const getNodeAbsolutePosition = useCallback(
    (nodeId: string): { x: number; y: number } => {
      const snapshot = createNodeGeometrySnapshot(getNodes(), blocks)
      const node = snapshot.nodeById.get(nodeId)
      if (!node) {
        logger.warn('Attempted to get position of non-existent node', { nodeId })
        return { x: 0, y: 0 }
      }

      const parentId = blocks?.[nodeId]?.data?.parentId
      if (!parentId) {
        return node.position
      }

      const parentNode = snapshot.nodeById.get(parentId)
      if (!parentNode) {
        logger.warn('Node references non-existent parent', {
          nodeId,
          invalidParentId: parentId,
        })
        return node.position
      }

      if (snapshot.isDescendantOf(nodeId, parentId)) {
        logger.error('Circular parent reference detected', {
          nodeId,
          parentId,
        })
        return node.position
      }

      return snapshot.getNodeAbsolutePosition(nodeId)
    },
    [getNodes, blocks]
  )

  /**
   * Calculates the relative position of a node to a new parent's origin.
   * React Flow positions children relative to parent origin, so we clamp
   * to the content area bounds (after header and padding).
   * @param nodeId ID of the node being repositioned
   * @param newParentId ID of the new parent
   * @param skipClamping If true, returns raw relative position without clamping to container bounds
   * @returns Relative position coordinates {x, y} within the parent
   */
  const calculateRelativePosition = useCallback(
    (nodeId: string, newParentId: string, skipClamping?: boolean): { x: number; y: number } => {
      const snapshot = createNodeGeometrySnapshot(getNodes(), blocks)
      const nodeAbsPos = snapshot.getNodeAbsolutePosition(nodeId)
      const parentAbsPos = snapshot.getNodeAbsolutePosition(newParentId)

      const rawPosition = {
        x: nodeAbsPos.x - parentAbsPos.x,
        y: nodeAbsPos.y - parentAbsPos.y,
      }

      if (skipClamping) {
        return rawPosition
      }

      const parentNode = snapshot.nodeById.get(newParentId)
      const containerDimensions = {
        width: parentNode?.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
        height: parentNode?.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
      }
      const blockDimensions = getBlockDimensions(nodeId)

      return clampPositionToContainer(rawPosition, containerDimensions, blockDimensions)
    },
    [blocks, getNodes, getBlockDimensions]
  )

  /**
   * Checks if a point is inside a loop or parallel node
   * @param position Position coordinates to check
   * @returns The smallest container node containing the point, or null if none
   */
  const isPointInLoopNode = useCallback(
    (position: {
      x: number
      y: number
    }): {
      loopId: string
      loopPosition: { x: number; y: number }
      dimensions: { width: number; height: number }
    } | null => {
      const snapshot = createNodeGeometrySnapshot(getNodes(), blocks)
      const containingNodes = snapshot.getContainingContainers(position, isContainerType)

      if (containingNodes.length > 0) {
        return containingNodes.sort((a, b) => {
          const aArea = a.dimensions.width * a.dimensions.height
          const bArea = b.dimensions.width * b.dimensions.height
          return aArea - bArea
        })[0]
      }

      return null
    },
    [getNodes, blocks, isContainerType]
  )

  /**
   * Calculates appropriate dimensions for a loop or parallel node based on its children
   * @param nodeId ID of the container node
   * @returns Calculated width and height for the container
   */
  const calculateLoopDimensions = useCallback(
    (nodeId: string): { width: number; height: number } => {
      const currentBlocks = useWorkflowStore.getState().blocks
      const childBlockIds = Object.keys(currentBlocks).filter(
        (id) => currentBlocks[id]?.data?.parentId === nodeId
      )

      const childPositions = childBlockIds
        .map((childId) => {
          const child = currentBlocks[childId]
          if (!child?.position) return null
          const { width, height } = getBlockDimensions(childId)
          return { x: child.position.x, y: child.position.y, width, height }
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)

      return calculateContainerDimensions(childPositions)
    },
    [getBlockDimensions]
  )

  /**
   * Resizes all loop and parallel nodes based on their children
   * @param updateNodeDimensions Function to update the dimensions of a node
   */
  const resizeLoopNodes = useCallback(
    (updateNodeDimensions: (id: string, dimensions: { width: number; height: number }) => void) => {
      const currentBlocks = useWorkflowStore.getState().blocks
      const containerBlocks = Object.entries(currentBlocks)
        .filter(([, block]) => block?.type && isContainerType(block.type))
        .map(([id, block]) => ({
          id,
          block,
          depth: getNodeDepth(id),
        }))
        .sort((a, b) => b.depth - a.depth)

      for (const { id, block } of containerBlocks) {
        const dimensions = calculateLoopDimensions(id)
        const currentWidth = block?.data?.width
        const currentHeight = block?.data?.height

        if (dimensions.width !== currentWidth || dimensions.height !== currentHeight) {
          updateNodeDimensions(id, dimensions)
        }
      }
    },
    [isContainerType, getNodeDepth, calculateLoopDimensions]
  )

  /**
   * Updates a node's parent with proper position calculation
   * @param nodeId ID of the node being reparented
   * @param newParentId ID of the new parent (or null to remove parent)
   * @param batchUpdatePositions Function to batch update positions of blocks
   * @param batchUpdateBlocksWithParent Function to batch update blocks with parent info
   * @param resizeCallback Function to resize loop nodes after parent update
   */
  const updateNodeParent = useCallback(
    (
      nodeId: string,
      newParentId: string | null,
      batchUpdatePositions: (
        updates: Array<{ id: string; position: { x: number; y: number } }>
      ) => void,
      batchUpdateBlocksWithParent: (
        updates: Array<{ id: string; position: { x: number; y: number }; parentId?: string }>
      ) => void,
      resizeCallback: () => void
    ) => {
      const node = getNodes().find((n) => n.id === nodeId)
      if (!node) return

      const currentParentId = blocks[nodeId]?.data?.parentId || null
      if (newParentId === currentParentId) return

      if (newParentId) {
        const relativePosition = calculateRelativePosition(nodeId, newParentId)

        batchUpdatePositions([{ id: nodeId, position: relativePosition }])
        batchUpdateBlocksWithParent([
          { id: nodeId, position: relativePosition, parentId: newParentId },
        ])
      } else if (currentParentId) {
        const absolutePosition = getNodeAbsolutePosition(nodeId)

        batchUpdatePositions([{ id: nodeId, position: absolutePosition }])
        batchUpdateBlocksWithParent([{ id: nodeId, position: absolutePosition, parentId: '' }])
      }

      resizeCallback()
    },
    [getNodes, blocks, calculateRelativePosition, getNodeAbsolutePosition]
  )

  /**
   * Compute the absolute position of a node's source anchor (right-middle)
   * @param nodeId ID of the node
   * @returns Absolute position of the source anchor
   */
  const getNodeAnchorPosition = useCallback(
    (nodeId: string): { x: number; y: number } => {
      const node = getNodes().find((n) => n.id === nodeId)
      const absPos = getNodeAbsolutePosition(nodeId)

      if (!node) {
        return absPos
      }

      const isSubflow = node.type === 'subflowNode'
      const width = isSubflow
        ? typeof node.data?.width === 'number'
          ? node.data.width
          : 500
        : typeof node.width === 'number'
          ? node.width
          : 250
      const height = isSubflow
        ? typeof node.data?.height === 'number'
          ? node.data.height
          : 300
        : typeof node.height === 'number'
          ? node.height
          : 100

      return {
        x: absPos.x + width,
        y: absPos.y + height / 2,
      }
    },
    [getNodes, getNodeAbsolutePosition]
  )

  return {
    getNodeDepth,
    getNodeHierarchy,
    isDescendantOf,
    getNodeAbsolutePosition,
    calculateRelativePosition,
    isPointInLoopNode,
    calculateLoopDimensions,
    resizeLoopNodes,
    updateNodeParent,
    getNodeAnchorPosition,
    isContainerType,
    getBlockDimensions,
  }
}
