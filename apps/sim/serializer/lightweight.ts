import { generateId } from '@sim/utils/id'
import type { Edge } from 'reactflow'
import {
  buildCanonicalIndex,
  buildSubBlockValues,
  evaluateSubBlockCondition,
  getCanonicalValues,
  isCanonicalPair,
  isNonEmptyValue,
  isSubBlockFeatureEnabled,
  isSubBlockHidden,
  resolveCanonicalMode,
} from '@/lib/workflows/subblocks/visibility'
import { getBlockConfigFromCatalog } from '@/blocks/catalog'
import type { BlockConfig, ParamType, SubBlockConfig } from '@/blocks/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import type { BlockState, Loop, Parallel, SubBlockState } from '@/stores/workflows/workflow/types'
import { generateLoopBlocks, generateParallelBlocks } from '@/stores/workflows/workflow/utils'
import { getTool } from '@/tools/utils'

function toSubBlockStateValue(value: unknown): SubBlockState['value'] {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (Array.isArray(value) && value.every((row) => Array.isArray(row))) {
    return value.map((row) => row.map((cell) => String(cell)))
  }
  return JSON.stringify(value)
}

function shouldSerializeSubBlock(
  subBlockConfig: SubBlockConfig,
  values: Record<string, unknown>,
  displayAdvancedOptions: boolean,
  isTriggerContext: boolean,
  isTriggerCategory: boolean,
  canonicalIndex: ReturnType<typeof buildCanonicalIndex>,
  canonicalModeOverrides?: Record<string, 'basic' | 'advanced'>
): boolean {
  if (!isSubBlockFeatureEnabled(subBlockConfig)) return false
  if (isSubBlockHidden(subBlockConfig)) return false

  if (subBlockConfig.mode === 'trigger') {
    if (!isTriggerContext && !isTriggerCategory) return false
  } else if (isTriggerContext && !isTriggerCategory) {
    return false
  }

  const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlockConfig.id]
  if (canonicalId) {
    const group = canonicalIndex.groupsById[canonicalId]
    if (group && isCanonicalPair(group)) {
      const mode =
        canonicalModeOverrides?.[group.canonicalId] != null || !displayAdvancedOptions
          ? resolveCanonicalMode(group, values, canonicalModeOverrides)
          : 'advanced'
      const matchesMode =
        mode === 'advanced'
          ? group.advancedIds.includes(subBlockConfig.id)
          : group.basicId === subBlockConfig.id
      return matchesMode && evaluateSubBlockCondition(subBlockConfig.condition, values)
    }
    return evaluateSubBlockCondition(subBlockConfig.condition, values)
  }

  if (subBlockConfig.mode === 'advanced' && !displayAdvancedOptions) {
    return isNonEmptyValue(values[subBlockConfig.id])
  }
  if (subBlockConfig.mode === 'basic' && displayAdvancedOptions) {
    return false
  }

  return evaluateSubBlockCondition(subBlockConfig.condition, values)
}

/**
 * Client-safe serializer for validation and diff round-trips.
 */
export class LightweightSerializer {
  serializeWorkflow(
    blocks: Record<string, BlockState>,
    edges: Edge[],
    loops?: Record<string, Loop>,
    parallels?: Record<string, Parallel>,
    validateRequired = false
  ): SerializedWorkflow {
    const canonicalLoops = generateLoopBlocks(blocks)
    const canonicalParallels = generateParallelBlocks(blocks)
    const safeLoops = Object.keys(canonicalLoops).length > 0 ? canonicalLoops : loops || {}
    const safeParallels =
      Object.keys(canonicalParallels).length > 0 ? canonicalParallels : parallels || {}

    return {
      version: '1.0',
      blocks: Object.values(blocks).map((block) => this.serializeBlock(block, validateRequired)),
      connections: edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle || undefined,
        targetHandle: edge.targetHandle || undefined,
      })),
      loops: safeLoops,
      parallels: safeParallels,
    }
  }

  private serializeBlock(block: BlockState, validateRequired: boolean): SerializedBlock {
    if (block.type === 'loop' || block.type === 'parallel') {
      return {
        id: block.id,
        position: block.position,
        config: { tool: '', params: (block.data || {}) as Record<string, unknown> },
        inputs: {},
        outputs: block.outputs,
        metadata: {
          id: block.type,
          name: block.name,
          description: block.type === 'loop' ? 'Loop container' : 'Parallel container',
          category: 'subflow',
          color: block.type === 'loop' ? '#3b82f6' : '#8b5cf6',
        },
        enabled: block.enabled,
      }
    }

    const blockConfig = getBlockConfigFromCatalog(block.type)
    if (!blockConfig) throw new Error(`Invalid block type: ${block.type}`)

    const params = this.extractParams(block, blockConfig)
    if (block.triggerMode === true || blockConfig.category === 'triggers') params.triggerMode = true
    if (block.advancedMode === true) params.advancedMode = true
    if (validateRequired) this.validateRequiredFieldsBeforeExecution(block, blockConfig, params)

    return {
      id: block.id,
      position: block.position,
      config: { tool: this.selectToolId(blockConfig, params), params },
      inputs: Object.fromEntries(
        Object.entries(blockConfig.inputs || {}).map(([key, config]) => [
          key,
          config.type as ParamType,
        ])
      ),
      outputs: { ...block.outputs },
      metadata: {
        id: block.type,
        name: block.name,
        description: blockConfig.description,
        category: blockConfig.category,
        color: blockConfig.bgColor,
      },
      enabled: block.enabled,
      canonicalModes: block.data?.canonicalModes as
        | Record<string, 'basic' | 'advanced'>
        | undefined,
    }
  }

  private extractParams(block: BlockState, blockConfig: BlockConfig): Record<string, unknown> {
    const params: Record<string, unknown> = {}
    const allValues = buildSubBlockValues(block.subBlocks)
    const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks)
    const canonicalModeOverrides = block.data?.canonicalModes as
      | Record<string, 'basic' | 'advanced'>
      | undefined
    const isTriggerCategory = blockConfig.category === 'triggers'

    Object.entries(block.subBlocks).forEach(([id, subBlock]) => {
      const matchingConfigs = blockConfig.subBlocks.filter((config) => config.id === id)
      const shouldInclude =
        matchingConfigs.length === 0 ||
        matchingConfigs.some((config) =>
          shouldSerializeSubBlock(
            config,
            allValues,
            block.advancedMode ?? false,
            block.triggerMode ?? false,
            isTriggerCategory,
            canonicalIndex,
            canonicalModeOverrides
          )
        )
      if (shouldInclude) params[id] = subBlock.value
    })

    Object.values(canonicalIndex.groupsById).forEach((group) => {
      const { basicValue, advancedValue } = getCanonicalValues(group, params)
      const pairMode =
        canonicalModeOverrides?.[group.canonicalId] != null || !(block.advancedMode ?? false)
          ? resolveCanonicalMode(group, allValues, canonicalModeOverrides)
          : 'advanced'
      const chosen = pairMode === 'advanced' ? advancedValue : basicValue
      const sourceIds = [group.basicId, ...group.advancedIds].filter(Boolean) as string[]
      sourceIds.forEach((id) => delete params[id])
      if (chosen !== undefined) params[group.canonicalId] = chosen
    })

    return params
  }

  private validateRequiredFieldsBeforeExecution(
    block: BlockState,
    blockConfig: BlockConfig,
    params: Record<string, unknown>
  ): void {
    if (
      block.enabled === false ||
      block.triggerMode === true ||
      blockConfig.category === 'triggers' ||
      params.triggerMode === true
    ) {
      return
    }

    const missingFields: string[] = []
    const allValues = buildSubBlockValues(block.subBlocks)
    const canonicalIndex = buildCanonicalIndex(blockConfig.subBlocks || [])
    const toolId = this.selectToolId(blockConfig, params)
    const currentTool = toolId ? getTool(toolId) : null
    const validatedByTool = new Set(currentTool ? Object.keys(currentTool.params || {}) : [])

    blockConfig.subBlocks?.forEach((subBlockConfig) => {
      if (validatedByTool.has(subBlockConfig.id)) return
      if (subBlockConfig.canonicalParamId && validatedByTool.has(subBlockConfig.canonicalParamId)) {
        return
      }

      const isVisible = shouldSerializeSubBlock(
        subBlockConfig,
        allValues,
        block.advancedMode ?? false,
        block.triggerMode ?? false,
        blockConfig.category === 'triggers',
        canonicalIndex,
        block.data?.canonicalModes as Record<string, 'basic' | 'advanced'> | undefined
      )
      if (!isVisible) return

      const isRequired =
        typeof subBlockConfig.required === 'boolean'
          ? subBlockConfig.required
          : subBlockConfig.required
            ? evaluateSubBlockCondition(subBlockConfig.required, params)
            : false
      if (!isRequired) return

      const canonicalId = canonicalIndex.canonicalIdBySubBlockId[subBlockConfig.id]
      const fieldValue = canonicalId ? params[canonicalId] : params[subBlockConfig.id]
      if (fieldValue === undefined || fieldValue === null || fieldValue === '') {
        missingFields.push(subBlockConfig.title || subBlockConfig.id)
      }
    })

    if (missingFields.length > 0) {
      const blockName = block.name || blockConfig.name || 'Block'
      throw new Error(`${blockName} is missing required fields: ${missingFields.join(', ')}`)
    }
  }

  private selectToolId(blockConfig: BlockConfig, params: Record<string, unknown>): string {
    const operation = typeof params.operation === 'string' ? params.operation : undefined
    const catalogTools = blockConfig.tools as BlockConfig['tools'] & {
      operationToolMap?: Record<string, string>
    }
    if (operation && catalogTools.operationToolMap?.[operation]) {
      return catalogTools.operationToolMap[operation]
    }
    return blockConfig.tools.access[0] || ''
  }

  deserializeWorkflow(workflow: SerializedWorkflow): {
    blocks: Record<string, BlockState>
    edges: Edge[]
  } {
    const blocks: Record<string, BlockState> = {}
    const edges: Edge[] = []
    workflow.blocks.forEach((serializedBlock) => {
      const block = this.deserializeBlock(serializedBlock)
      blocks[block.id] = block
    })
    workflow.connections.forEach((connection) => {
      edges.push({
        id: generateId(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
      })
    })
    return { blocks, edges }
  }

  private deserializeBlock(serializedBlock: SerializedBlock): BlockState {
    const blockType = serializedBlock.metadata?.id
    if (!blockType) throw new Error(`Invalid block type: ${serializedBlock.metadata?.id}`)

    if (blockType === 'loop' || blockType === 'parallel') {
      return {
        id: serializedBlock.id,
        type: blockType,
        name: serializedBlock.metadata?.name || (blockType === 'loop' ? 'Loop' : 'Parallel'),
        position: serializedBlock.position,
        subBlocks: {},
        outputs: serializedBlock.outputs,
        enabled: serializedBlock.enabled ?? true,
        data: serializedBlock.config.params,
      }
    }

    const blockConfig = getBlockConfigFromCatalog(blockType)
    if (!blockConfig) throw new Error(`Invalid block type: ${blockType}`)

    const subBlocks: Record<string, SubBlockState> = {}
    blockConfig.subBlocks.forEach((subBlock) => {
      subBlocks[subBlock.id] = {
        id: subBlock.id,
        type: subBlock.type,
        value: toSubBlockStateValue(serializedBlock.config.params[subBlock.id]),
      }
    })

    return {
      id: serializedBlock.id,
      type: blockType,
      name: serializedBlock.metadata?.name || blockConfig.name,
      position: serializedBlock.position,
      subBlocks,
      outputs: serializedBlock.outputs,
      enabled: true,
      triggerMode:
        serializedBlock.config?.params?.triggerMode === true ||
        serializedBlock.metadata?.category === 'triggers',
      advancedMode: serializedBlock.config?.params?.advancedMode === true,
    }
  }
}
