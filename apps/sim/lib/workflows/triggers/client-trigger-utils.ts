import { isBlockEnabled } from '@/lib/product/tool-policy'
import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/mock-payload'
import { type StartBlockCandidate, StartBlockPath } from '@/lib/workflows/triggers/triggers'
import {
  getAllBlockCatalogEntries,
  getAnyBlockCatalogEntry,
  hasBlockCatalogTriggerCapability,
} from '@/blocks/catalog'
import type { BlockCatalogEntry } from '@/blocks/catalog-types'

type TriggerCapableBlock = Pick<
  BlockCatalogEntry,
  'category' | 'subBlocks' | 'triggers' | 'type' | 'name'
>

function getEnabledCatalogBlocks(): BlockCatalogEntry[] {
  return getAllBlockCatalogEntries().filter((block) => isBlockEnabled(block.type))
}

export function hasTriggerCapability(block: TriggerCapableBlock): boolean {
  return hasBlockCatalogTriggerCapability(block as BlockCatalogEntry)
}

export function getTriggersForSidebar(): BlockCatalogEntry[] {
  return getEnabledCatalogBlocks().filter((block) => {
    if (block.hideFromToolbar) return false
    return block.category === 'triggers' || hasTriggerCapability(block)
  })
}

export function getBlocksForSidebar(): BlockCatalogEntry[] {
  return getEnabledCatalogBlocks().filter((block) => {
    if (block.hideFromToolbar) return false
    if (block.type === 'starter') return false
    return block.category !== 'triggers'
  })
}

export function groupTriggersByPath<
  T extends { type: string; subBlocks?: Record<string, unknown> },
>(
  candidates: StartBlockCandidate<T>[],
  edges: Array<{ source: string; target: string }>
): Array<StartBlockCandidate<T>[]> {
  if (candidates.length <= 1) return [candidates]

  const groups: Array<StartBlockCandidate<T>[]> = []
  const processed = new Set<string>()
  const adjacency = new Map<string, string[]>()

  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, [])
    adjacency.get(edge.source)?.push(edge.target)
  }

  for (const trigger of candidates) {
    if (processed.has(trigger.blockId)) continue

    const immediateTargets = adjacency.get(trigger.blockId) ?? []
    const targetSet = new Set(immediateTargets)
    const group = candidates.filter((candidate) => {
      if (processed.has(candidate.blockId)) return false
      if (candidate.blockId === trigger.blockId) return true

      const candidateTargets = adjacency.get(candidate.blockId) ?? []
      return (
        immediateTargets.length === candidateTargets.length &&
        candidateTargets.every((target) => targetSet.has(target))
      )
    })

    group.forEach((candidate) => processed.add(candidate.blockId))
    groups.push(group)
  }

  return groups
}

export function selectBestTrigger<T extends { type: string; subBlocks?: Record<string, unknown> }>(
  candidates: StartBlockCandidate<T>[],
  edges?: Array<{ source: string; target: string }>
): StartBlockCandidate<T>[] {
  if (candidates.length === 0) throw new Error('No trigger candidates provided')
  if (edges)
    return groupTriggersByPath(candidates, edges).map((group) => selectBestFromGroup(group))
  return [selectBestFromGroup(candidates)]
}

function selectBestFromGroup<T extends { type: string; subBlocks?: Record<string, unknown> }>(
  candidates: StartBlockCandidate<T>[]
): StartBlockCandidate<T> {
  if (candidates.length === 1) return candidates[0]

  return [...candidates].sort((a, b) => getTriggerPriority(a) - getTriggerPriority(b))[0]
}

function getTriggerPriority<T extends { type: string; subBlocks?: Record<string, unknown> }>(
  trigger: StartBlockCandidate<T>
): number {
  if (trigger.path === StartBlockPath.UNIFIED) return 0
  if (trigger.path === StartBlockPath.LEGACY_STARTER) return 1
  if (trigger.path === StartBlockPath.EXTERNAL_TRIGGER) {
    if (trigger.block.type === 'schedule') return 2
    return 3
  }
  if (trigger.path === StartBlockPath.SPLIT_API) return 4
  if (trigger.path === StartBlockPath.SPLIT_INPUT) return 5
  if (trigger.path === StartBlockPath.SPLIT_MANUAL) return 6
  if (trigger.path === StartBlockPath.SPLIT_CHAT) return 7
  return 99
}

export function triggerNeedsMockPayload<T extends { type: string }>(
  trigger: StartBlockCandidate<T>
): boolean {
  return trigger.path === StartBlockPath.EXTERNAL_TRIGGER && trigger.block.type !== 'schedule'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getSubBlockValue(
  subBlocks: Record<string, unknown> | undefined,
  subBlockId: string
): unknown {
  const subBlock = subBlocks?.[subBlockId]
  if (!isRecord(subBlock)) return undefined
  return subBlock.value
}

function getTriggerId<T extends { type: string; subBlocks?: Record<string, unknown> }>(
  trigger: StartBlockCandidate<T>
): string {
  const selectedTriggerId = getSubBlockValue(trigger.block.subBlocks, 'selectedTriggerId')
  if (typeof selectedTriggerId === 'string' && selectedTriggerId.length > 0) {
    return selectedTriggerId
  }

  const blockConfig = getAnyBlockCatalogEntry(trigger.block.type)
  if (blockConfig?.triggers?.available?.length === 1) {
    return blockConfig.triggers.available[0]
  }

  return trigger.block.type
}

function getCatalogEntryForTrigger(
  triggerId: string,
  blockType: string
): BlockCatalogEntry | undefined {
  const directBlockConfig = getAnyBlockCatalogEntry(blockType)
  if (directBlockConfig?.triggers?.available?.includes(triggerId)) {
    return directBlockConfig
  }

  return getAllBlockCatalogEntries().find((entry) => entry.triggers?.available?.includes(triggerId))
}

/**
 * Generates trigger mock payloads using only the client-safe block catalog.
 */
export function extractTriggerMockPayload<
  T extends { type: string; subBlocks?: Record<string, unknown> },
>(trigger: StartBlockCandidate<T>): unknown {
  const triggerId = getTriggerId(trigger)
  const blockConfig = getCatalogEntryForTrigger(triggerId, trigger.block.type)

  if (!blockConfig || Object.keys(blockConfig.outputs).length === 0) {
    return {}
  }

  return generateMockPayloadFromOutputsDefinition(blockConfig.outputs)
}
