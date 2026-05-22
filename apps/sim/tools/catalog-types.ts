import type { ToolConfig } from '@/tools/types'

export type ToolMetadataConfig = Pick<
  ToolConfig,
  'id' | 'name' | 'description' | 'version' | 'params' | 'oauth'
> &
  Partial<Pick<ToolConfig, 'hosting' | 'outputs' | 'schemaEnrichment' | 'toolEnrichment'>>

export type ToolCatalogEntry = ToolMetadataConfig & {
  service: string
  module: string
  hosting?: {
    apiKeyParam?: string
    [key: string]: unknown
  }
}

export type ToolCatalog = Record<string, ToolCatalogEntry>
