import type { BlockConfig } from '@/blocks/types'

export interface BlockCatalogEntry {
  type: string
  name: string
  description: string
  category: BlockConfig['category']
  integrationType?: string
  tags?: string[]
  longDescription?: string
  bestPractices?: string
  docsLink?: string
  bgColor: string
  subBlocks: BlockConfig['subBlocks']
  triggerAllowed?: boolean
  authMode?: string
  singleInstance?: boolean
  tools?: {
    access?: string[]
    config?: Record<string, unknown>
  }
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  hideFromToolbar?: boolean
  triggers?: BlockConfig['triggers']
  module: string
  iconName?: string
}

export type BlockCatalog = Record<string, BlockCatalogEntry>
