import { getToolCatalogEntry, resolveCatalogToolId } from '@/tools/catalog'
import { TOOL_MODULE_LOADERS } from '@/tools/loaders.generated'
import type { ToolConfig } from '@/tools/types'

const loadedToolCache = new Map<string, ToolConfig>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isToolConfig(value: unknown): value is ToolConfig {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.version === 'string' &&
    isRecord(value.params) &&
    isRecord(value.request)
  )
}

export async function loadTool(toolId: string): Promise<ToolConfig | undefined> {
  const resolvedToolId = resolveCatalogToolId(toolId)
  const cached = loadedToolCache.get(resolvedToolId)
  if (cached) return cached

  const catalogEntry = getToolCatalogEntry(resolvedToolId)
  if (!catalogEntry) return undefined

  const loaders = TOOL_MODULE_LOADERS as Record<string, () => Promise<Record<string, unknown>>>
  const loader = loaders[catalogEntry.module]
  if (!loader) return undefined

  const module = await loader()
  for (const exportedValue of Object.values(module)) {
    if (isToolConfig(exportedValue) && exportedValue.id === resolvedToolId) {
      loadedToolCache.set(resolvedToolId, exportedValue)
      return exportedValue
    }
  }

  return undefined
}
