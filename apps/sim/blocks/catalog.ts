import { isBlockEnabled } from '@/lib/product/tool-policy'
import blockCatalogJson from '@/blocks/catalog.generated.json'
import type { BlockCatalogEntry } from '@/blocks/catalog-types'
import { getBlockCatalogIcon } from '@/blocks/icons'
import type { BlockConfig } from '@/blocks/types'
import { getAnyToolCatalogEntry } from '@/tools/catalog'

const BLOCK_CATALOG = blockCatalogJson as Record<string, BlockCatalogEntry>

export const ALL_BLOCK_CATALOG: Record<string, BlockCatalogEntry> = BLOCK_CATALOG

export const blockCatalog: Record<string, BlockCatalogEntry> = Object.fromEntries(
  Object.entries(ALL_BLOCK_CATALOG).filter(([blockType]) => isBlockEnabled(blockType))
)

export function normalizeBlockType(type: string): string {
  return type.replace(/-/g, '_')
}

export function stripBlockVersionSuffix(type: string): string {
  return normalizeBlockType(type).replace(/_v\d+$/, '')
}

export function getLatestVersionBlockCatalog(
  catalog: Record<string, BlockCatalogEntry> = ALL_BLOCK_CATALOG
): Record<string, BlockCatalogEntry> {
  const latestBlocks: Record<string, BlockCatalogEntry> = {}
  const baseTypeToVersions: Record<string, { blockType: string; version: number }[]> = {}

  for (const blockType of Object.keys(catalog)) {
    const baseType = stripBlockVersionSuffix(blockType)
    const versionMatch = blockType.match(/_v(\d+)$/)
    const version = versionMatch ? Number.parseInt(versionMatch[1], 10) : 1

    if (!baseTypeToVersions[baseType]) {
      baseTypeToVersions[baseType] = []
    }
    baseTypeToVersions[baseType].push({ blockType, version })
  }

  for (const versions of Object.values(baseTypeToVersions)) {
    const latest = versions.reduce((prev, curr) => (curr.version > prev.version ? curr : prev))
    latestBlocks[latest.blockType] = catalog[latest.blockType]
  }

  return latestBlocks
}

export function resolveCatalogBlockType(type: string): string {
  const normalized = normalizeBlockType(type)
  if (blockCatalog[normalized] || ALL_BLOCK_CATALOG[normalized]) {
    return normalized
  }

  const latestBlocks = getLatestVersionBlockCatalog(ALL_BLOCK_CATALOG)
  const baseType = stripBlockVersionSuffix(normalized)
  for (const blockType of Object.keys(latestBlocks)) {
    if (stripBlockVersionSuffix(blockType) === baseType) {
      return blockType
    }
  }

  return normalized
}

export function getBlockCatalogEntry(type: string): BlockCatalogEntry | undefined {
  return blockCatalog[resolveCatalogBlockType(type)]
}

export function getAnyBlockCatalogEntry(type: string): BlockCatalogEntry | undefined {
  return ALL_BLOCK_CATALOG[resolveCatalogBlockType(type)]
}

export function getBlockConfigFromCatalog(type: string): BlockConfig | undefined {
  const entry = getAnyBlockCatalogEntry(type)
  if (!entry) return undefined

  return {
    ...entry,
    icon: getBlockCatalogIcon(entry.iconName) ?? (() => null),
    tools: entry.tools ?? { access: [] },
  } as BlockConfig
}

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

export function getAllBlockCatalogEntries(): BlockCatalogEntry[] {
  return Object.values(blockCatalog)
}

export function getBlockCatalogEntriesByCategory(
  category: 'blocks' | 'tools' | 'triggers'
): BlockCatalogEntry[] {
  return getAllBlockCatalogEntries().filter((block) => block.category === category)
}

export function hasBlockCatalogTriggerCapability(block: BlockCatalogEntry): boolean {
  const hasTriggerModeSubBlocks = block.subBlocks.some((subBlock) => subBlock.mode === 'trigger')

  if (block.category === 'triggers') {
    return hasTriggerModeSubBlocks
  }

  return (
    (block.triggers?.enabled === true && block.triggers.available.length > 0) ||
    hasTriggerModeSubBlocks
  )
}

export function isValidCatalogBlockType(type: string): boolean {
  return Boolean(getAnyBlockCatalogEntry(type))
}
