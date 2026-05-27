import { filterEnabledToolsRegistry } from '@/lib/product/tool-policy'
import * as fileTools from '@/tools/file'
import * as functionTools from '@/tools/function'
import * as gmailTools from '@/tools/gmail'
import * as httpTools from '@/tools/http'
import * as knowledgeTools from '@/tools/knowledge'
import * as llmTools from '@/tools/llm'
import * as logsTools from '@/tools/logs'
import * as memoryTools from '@/tools/memory'
import * as notionTools from '@/tools/notion'
import * as parallelTools from '@/tools/parallel'
import * as searchTools from '@/tools/search'
import * as slackTools from '@/tools/slack'
import * as tableTools from '@/tools/table'
import type { ToolConfig } from '@/tools/types'
import * as workflowTools from '@/tools/workflow'

const TOOL_MODULES = [
  fileTools,
  functionTools,
  gmailTools,
  httpTools,
  knowledgeTools,
  llmTools,
  logsTools,
  memoryTools,
  notionTools,
  parallelTools,
  searchTools,
  slackTools,
  tableTools,
  workflowTools,
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isToolConfig(value: unknown): value is ToolConfig {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.description === 'string' &&
    typeof value.version === 'string' &&
    isRecord(value.params) &&
    isRecord(value.request)
  )
}

function collectTools(): Record<string, ToolConfig> {
  return Object.fromEntries(
    TOOL_MODULES.flatMap((moduleExports) =>
      Object.values(moduleExports)
        .filter(isToolConfig)
        .map((tool) => [tool.id, tool] as const)
    )
  )
}

const ALL_TOOLS: Record<string, ToolConfig> = collectTools()

export const tools: Record<string, ToolConfig> = filterEnabledToolsRegistry(ALL_TOOLS)
