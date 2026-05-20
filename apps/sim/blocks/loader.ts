import { getAnyBlockCatalogEntry, resolveCatalogBlockType } from '@/blocks/catalog'
import { BLOCK_MODULE_LOADERS } from '@/blocks/loaders.generated'
import type { BlockConfig } from '@/blocks/types'

const loadedBlockCache = new Map<string, BlockConfig>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBlockConfig(value: unknown): value is BlockConfig {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.category === 'string' &&
    Array.isArray(value.subBlocks) &&
    isRecord(value.tools) &&
    isRecord(value.inputs) &&
    isRecord(value.outputs)
  )
}

export async function loadBlock(type: string): Promise<BlockConfig | undefined> {
  const resolvedType = resolveCatalogBlockType(type)
  const cached = loadedBlockCache.get(resolvedType)
  if (cached) return cached

  const catalogEntry = getAnyBlockCatalogEntry(resolvedType)
  if (!catalogEntry) return undefined

  const loaders = BLOCK_MODULE_LOADERS as Record<string, () => Promise<Record<string, unknown>>>
  const loader = loaders[catalogEntry.module]
  if (!loader) return undefined

  const module = await loader()
  for (const exportedValue of Object.values(module)) {
    if (isBlockConfig(exportedValue) && exportedValue.type === resolvedType) {
      loadedBlockCache.set(resolvedType, exportedValue)
      return exportedValue
    }
  }

  return undefined
}

export async function loadBlocks(types: readonly string[]): Promise<Record<string, BlockConfig>> {
  const uniqueTypes = Array.from(new Set(types.map(resolveCatalogBlockType)))
  const entries = await Promise.all(
    uniqueTypes.map(async (type) => {
      const block = await loadBlock(type)
      return block ? ([type, block] as const) : null
    })
  )

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, BlockConfig] => !!entry)
  )
}
