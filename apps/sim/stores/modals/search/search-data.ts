import { RepeatIcon, SplitIcon } from 'lucide-react'
import { getToolOperationsIndex } from '@/lib/search/tool-operations'
import { getTriggersForSidebar } from '@/lib/workflows/triggers/client-trigger-utils'
import { getAllBlockCatalogEntries } from '@/blocks/catalog'
import { getBlockCatalogIcon } from '@/blocks/icons'
import type {
  SearchBlockItem,
  SearchData,
  SearchDocItem,
  SearchToolOperationItem,
} from '@/stores/modals/search/types'

export function buildSearchData(
  filterBlocks: <T extends { type: string }>(blocks: T[]) => T[]
): SearchData {
  const allBlocks = getAllBlockCatalogEntries()
  const filteredAllBlocks = filterBlocks(allBlocks) as typeof allBlocks

  const regularBlocks: SearchBlockItem[] = []
  const tools: SearchBlockItem[] = []
  const docs: SearchDocItem[] = []

  for (const block of filteredAllBlocks) {
    if (block.hideFromToolbar) continue

    const searchItem: SearchBlockItem = {
      id: block.type,
      name: block.name,
      icon: getBlockCatalogIcon(block.iconName) ?? (() => null),
      bgColor: block.bgColor || '#6B7280',
      type: block.type,
    }

    if (block.category === 'blocks' && block.type !== 'starter') {
      regularBlocks.push(searchItem)
    } else if (block.category === 'tools') {
      tools.push(searchItem)
    }

    if (block.docsLink) {
      docs.push({
        id: `docs-${block.type}`,
        name: block.name,
        icon: getBlockCatalogIcon(block.iconName) ?? (() => null),
        href: block.docsLink,
      })
    }
  }

  const specialBlocks: SearchBlockItem[] = [
    {
      id: 'loop',
      name: 'Loop',
      icon: RepeatIcon,
      bgColor: '#2FB3FF',
      type: 'loop',
    },
    {
      id: 'parallel',
      name: 'Parallel',
      icon: SplitIcon,
      bgColor: '#FEE12B',
      type: 'parallel',
    },
  ]

  const blocks = [...regularBlocks, ...(filterBlocks(specialBlocks) as SearchBlockItem[])]

  const allTriggers = getTriggersForSidebar()
  const filteredTriggers = filterBlocks(allTriggers) as typeof allTriggers
  const priorityOrder = ['Start', 'Schedule', 'Webhook']

  const sortedTriggers = [...filteredTriggers].sort(
    (a: (typeof filteredTriggers)[number], b: (typeof filteredTriggers)[number]) => {
      const aIndex = priorityOrder.indexOf(a.name)
      const bIndex = priorityOrder.indexOf(b.name)
      const aHasPriority = aIndex !== -1
      const bHasPriority = bIndex !== -1

      if (aHasPriority && bHasPriority) return aIndex - bIndex
      if (aHasPriority) return -1
      if (bHasPriority) return 1
      return a.name.localeCompare(b.name)
    }
  )

  const triggers = sortedTriggers.map(
    (block): SearchBlockItem => ({
      id: block.type,
      name: block.name,
      icon: getBlockCatalogIcon(block.iconName) ?? (() => null),
      bgColor: block.bgColor || '#6B7280',
      type: block.type,
      config: block,
    })
  )

  const allowedBlockTypes = new Set(tools.map((t) => t.type))
  const toolOperations: SearchToolOperationItem[] = getToolOperationsIndex()
    .filter((op) => allowedBlockTypes.has(op.blockType))
    .map((op) => {
      const aliasesStr = op.aliases?.length ? ` ${op.aliases.join(' ')}` : ''
      return {
        id: op.id,
        name: op.operationName,
        searchValue: `${op.serviceName} ${op.operationName}${aliasesStr}`,
        icon: op.icon,
        bgColor: op.bgColor,
        blockType: op.blockType,
        operationId: op.operationId,
      }
    })

  return {
    blocks,
    tools,
    triggers,
    toolOperations,
    docs,
    isInitialized: true,
  }
}
