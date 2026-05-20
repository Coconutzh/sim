import { AgentBlock } from '@/blocks/blocks/agent'
import { ApiBlock } from '@/blocks/blocks/api'
import { ChatTriggerBlock } from '@/blocks/blocks/chat_trigger'
import { ConditionBlock } from '@/blocks/blocks/condition'
import { ContentBlock } from '@/blocks/blocks/content'
import { CredentialBlock } from '@/blocks/blocks/credential'
import { FileBlock, FileV2Block, FileV3Block } from '@/blocks/blocks/file'
import { FunctionBlock } from '@/blocks/blocks/function'
import { GenericWebhookBlock } from '@/blocks/blocks/generic_webhook'
import { GmailBlock, GmailV2Block } from '@/blocks/blocks/gmail'
import { HumanInTheLoopBlock } from '@/blocks/blocks/human_in_the_loop'
import { ImageGeneratorBlock } from '@/blocks/blocks/image_generator'
import { InputTriggerBlock } from '@/blocks/blocks/input_trigger'
import { ManualTriggerBlock } from '@/blocks/blocks/manual_trigger'
import { McpBlock } from '@/blocks/blocks/mcp'
import { NoteBlock } from '@/blocks/blocks/note'
import { NotionBlock, NotionV2Block } from '@/blocks/blocks/notion'
import { ParallelBlock } from '@/blocks/blocks/parallel'
import { ResponseBlock } from '@/blocks/blocks/response'
import { RouterBlock, RouterV2Block } from '@/blocks/blocks/router'
import { SearchBlock } from '@/blocks/blocks/search'
import { SlackBlock } from '@/blocks/blocks/slack'
import { StartTriggerBlock } from '@/blocks/blocks/start_trigger'
import { TableBlock } from '@/blocks/blocks/table'
import { VariablesBlock } from '@/blocks/blocks/variables'
import { VideoGeneratorBlock, VideoGeneratorV2Block } from '@/blocks/blocks/video_generator'
import { WebhookRequestBlock } from '@/blocks/blocks/webhook_request'
import { WorkflowBlock } from '@/blocks/blocks/workflow'
import { WorkflowInputBlock } from '@/blocks/blocks/workflow_input'
import type { BlockConfig } from '@/blocks/types'

const ALL_BLOCKS: Record<string, BlockConfig> = {
  agent: AgentBlock,
  api: ApiBlock,
  chat_trigger: ChatTriggerBlock,
  condition: ConditionBlock,
  content: ContentBlock,
  credential: CredentialBlock,
  file: FileBlock,
  file_v2: FileV2Block,
  file_v3: FileV3Block,
  function: FunctionBlock,
  generic_webhook: GenericWebhookBlock,
  gmail: GmailBlock,
  gmail_v2: GmailV2Block,
  human_in_the_loop: HumanInTheLoopBlock,
  image_generator: ImageGeneratorBlock,
  input_trigger: InputTriggerBlock,
  manual_trigger: ManualTriggerBlock,
  mcp: McpBlock,
  note: NoteBlock,
  notion: NotionBlock,
  notion_v2: NotionV2Block,
  parallel: ParallelBlock,
  response: ResponseBlock,
  router: RouterBlock,
  router_v2: RouterV2Block,
  search: SearchBlock,
  slack: SlackBlock,
  start_trigger: StartTriggerBlock,
  table: TableBlock,
  variables: VariablesBlock,
  video_generator: VideoGeneratorBlock,
  video_generator_v2: VideoGeneratorV2Block,
  webhook_request: WebhookRequestBlock,
  workflow: WorkflowBlock,
  workflow_input: WorkflowInputBlock,
}

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
