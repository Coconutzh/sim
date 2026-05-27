import type { ToolConfig } from '@/tools/types'

export type ToolMetadataConfig = Pick<
  ToolConfig,
  'id' | 'name' | 'description' | 'version' | 'params' | 'oauth'
> &
  Partial<Pick<ToolConfig, 'outputs' | 'schemaEnrichment' | 'toolEnrichment'>> & {
    hosting?: {
      apiKeyParam?: string
      [key: string]: unknown
    }
  }

export type ToolCatalogEntry = ToolMetadataConfig & {
  service: string
  module: string
}

export type ToolCatalog = Record<string, ToolCatalogEntry>
