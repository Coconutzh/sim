import { createLogger } from '@sim/logger'
import {
  buildCanonicalIndex,
  type CanonicalModeOverrides,
  evaluateSubBlockCondition,
  isCanonicalPair,
  isSubBlockHidden,
  isTriggerModeSubBlock,
  resolveCanonicalMode,
  type SubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import { getAllBlockCatalogEntries } from '@/blocks/catalog'
import type { BlockCatalogEntry } from '@/blocks/catalog-types'
import type { SubBlockConfig as BlockSubBlockConfig, GenerationType } from '@/blocks/types'
import type { ToolMetadataConfig } from '@/tools/catalog-types'
import type { OAuthConfig, ParameterVisibility } from '@/tools/types'
import { getTool } from '@/tools/utils'

export { formatParameterLabel } from '@/tools/param-label'

const logger = createLogger('ToolsParamsClient')
export interface Option {
  label: string
  value: string
}

export interface ComponentCondition {
  field: string
  value: string | number | boolean | Array<string | number | boolean>
  not?: boolean
}

export interface UIComponentConfig {
  type: string
  options?: Option[]
  placeholder?: string
  password?: boolean
  condition?: ComponentCondition
  title?: string
  value?: unknown
  serviceId?: string
  selectorKey?: BlockSubBlockConfig['selectorKey']
  requiredScopes?: string[]
  mimeType?: string
  columns?: string[]
  min?: number
  max?: number
  step?: number
  integer?: boolean
  language?: string
  generationType?: string
  acceptedTypes?: string[]
  multiple?: boolean
  multiSelect?: boolean
  maxSize?: number
  dependsOn?: string[] | { all?: string[]; any?: string[] }
  /** Canonical parameter ID if this is part of a canonical group */
  canonicalParamId?: string
  /** The mode of the source subblock (basic/advanced/both) */
  mode?: 'basic' | 'advanced' | 'both' | 'trigger' | 'trigger-advanced'
  /** The actual subblock ID this config was derived from */
  actualSubBlockId?: string
  /** Wand configuration for AI assistance */
  wandConfig?: {
    enabled: boolean
    prompt: string
    generationType?: GenerationType
    placeholder?: string
    maintainHistory?: boolean
  }
}

export interface SubBlockConfig {
  id: string
  type: string
  title?: string
  options?: Option[]
  placeholder?: string
  password?: boolean
  condition?: ComponentCondition
  value?: unknown
  serviceId?: string
  requiredScopes?: string[]
  mimeType?: string
  columns?: string[]
  min?: number
  max?: number
  step?: number
  integer?: boolean
  language?: string
  generationType?: string
  acceptedTypes?: string[]
  multiple?: boolean
  maxSize?: number
  dependsOn?: string[]
}

export interface SchemaProperty {
  type: string
  description: string
  items?: Record<string, any>
  properties?: Record<string, SchemaProperty>
  required?: string[]
}

type ToolInputBlockConfig = Pick<BlockCatalogEntry, 'type' | 'subBlocks' | 'tools'>

export interface ToolParameterConfig {
  id: string
  type: string
  required?: boolean // Required for tool execution
  visibility?: ParameterVisibility // Controls who can/must provide this parameter
  userProvided?: boolean // User filled this parameter
  description?: string
  default?: unknown
  // UI component information from block config
  uiComponent?: UIComponentConfig
}

export interface ToolWithParameters {
  toolConfig: ToolMetadataConfig
  allParameters: ToolParameterConfig[]
  userInputParameters: ToolParameterConfig[] // Parameters shown to user
  requiredParameters: ToolParameterConfig[] // Must be filled by user or LLM
  optionalParameters: ToolParameterConfig[] // Nice to have, shown to user
}

let blockConfigCache: Record<string, ToolInputBlockConfig> | null = null

function getBlockConfigurations(): Record<string, ToolInputBlockConfig> {
  if (!blockConfigCache) {
    try {
      const allBlocks = getAllBlockCatalogEntries()
      blockConfigCache = {}
      allBlocks.forEach((block) => {
        blockConfigCache![block.type] = block
      })
    } catch (error) {
      logger.warn('Could not load block configuration:', error)
      blockConfigCache = {}
    }
  }
  return blockConfigCache
}

/**
 * Gets the correct tool ID for a block operation.
 */
export function getToolIdForOperation(blockType: string, operation?: string): string | undefined {
  const block = getBlockConfigurations()[blockType]
  if (!block?.tools?.access) return undefined

  if (block.tools.access.length === 1) {
    return block.tools.access[0]
  }

  if (operation && block.tools.operationToolMap?.[operation]) {
    return block.tools.operationToolMap[operation]
  }

  if (operation && block.tools.access.includes(operation)) {
    return operation
  }

  return block.tools.access[0]
}

function resolveSubBlockForParam(
  paramId: string,
  subBlocks: BlockSubBlockConfig[],
  valuesWithOperation: Record<string, unknown>,
  paramType: string
): BlockSubBlockConfig | undefined {
  const blockSubBlocks = subBlocks

  // First pass: find subblock with matching condition
  let fallbackMatch: BlockSubBlockConfig | undefined

  for (const sb of blockSubBlocks) {
    const matches = sb.id === paramId || sb.canonicalParamId === paramId
    if (!matches) continue

    // Remember first match as fallback (for condition-based filtering in UI)
    if (!fallbackMatch) fallbackMatch = sb

    if (
      !sb.condition ||
      evaluateSubBlockCondition(sb.condition as SubBlockCondition, valuesWithOperation)
    ) {
      return sb
    }
  }

  // Return fallback so its condition can be used for UI filtering
  if (fallbackMatch) return fallbackMatch

  // Check if boolean param is part of a checkbox-list
  if (paramType === 'boolean') {
    return blockSubBlocks.find(
      (sb) =>
        sb.type === 'checkbox-list' &&
        Array.isArray(sb.options) &&
        (sb.options as Array<{ id?: string }>).some((opt) => opt.id === paramId)
    )
  }

  return undefined
}

/**
 * Gets all parameters for a tool, categorized by their usage
 * Also includes UI component information from block configurations
 */
export function getToolParametersConfig(
  toolId: string,
  blockType?: string,
  currentValues?: Record<string, unknown>
): ToolWithParameters | null {
  try {
    const toolConfig = getTool(toolId)
    if (!toolConfig) {
      logger.warn(`Tool not found: ${toolId}`)
      return null
    }

    // Validate that toolConfig has required properties
    if (!toolConfig.params || typeof toolConfig.params !== 'object') {
      logger.warn(`Tool ${toolId} has invalid params configuration`)
      return null
    }

    // Special handling for workflow_executor tool
    if (toolId === 'workflow_executor') {
      const parameters: ToolParameterConfig[] = [
        {
          id: 'workflowId',
          type: 'string',
          required: true,
          visibility: 'user-only',
          description: 'The ID of the workflow to execute',
          uiComponent: {
            type: 'workflow-selector',
            placeholder: 'Select workflow to execute',
            selectorKey: 'sim.workflows',
          },
        },
        {
          id: 'inputMapping',
          type: 'object',
          required: false,
          visibility: 'user-or-llm',
          description: 'Map inputs to the selected workflow',
          uiComponent: {
            type: 'workflow-input-mapper',
            title: 'Workflow Inputs',
            condition: {
              field: 'workflowId',
              value: '',
              not: true, // Show when workflowId is not empty
            },
            dependsOn: ['workflowId'],
          },
        },
      ]

      return {
        toolConfig,
        allParameters: parameters,
        userInputParameters: parameters.filter(
          (param) => param.visibility === 'user-or-llm' || param.visibility === 'user-only'
        ),
        requiredParameters: parameters.filter((param) => param.required),
        optionalParameters: parameters.filter(
          (param) => param.visibility === 'user-only' && !param.required
        ),
      }
    }

    // Get block configuration for UI component information
    let blockConfig: ToolInputBlockConfig | null = null
    if (blockType) {
      const blockConfigs = getBlockConfigurations()
      blockConfig = blockConfigs[blockType] || null
    }

    // Build values for condition evaluation
    // Operation should come from currentValues if provided, otherwise extract from toolId
    const values = currentValues || {}
    const valuesWithOperation = { ...values }
    if (valuesWithOperation.operation === undefined) {
      // Fallback: extract operation from tool ID (e.g., 'slack_message' -> 'message')
      const parts = toolId.split('_')
      valuesWithOperation.operation =
        parts.length >= 3 ? parts.slice(2).join('_') : parts[parts.length - 1]
    }

    // Convert tool params to our standard format with UI component info
    const allParameters: ToolParameterConfig[] = Object.entries(toolConfig.params).map(
      ([paramId, param]) => {
        const toolParam: ToolParameterConfig = {
          id: paramId,
          type: param.type,
          required: param.required ?? false,
          visibility: param.visibility ?? (param.required ? 'user-or-llm' : 'user-only'),
          description: param.description,
          default: param.default,
        }

        if (blockConfig) {
          const subBlock = resolveSubBlockForParam(
            paramId,
            blockConfig.subBlocks || [],
            valuesWithOperation,
            param.type
          )

          if (subBlock) {
            if (isSubBlockHidden(subBlock)) {
              toolParam.visibility = 'hidden'
            }

            toolParam.uiComponent = {
              type: subBlock.type,
              options: subBlock.options as Option[] | undefined,
              placeholder: subBlock.placeholder,
              password: subBlock.password,
              condition: subBlock.condition as ComponentCondition | undefined,
              title: subBlock.title,
              value: subBlock.value,
              serviceId: subBlock.serviceId,
              selectorKey: subBlock.selectorKey,
              requiredScopes: subBlock.requiredScopes,
              mimeType: subBlock.mimeType,
              columns: subBlock.columns,
              min: subBlock.min,
              max: subBlock.max,
              step: subBlock.step,
              integer: subBlock.integer,
              language: subBlock.language,
              generationType: subBlock.generationType,
              acceptedTypes: subBlock.acceptedTypes ? [subBlock.acceptedTypes] : undefined,
              multiple: subBlock.multiple,
              maxSize: subBlock.maxSize,
              dependsOn: subBlock.dependsOn,
              canonicalParamId: subBlock.canonicalParamId,
              mode: subBlock.mode,
              actualSubBlockId: subBlock.id,
              wandConfig: subBlock.wandConfig,
            }
          }
        }

        return toolParam
      }
    )

    // Parameters that should be shown to the user for input
    const userInputParameters = allParameters.filter(
      (param) => param.visibility === 'user-or-llm' || param.visibility === 'user-only'
    )

    // Parameters that are required (must be filled by user or LLM)
    const requiredParameters = allParameters.filter((param) => param.required)

    // Parameters that are optional but can be provided by user
    const optionalParameters = allParameters.filter(
      (param) => param.visibility === 'user-only' && !param.required
    )

    return {
      toolConfig,
      allParameters,
      userInputParameters,
      requiredParameters,
      optionalParameters,
    }
  } catch (error) {
    logger.error('Error getting tool parameters config:', error)
    return null
  }
}

/**
 * Helper to check if a parameter should be treated as a password field
 */
export function isPasswordParameter(paramId: string): boolean {
  const passwordFields = [
    'password',
    'apiKey',
    'token',
    'secret',
    'key',
    'credential',
    'accessToken',
    'refreshToken',
    'botToken',
    'authToken',
  ]

  return passwordFields.some((field) => paramId.toLowerCase().includes(field.toLowerCase()))
}

/**
 * SubBlock IDs that control tool routing, not user-facing parameters.
 * Excluded from tool-input rendering unless they have an explicit paramVisibility set.
 */
const STRUCTURAL_SUBBLOCK_IDS = new Set(['operation'])

/**
 * SubBlock types that represent auth/credential inputs handled separately
 * by the tool-input OAuth credential selector.
 */
const AUTH_SUBBLOCK_TYPES = new Set(['oauth-input'])

/**
 * SubBlock types that should never appear in tool-input context.
 */
const EXCLUDED_SUBBLOCK_TYPES = new Set([
  'tool-input',
  'skill-input',
  'condition-input',
  'eval-input',
  'webhook-config',
  'schedule-info',
  'input-format',
  'response-format',
  'mcp-server-selector',
  'mcp-tool-selector',
  'mcp-dynamic-args',
  'input-mapping',
  'variables-input',
  'messages-input',
  'router-input',
  'text',
])

export interface SubBlocksForToolInput {
  toolConfig: ToolMetadataConfig
  subBlocks: BlockSubBlockConfig[]
  oauthConfig?: OAuthConfig
}

/**
 * Returns filtered SubBlockConfig[] for rendering in tool-input context.
 * Uses subblock definitions as the primary source of UI metadata,
 * getting all features (wandConfig, rich conditions, dependsOn, etc.) for free.
 *
 * For blocks without paramVisibility annotations, falls back to inferring
 * visibility from the tool's param definitions.
 */
export function getSubBlocksForToolInput(
  toolId: string,
  blockType: string,
  currentValues?: Record<string, unknown>,
  canonicalModeOverrides?: CanonicalModeOverrides,
  blockConfigOverride?: Pick<ToolInputBlockConfig, 'subBlocks'>
): SubBlocksForToolInput | null {
  try {
    const toolConfig = getTool(toolId)
    if (!toolConfig) {
      logger.warn(`Tool not found: ${toolId}`)
      return null
    }

    const blockConfigs = getBlockConfigurations()
    const blockConfig = blockConfigOverride ?? blockConfigs[blockType]
    if (!blockConfig?.subBlocks?.length) {
      return null
    }

    const allSubBlocks = blockConfig.subBlocks as BlockSubBlockConfig[]
    const canonicalIndex = buildCanonicalIndex(allSubBlocks)

    // Build values for condition evaluation
    const values = currentValues || {}
    const valuesWithOperation = { ...values }
    if (valuesWithOperation.operation === undefined) {
      const parts = toolId.split('_')
      valuesWithOperation.operation =
        parts.length >= 3 ? parts.slice(2).join('_') : parts[parts.length - 1]
    }

    // Build a map of tool param IDs to their resolved visibility
    const toolParamVisibility: Record<string, ParameterVisibility> = {}
    for (const [paramId, param] of Object.entries(toolConfig.params || {})) {
      toolParamVisibility[paramId] =
        param.visibility ?? (param.required ? 'user-or-llm' : 'user-only')
    }

    // Track which canonical groups we've already included (to avoid duplicates)
    const includedCanonicalIds = new Set<string>()

    const filtered: BlockSubBlockConfig[] = []

    for (const sb of allSubBlocks) {
      // Skip excluded types
      if (EXCLUDED_SUBBLOCK_TYPES.has(sb.type)) continue

      // Skip trigger-mode-only subblocks
      if (isTriggerModeSubBlock(sb)) continue

      // Hide tool API key fields when running on hosted Sim or when env var is set
      if (isSubBlockHidden(sb)) continue

      // Determine the effective param ID (canonical or subblock id)
      const effectiveParamId = sb.canonicalParamId || sb.id

      // Resolve paramVisibility: explicit > inferred from tool params > skip
      let visibility = sb.paramVisibility
      if (!visibility) {
        // Infer from structural checks
        if (STRUCTURAL_SUBBLOCK_IDS.has(sb.id)) {
          visibility = 'hidden'
        } else if (AUTH_SUBBLOCK_TYPES.has(sb.type) && sb.canonicalParamId !== 'oauthCredential') {
          visibility = 'hidden'
        } else if (sb.canonicalParamId === 'oauthCredential') {
          visibility = 'user-only'
        } else if (
          sb.password &&
          (sb.id === 'botToken' || sb.id === 'accessToken' || sb.id === 'apiKey')
        ) {
          // Auth tokens without explicit paramVisibility are hidden
          // (they're handled by the OAuth credential selector or structurally)
          // But only if they don't have a matching tool param
          if (!(sb.id in toolParamVisibility)) {
            visibility = 'hidden'
          } else {
            visibility = toolParamVisibility[sb.id] || 'user-or-llm'
          }
        } else if (effectiveParamId in toolParamVisibility) {
          // Fallback: infer from tool param visibility
          visibility = toolParamVisibility[effectiveParamId]
        } else if (sb.id in toolParamVisibility) {
          visibility = toolParamVisibility[sb.id]
        } else if (sb.canonicalParamId) {
          visibility = 'user-or-llm'
        } else {
          continue
        }
      }

      // Filter by visibility: exclude hidden and llm-only
      if (visibility === 'hidden' || visibility === 'llm-only') continue

      if (sb.condition && !sb.reactiveCondition) {
        const conditionMet = evaluateSubBlockCondition(
          sb.condition as SubBlockCondition,
          valuesWithOperation
        )
        if (!conditionMet) continue
      }

      // Handle canonical pairs: only include the active mode variant
      const canonicalId = canonicalIndex.canonicalIdBySubBlockId[sb.id]
      if (canonicalId) {
        const group = canonicalIndex.groupsById[canonicalId]
        if (group && isCanonicalPair(group)) {
          if (includedCanonicalIds.has(canonicalId)) continue
          includedCanonicalIds.add(canonicalId)

          // Determine active mode
          const mode = resolveCanonicalMode(group, valuesWithOperation, canonicalModeOverrides)
          if (mode === 'advanced') {
            // Find the advanced variant
            const advancedSb = allSubBlocks.find((s) => group.advancedIds.includes(s.id))
            if (advancedSb) {
              filtered.push({ ...advancedSb, paramVisibility: visibility })
            }
          } else {
            // Include basic variant (current sb if it's the basic one)
            if (group.basicId === sb.id) {
              filtered.push({ ...sb, paramVisibility: visibility })
            } else {
              const basicSb = allSubBlocks.find((s) => s.id === group.basicId)
              if (basicSb) {
                filtered.push({ ...basicSb, paramVisibility: visibility })
              }
            }
          }
          continue
        }
      }

      // Non-canonical, non-hidden, condition-passing subblock
      filtered.push({ ...sb, paramVisibility: visibility })
    }

    return {
      toolConfig,
      subBlocks: filtered,
      oauthConfig: toolConfig.oauth,
    }
  } catch (error) {
    logger.error('Error getting subblocks for tool input:', error)
    return null
  }
}
