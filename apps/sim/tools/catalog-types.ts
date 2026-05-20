import type { ToolConfig } from '@/tools/types'

export type ToolCatalogEntry = Pick<
  ToolConfig,
  'id' | 'name' | 'description' | 'version' | 'params' | 'oauth'
> & {
  service: string
  module: string
  hosting?: {
    apiKeyParam?: string
    [key: string]: unknown
  }
}

export type ToolCatalog = Record<string, ToolCatalogEntry>
