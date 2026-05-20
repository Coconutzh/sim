import {
  getToolCatalogPolicyErrorMessage,
  isToolCatalogEntryEnabled,
} from '@/lib/product/tool-policy'
import { TOOL_CATALOG } from '@/tools/catalog.generated'
import type { ToolCatalogEntry } from '@/tools/catalog-types'

export const ALL_TOOL_CATALOG: Record<string, ToolCatalogEntry> = TOOL_CATALOG

export const toolCatalog: Record<string, ToolCatalogEntry> = Object.fromEntries(
  Object.entries(ALL_TOOL_CATALOG).filter(([toolId, entry]) =>
    isToolCatalogEntryEnabled(toolId, entry.service)
  )
)

export function stripToolVersionSuffix(name: string): string {
  return name.replace(/_v\d+$/, '')
}

export function getLatestVersionToolCatalog(
  catalog: Record<string, ToolCatalogEntry> = ALL_TOOL_CATALOG
): Record<string, ToolCatalogEntry> {
  const latestTools: Record<string, ToolCatalogEntry> = {}
  const baseNameToVersions: Record<string, { toolId: string; version: number }[]> = {}

  for (const toolId of Object.keys(catalog)) {
    const baseName = stripToolVersionSuffix(toolId)
    const versionMatch = toolId.match(/_v(\d+)$/)
    const version = versionMatch ? Number.parseInt(versionMatch[1], 10) : 1

    if (!baseNameToVersions[baseName]) {
      baseNameToVersions[baseName] = []
    }
    baseNameToVersions[baseName].push({ toolId, version })
  }

  for (const versions of Object.values(baseNameToVersions)) {
    const latest = versions.reduce((prev, curr) => (curr.version > prev.version ? curr : prev))
    latestTools[latest.toolId] = catalog[latest.toolId]
  }

  return latestTools
}

export function resolveCatalogToolId(toolName: string): string {
  if (toolCatalog[toolName] || ALL_TOOL_CATALOG[toolName]) {
    return toolName
  }

  const latestTools = getLatestVersionToolCatalog(ALL_TOOL_CATALOG)
  for (const toolId of Object.keys(latestTools)) {
    if (stripToolVersionSuffix(toolId) === toolName) {
      return toolId
    }
  }

  return toolName
}

export function getToolCatalogEntry(toolId: string): ToolCatalogEntry | undefined {
  return toolCatalog[resolveCatalogToolId(toolId)]
}

export function getAnyToolCatalogEntry(toolId: string): ToolCatalogEntry | undefined {
  return ALL_TOOL_CATALOG[resolveCatalogToolId(toolId)]
}

export function getToolCatalogUnavailableErrorMessage(toolId: string): string | null {
  const resolvedToolId = resolveCatalogToolId(toolId)
  const entry = ALL_TOOL_CATALOG[resolvedToolId]
  if (!entry) {
    return null
  }

  return getToolCatalogPolicyErrorMessage(resolvedToolId, entry.service)
}
