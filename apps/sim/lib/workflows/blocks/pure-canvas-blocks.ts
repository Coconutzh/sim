const PURE_CANVAS_BLOCK_TYPES = new Set(['note', 'content'])

export function isPureCanvasBlockType(blockType: string | null | undefined): boolean {
  return typeof blockType === 'string' && PURE_CANVAS_BLOCK_TYPES.has(blockType)
}

export function isContentBlockType(blockType: string | null | undefined): boolean {
  return blockType === 'content'
}

export function getCanvasNodeType(
  blockType: string
): 'workflowBlock' | 'noteBlock' | 'contentBlock' {
  if (blockType === 'note') return 'noteBlock'
  if (blockType === 'content') return 'contentBlock'
  return 'workflowBlock'
}

export function getCanvasNodeDragHandle(
  blockType: string
): '.workflow-drag-handle' | '.note-drag-handle' | '.content-drag-handle' {
  if (blockType === 'note') return '.note-drag-handle'
  if (blockType === 'content') return '.content-drag-handle'
  return '.workflow-drag-handle'
}
