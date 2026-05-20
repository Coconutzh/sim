import * as icons from '@/components/icons'
import type { BlockIcon } from '@/blocks/types'

export function getBlockCatalogIcon(iconName: string | undefined): BlockIcon | undefined {
  if (!iconName) return undefined
  return (icons as Record<string, BlockIcon | undefined>)[iconName]
}
