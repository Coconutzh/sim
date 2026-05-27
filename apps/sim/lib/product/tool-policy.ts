import type { BlockConfig } from '@/blocks/types'
import type { ToolConfig } from '@/tools/types'

const TAPNOW_MVP_PRESET = 'tapnow-mvp'
const DISABLED_PRESET_NAMES = new Set(['all', 'full', 'off'])

const TAPNOW_RECOMMENDED_TOOL_SERVICES = [
  'file',
  'function',
  'knowledge',
  'llm',
  'logs',
  'memory',
  'mcp',
  'notion',
  'parallel',
  'search',
  'slack',
  'gmail',
  'table',
  'workflow',
] as const

const TAPNOW_RECOMMENDED_TOOL_IDS = [
  'file_append',
  'file_parser',
  'file_parser_v2',
  'file_parser_v3',
  'file_write',
  'http_request',
  'search_tool',
  'webhook_request',
] as const

const TAPNOW_RECOMMENDED_BLOCK_TYPES = [
  'agent',
  'api',
  'chat_trigger',
  'condition',
  'file',
  'file_v2',
  'file_v3',
  'function',
  'generic_webhook',
  'loop',
  'mcp',
  'note',
  'parallel_ai',
  'response',
  'router',
  'router_v2',
  'search',
  'start_trigger',
  'table',
  'variables',
  'webhook_request',
] as const

const CONFIGURED_PRESET_NAME = normalizeToken(process.env.NEXT_PUBLIC_SIM_TOOL_POLICY_PRESET)
const PRESET_NAME = DISABLED_PRESET_NAMES.has(CONFIGURED_PRESET_NAME)
  ? ''
  : CONFIGURED_PRESET_NAME || TAPNOW_MVP_PRESET

const ENABLED_TOOL_SERVICES = createConfiguredSet(
  process.env.NEXT_PUBLIC_SIM_ENABLED_TOOL_SERVICES,
  PRESET_NAME === TAPNOW_MVP_PRESET ? TAPNOW_RECOMMENDED_TOOL_SERVICES : []
)

const ENABLED_TOOL_IDS = createConfiguredSet(
  process.env.NEXT_PUBLIC_SIM_ENABLED_TOOL_IDS,
  PRESET_NAME === TAPNOW_MVP_PRESET ? TAPNOW_RECOMMENDED_TOOL_IDS : []
)

const ENABLED_BLOCK_TYPES = createConfiguredSet(
  process.env.NEXT_PUBLIC_SIM_ENABLED_BLOCK_TYPES,
  PRESET_NAME === TAPNOW_MVP_PRESET ? TAPNOW_RECOMMENDED_BLOCK_TYPES : []
)

const TOOL_POLICY_ENABLED = ENABLED_TOOL_SERVICES.size > 0 || ENABLED_TOOL_IDS.size > 0
const BLOCK_POLICY_ENABLED = ENABLED_BLOCK_TYPES.size > 0

/**
 * Returns the recommended third-party tool services for a TapNow-style MVP.
 */
export function getTapNowRecommendedToolServices(): readonly string[] {
  return TAPNOW_RECOMMENDED_TOOL_SERVICES
}

/**
 * Returns the recommended built-in tool IDs for a TapNow-style MVP.
 */
export function getTapNowRecommendedToolIds(): readonly string[] {
  return TAPNOW_RECOMMENDED_TOOL_IDS
}

/**
 * Returns the recommended block types for a TapNow-style MVP.
 */
export function getTapNowRecommendedBlockTypes(): readonly string[] {
  return TAPNOW_RECOMMENDED_BLOCK_TYPES
}

/**
 * Filters a tool registry using the configured tool policy.
 */
export function filterEnabledToolsRegistry(
  registry: Record<string, ToolConfig>
): Record<string, ToolConfig> {
  if (!TOOL_POLICY_ENABLED) {
    return registry
  }

  return Object.fromEntries(
    Object.entries(registry).filter(([toolId, tool]) => isToolEnabled(toolId, tool))
  )
}

/**
 * Filters a block registry using the configured block policy.
 * This is intended for user-visible surfaces such as toolbars, templates,
 * and copilot block pickers. It should not be used to strip the canonical
 * block registry that existing workflows depend on.
 */
export function filterEnabledBlockRegistry(
  registry: Record<string, BlockConfig>
): Record<string, BlockConfig> {
  if (!BLOCK_POLICY_ENABLED) {
    return registry
  }

  return Object.fromEntries(
    Object.entries(registry).filter(([blockType]) => isBlockEnabled(blockType))
  )
}

/**
 * Filters a list of block configs for user-visible product surfaces.
 */
export function filterEnabledBlocks(blocks: BlockConfig[]): BlockConfig[] {
  if (!BLOCK_POLICY_ENABLED) {
    return blocks
  }

  return blocks.filter((block) => isBlockEnabled(block.type))
}

/**
 * Returns whether a tool is enabled under the current product policy.
 */
export function isToolEnabled(toolId: string, tool: ToolConfig): boolean {
  if (!TOOL_POLICY_ENABLED) {
    return true
  }

  const normalizedToolId = stripVersionSuffix(normalizeToken(toolId))
  if (ENABLED_TOOL_IDS.has(toolId) || ENABLED_TOOL_IDS.has(normalizedToolId)) {
    return true
  }

  const service = getToolService(toolId, tool)
  return service ? ENABLED_TOOL_SERVICES.has(service) : false
}

/**
 * Returns whether a tool is enabled using lightweight catalog metadata.
 */
export function isToolCatalogEntryEnabled(toolId: string, service: string): boolean {
  if (!TOOL_POLICY_ENABLED) {
    return true
  }

  const normalizedToolId = stripVersionSuffix(normalizeToken(toolId))
  if (ENABLED_TOOL_IDS.has(toolId) || ENABLED_TOOL_IDS.has(normalizedToolId)) {
    return true
  }

  return ENABLED_TOOL_SERVICES.has(normalizeToken(service))
}

/**
 * Returns a descriptive error message when a built-in tool is disabled by product policy.
 */
export function getToolPolicyErrorMessage(
  toolId: string,
  tool: ToolConfig | undefined
): string | null {
  if (!TOOL_POLICY_ENABLED || !tool) {
    return null
  }

  if (isToolEnabled(toolId, tool)) {
    return null
  }

  const service = getToolService(toolId, tool)
  if (service) {
    return `Tool disabled in this product edition: ${toolId} (service: ${service})`
  }

  return `Tool disabled in this product edition: ${toolId}`
}

/**
 * Returns a policy error message using lightweight catalog metadata.
 */
export function getToolCatalogPolicyErrorMessage(
  toolId: string,
  service: string | undefined
): string | null {
  if (!TOOL_POLICY_ENABLED || !service) {
    return null
  }

  if (isToolCatalogEntryEnabled(toolId, service)) {
    return null
  }

  return `Tool disabled in this product edition: ${toolId} (service: ${service})`
}

/**
 * Returns whether a block type is enabled under the current product policy.
 */
export function isBlockEnabled(blockType: string): boolean {
  if (!BLOCK_POLICY_ENABLED) {
    return true
  }

  return ENABLED_BLOCK_TYPES.has(normalizeToken(blockType))
}

function getToolService(toolId: string, tool: ToolConfig): string | null {
  const staticRequestUrl = getStaticRequestUrl(tool)
  if (staticRequestUrl) {
    const routeMatch = staticRequestUrl.match(/^\/api\/tools\/([^/]+)(?:\/|$)/)
    if (routeMatch?.[1]) {
      return normalizeToken(routeMatch[1])
    }
  }

  const normalizedToolId = stripVersionSuffix(normalizeToken(toolId))
  const servicePrefix = normalizedToolId.split('_')[0]
  if (
    ['function', 'knowledge', 'llm', 'logs', 'memory', 'parallel', 'table', 'workflow'].includes(
      servicePrefix
    )
  ) {
    return servicePrefix
  }

  if (normalizedToolId === 'http_request') {
    return 'api'
  }
  if (normalizedToolId === 'webhook_request') {
    return 'api'
  }
  if (normalizedToolId === 'search_tool') {
    return 'search'
  }
  if (normalizedToolId.startsWith('file_')) {
    return 'file'
  }

  return null
}

function getStaticRequestUrl(tool: ToolConfig): string | null {
  return typeof tool.request.url === 'string' ? tool.request.url : null
}

function createConfiguredSet(value: string | undefined, preset: readonly string[]): Set<string> {
  const configuredValues = value
    ?.split(',')
    .map((item) => normalizeToken(item))
    .filter((item) => item.length > 0)

  return new Set([...preset, ...(configuredValues ?? [])])
}

function normalizeToken(value: string | undefined): string {
  return (value ?? '').trim().replace(/-/g, '_').toLowerCase()
}

function stripVersionSuffix(value: string): string {
  return value.replace(/_v\d+$/, '')
}
