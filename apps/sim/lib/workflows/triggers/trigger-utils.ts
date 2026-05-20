import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { isBlockEnabled } from '@/lib/product/tool-policy'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import { generateMockPayloadFromOutputsDefinition } from '@/lib/workflows/triggers/mock-payload'
import {
  type StartBlockCandidate,
  StartBlockPath,
  TRIGGER_TYPES,
} from '@/lib/workflows/triggers/triggers'
import {
  getAllBlockCatalogEntries,
  getAnyBlockCatalogEntry,
  hasBlockCatalogTriggerCapability,
} from '@/blocks/catalog'
import type { BlockCatalogEntry } from '@/blocks/catalog-types'
import { getBlockCatalogIcon } from '@/blocks/icons'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'
import { getTrigger } from '@/triggers'

const logger = createLogger('TriggerUtils')

/**
 * Check if a workflow state has a valid start block
 */
export function hasValidStartBlockInState(state: WorkflowState | null | undefined): boolean {
  if (!state?.blocks) {
    return false
  }

  const startBlock = Object.values(state.blocks).find((block: BlockState) => {
    const blockType = block?.type
    return isInputDefinitionTrigger(blockType)
  })

  return !!startBlock
}

export interface TriggerInfo {
  id: string
  name: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  color: string
  category: 'core' | 'integration'
  enableTriggerMode?: boolean
}

type TriggerCapableBlock = Pick<
  BlockCatalogEntry,
  'category' | 'subBlocks' | 'triggers' | 'type' | 'name'
>

function getEnabledCatalogBlocks(): BlockCatalogEntry[] {
  return getAllBlockCatalogEntries().filter((block) => isBlockEnabled(block.type))
}

/**
 * Get all blocks that can act as triggers
 * This includes both dedicated trigger blocks and tools with trigger capabilities
 */
export function getAllTriggerBlocks(): TriggerInfo[] {
  const allBlocks = getEnabledCatalogBlocks()
  const triggers: TriggerInfo[] = []

  for (const block of allBlocks) {
    // Skip hidden blocks
    if (block.hideFromToolbar) continue

    // Check if it's a core trigger block (category: 'triggers')
    if (block.category === 'triggers') {
      triggers.push({
        id: block.type,
        name: block.name,
        description: block.description,
        icon: getBlockCatalogIcon(block.iconName) ?? (() => null),
        color: block.bgColor,
        category: 'core',
        enableTriggerMode: hasTriggerCapability(block),
      })
    }
    // Check if it's a tool with trigger capability (has trigger-config subblock)
    else if (hasTriggerCapability(block)) {
      triggers.push({
        id: block.type,
        name: block.name,
        description: block.description.replace(' or trigger workflows from ', ', trigger from '),
        icon: getBlockCatalogIcon(block.iconName) ?? (() => null),
        color: block.bgColor,
        category: 'integration',
        enableTriggerMode: true,
      })
    }
  }

  // Sort: core triggers first, then integration triggers, alphabetically within each category
  return triggers.sort((a, b) => {
    if (a.category !== b.category) {
      return a.category === 'core' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}

/**
 * Check if a block has trigger capability (contains trigger mode subblocks)
 */
export function hasTriggerCapability(block: TriggerCapableBlock): boolean {
  return hasBlockCatalogTriggerCapability(block as BlockCatalogEntry)
}

/**
 * Get blocks that should appear in the triggers tab
 * This includes all trigger blocks and tools with trigger mode
 */
export function getTriggersForSidebar(): BlockCatalogEntry[] {
  const allBlocks = getEnabledCatalogBlocks()
  return allBlocks.filter((block) => {
    if (block.hideFromToolbar) return false
    // Include blocks with triggers category or trigger-config subblock
    return block.category === 'triggers' || hasTriggerCapability(block)
  })
}

/**
 * Get blocks that should appear in the blocks tab
 * This excludes only dedicated trigger blocks, not tools with trigger capability
 */
export function getBlocksForSidebar(): BlockCatalogEntry[] {
  const allBlocks = getEnabledCatalogBlocks()
  return allBlocks.filter((block) => {
    if (block.hideFromToolbar) return false
    if (block.type === 'starter') return false // Legacy block
    // Only exclude blocks with 'triggers' category
    // Tools with trigger capability should still appear in blocks tab
    return block.category !== 'triggers'
  })
}

/**
 * Get the proper display name for a trigger block in the UI
 */
export function getTriggerDisplayName(blockType: string): string {
  const block = getAnyBlockCatalogEntry(blockType)
  if (!block) return blockType

  if (blockType === TRIGGER_TYPES.GENERIC_WEBHOOK) {
    return 'Webhook'
  }

  return block.name
}

/**
 * Groups triggers by their immediate downstream blocks to identify disjoint paths
 */
export function groupTriggersByPath<
  T extends { type: string; subBlocks?: Record<string, unknown> },
>(
  candidates: StartBlockCandidate<T>[],
  edges: Array<{ source: string; target: string }>
): Array<StartBlockCandidate<T>[]> {
  if (candidates.length <= 1) {
    return [candidates]
  }

  const groups: Array<StartBlockCandidate<T>[]> = []
  const processed = new Set<string>()

  // Build adjacency map (edges should already be filtered to exclude trigger-to-trigger)
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) {
      adjacency.set(edge.source, [])
    }
    adjacency.get(edge.source)!.push(edge.target)
  }

  // Group triggers that feed into the same immediate blocks
  for (const trigger of candidates) {
    if (processed.has(trigger.blockId)) continue

    const immediateTargets = adjacency.get(trigger.blockId) || []
    const targetSet = new Set(immediateTargets)

    // Find all triggers with the same immediate targets
    const group = candidates.filter((t) => {
      if (processed.has(t.blockId)) return false
      if (t.blockId === trigger.blockId) return true

      const tTargets = adjacency.get(t.blockId) || []

      // Different number of targets = different paths
      if (immediateTargets.length !== tTargets.length) return false

      // Check if all targets match
      return tTargets.every((target) => targetSet.has(target))
    })

    group.forEach((t) => processed.add(t.blockId))
    groups.push(group)
  }

  logger.info('Grouped triggers by path', {
    groupCount: groups.length,
    groups: groups.map((g) => ({
      count: g.length,
      triggers: g.map((t) => ({ id: t.blockId, type: t.block.type })),
    })),
  })

  return groups
}

/**
 * Selects the best trigger from a list of candidates based on priority
 * Priority: Start Block > Schedules > External Triggers > Legacy
 * If multiple disjoint paths exist, returns one trigger per path
 */
export function selectBestTrigger<T extends { type: string; subBlocks?: Record<string, unknown> }>(
  candidates: StartBlockCandidate<T>[],
  edges?: Array<{ source: string; target: string }>
): StartBlockCandidate<T>[] {
  if (candidates.length === 0) {
    throw new Error('No trigger candidates provided')
  }

  // If edges provided, group by path and select best from each group
  if (edges) {
    const groups = groupTriggersByPath(candidates, edges)
    return groups.map((group) => selectBestFromGroup(group))
  }

  // Otherwise just select the single best trigger
  return [selectBestFromGroup(candidates)]
}

/**
 * Selects the best trigger from a group based on priority
 */
function selectBestFromGroup<T extends { type: string; subBlocks?: Record<string, unknown> }>(
  candidates: StartBlockCandidate<T>[]
): StartBlockCandidate<T> {
  if (candidates.length === 1) {
    return candidates[0]
  }

  // Sort by priority (lower number = higher priority)
  const sorted = [...candidates].sort((a, b) => {
    const getPriority = (trigger: StartBlockCandidate<T>): number => {
      // Start block - highest priority
      if (trigger.path === StartBlockPath.UNIFIED) return 0
      if (trigger.path === StartBlockPath.LEGACY_STARTER) return 1

      // For external triggers, differentiate schedules from webhooks
      if (trigger.path === StartBlockPath.EXTERNAL_TRIGGER) {
        if (trigger.block.type === 'schedule') return 2
        return 3 // Webhooks and other external triggers
      }

      // Other trigger types
      if (trigger.path === StartBlockPath.SPLIT_API) return 4
      if (trigger.path === StartBlockPath.SPLIT_INPUT) return 5
      if (trigger.path === StartBlockPath.SPLIT_MANUAL) return 6
      if (trigger.path === StartBlockPath.SPLIT_CHAT) return 7

      return 99 // Unknown
    }

    return getPriority(a) - getPriority(b)
  })

  const selected = sorted[0]
  logger.info('Selected best trigger from group', {
    selectedId: selected.blockId,
    selectedType: selected.block.type,
    selectedPath: selected.path,
    groupSize: candidates.length,
  })

  return selected
}

/**
 * Checks if a trigger needs mock payload (external triggers/webhooks, but not schedules)
 */
export function triggerNeedsMockPayload<T extends { type: string }>(
  trigger: StartBlockCandidate<T>
): boolean {
  // Only webhooks and external integrations need mock payloads
  // Schedules run normally without mock data
  return trigger.path === StartBlockPath.EXTERNAL_TRIGGER && trigger.block.type !== 'schedule'
}

/**
 * Extracts or generates mock payload for external trigger execution
 */
export function extractTriggerMockPayload<
  T extends { type: string; subBlocks?: Record<string, unknown> },
>(trigger: StartBlockCandidate<T>): unknown {
  const subBlocks = trigger.block.subBlocks as Record<string, { value?: unknown }> | undefined

  // Determine the trigger ID
  let triggerId: string

  // Check for selectedTriggerId (multi-trigger blocks like Linear, Jira)
  if (typeof subBlocks?.selectedTriggerId?.value === 'string') {
    triggerId = subBlocks.selectedTriggerId.value
  } else {
    // For single-trigger blocks, get from block config
    const blockConfig = getAnyBlockCatalogEntry(trigger.block.type)

    if (blockConfig?.triggers?.available?.length === 1) {
      triggerId = blockConfig.triggers.available[0]
    } else {
      // Fallback to block type (for blocks that are themselves triggers like schedule)
      triggerId = trigger.block.type
    }
  }

  try {
    const triggerConfig = getTrigger(triggerId)

    if (!triggerConfig || !triggerConfig.outputs) {
      logger.warn('No trigger config or outputs found', {
        triggerId,
        blockId: trigger.blockId,
      })
      return {}
    }

    const payload = generateMockPayloadFromOutputsDefinition(triggerConfig.outputs)

    logger.info('Generated mock payload from trigger outputs', {
      triggerId,
      blockId: trigger.blockId,
      topLevelKeys: Object.keys(payload ?? {}),
    })

    return payload
  } catch (error) {
    logger.error('Failed to generate mock payload from trigger outputs', {
      triggerId,
      blockId: trigger.blockId,
      error: toError(error).message,
    })
    return {}
  }
}
