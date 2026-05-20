import { ALL_BLOCK_CATALOG, getBlockConfigFromCatalog } from '@/blocks/catalog'
import type { BlockConfig } from '@/blocks/types'
import { getAnyToolCatalogEntry } from '@/tools/catalog'

export function getBlockConfigByToolNameFromCatalog(toolName: string): BlockConfig | undefined {
  const toolEntry = getAnyToolCatalogEntry(toolName)
  if (toolEntry?.service) {
    const serviceBlock = getBlockConfigFromCatalog(toolEntry.service)
    if (serviceBlock) return serviceBlock
  }

  const blockType = Object.keys(ALL_BLOCK_CATALOG).find((type) =>
    ALL_BLOCK_CATALOG[type].tools?.access?.includes(toolName)
  )

  return blockType ? getBlockConfigFromCatalog(blockType) : undefined
}
