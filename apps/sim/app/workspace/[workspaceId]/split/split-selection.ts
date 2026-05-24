export interface PaneBlockSelectionInput {
  currentBlockIds: string[]
  blockId: string
  additive: boolean
}

export function selectPaneBlock({
  currentBlockIds,
  blockId,
  additive,
}: PaneBlockSelectionInput): string[] {
  if (!blockId) return []
  if (!additive) return [blockId]
  if (currentBlockIds.includes(blockId)) {
    return currentBlockIds.filter((currentBlockId) => currentBlockId !== blockId)
  }
  return [...currentBlockIds, blockId]
}

export function mapCopiedTargetBlockIds(
  sourceBlockIds: string[],
  mappings: Record<string, string>
): string[] {
  const orderedTargetIds = sourceBlockIds
    .map((sourceBlockId) => mappings[sourceBlockId])
    .filter((targetBlockId): targetBlockId is string => Boolean(targetBlockId))
  const orderedSet = new Set(orderedTargetIds)
  const remainingTargetIds = Object.values(mappings).filter(
    (targetBlockId) => !orderedSet.has(targetBlockId)
  )
  return [...orderedTargetIds, ...remainingTargetIds]
}

export function describePaneSelection(blockIds: string[]): string {
  if (blockIds.length === 0) return 'Click nodes to copy'
  if (blockIds.length === 1) return `Selected ${blockIds[0]}`
  return `Selected ${blockIds.length} blocks`
}
