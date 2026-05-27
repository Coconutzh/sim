import * as agentBlocks from '@/blocks/blocks/agent'
import * as apiBlocks from '@/blocks/blocks/api'
import * as chatTriggerBlocks from '@/blocks/blocks/chat_trigger'
import * as conditionBlocks from '@/blocks/blocks/condition'
import * as contentBlocks from '@/blocks/blocks/content'
import * as fileBlocks from '@/blocks/blocks/file'
import * as functionBlocks from '@/blocks/blocks/function'
import * as genericWebhookBlocks from '@/blocks/blocks/generic_webhook'
import * as mcpBlocks from '@/blocks/blocks/mcp'
import * as noteBlocks from '@/blocks/blocks/note'
import * as parallelBlocks from '@/blocks/blocks/parallel'
import * as responseBlocks from '@/blocks/blocks/response'
import * as routerBlocks from '@/blocks/blocks/router'
import * as searchBlocks from '@/blocks/blocks/search'
import * as startTriggerBlocks from '@/blocks/blocks/start_trigger'
import * as tableBlocks from '@/blocks/blocks/table'
import * as variablesBlocks from '@/blocks/blocks/variables'
import * as webhookRequestBlocks from '@/blocks/blocks/webhook_request'
import type { BlockConfig } from '@/blocks/types'

const BLOCK_MODULES = [
  agentBlocks,
  apiBlocks,
  chatTriggerBlocks,
  conditionBlocks,
  contentBlocks,
  fileBlocks,
  functionBlocks,
  genericWebhookBlocks,
  mcpBlocks,
  noteBlocks,
  parallelBlocks,
  responseBlocks,
  routerBlocks,
  searchBlocks,
  startTriggerBlocks,
  tableBlocks,
  variablesBlocks,
  webhookRequestBlocks,
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBlockConfig(value: unknown): value is BlockConfig {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.category === 'string' &&
    typeof value.bgColor === 'string' &&
    Array.isArray(value.subBlocks) &&
    isRecord(value.tools) &&
    isRecord(value.inputs) &&
    isRecord(value.outputs)
  )
}

function collectBlocks(): Record<string, BlockConfig> {
  return Object.fromEntries(
    BLOCK_MODULES.flatMap((moduleExports) =>
      Object.values(moduleExports)
        .filter(isBlockConfig)
        .map((block) => [block.type, block] as const)
    )
  )
}

const ALL_BLOCKS: Record<string, BlockConfig> = collectBlocks()

export const registry: Record<string, BlockConfig> = ALL_BLOCKS

export const getBlock = (type: string): BlockConfig | undefined => {
  if (registry[type]) {
    return registry[type]
  }
  const normalized = type.replace(/-/g, '_')
  return registry[normalized]
}

export const getLatestBlock = (baseType: string): BlockConfig | undefined => {
  const normalized = baseType.replace(/-/g, '_')

  const versionedKeys = Object.keys(registry).filter((key) => {
    const match = key.match(new RegExp(`^${normalized}_v(\\d+)$`))
    return match !== null
  })

  if (versionedKeys.length > 0) {
    const sorted = versionedKeys.sort((a, b) => {
      const versionA = Number.parseInt(a.match(/_v(\d+)$/)?.[1] || '0', 10)
      const versionB = Number.parseInt(b.match(/_v(\d+)$/)?.[1] || '0', 10)
      return versionB - versionA
    })
    return registry[sorted[0]]
  }

  return registry[normalized]
}

export const getBlockByToolName = (toolName: string): BlockConfig | undefined => {
  return Object.values(registry).find((block) => block.tools?.access?.includes(toolName))
}

export const getBlocksByCategory = (category: 'blocks' | 'tools' | 'triggers'): BlockConfig[] =>
  Object.values(registry).filter((block) => block.category === category)

export const getAllBlockTypes = (): string[] => Object.keys(registry)

export const isValidBlockType = (type: string): type is string =>
  type in registry || type.replace(/-/g, '_') in registry

export const getAllBlocks = (): BlockConfig[] => Object.values(registry)
