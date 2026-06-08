import { z } from 'zod'
import type {
  LocalAgentContext,
  LocalAgentObservation,
  LocalAgentToolName,
  LocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export interface LocalAgentToolDescriptor<
  Input extends Record<string, unknown> = Record<string, unknown>,
> {
  name: LocalAgentToolName
  title: string
  description: string
  inputSchema: z.ZodType<Input>
  outputSchema?: z.ZodType<unknown>
  isEnabled(context: LocalAgentContext): boolean
  isReadOnly(input: Input): boolean
  isDestructive?(input: Input): boolean
  isConcurrencySafe(input: Input): boolean
  interruptBehavior?(input: Input): 'cancel' | 'block'
  summarizeResult(result: LocalAgentToolResult): LocalAgentObservation
}

const emptyInputSchema = z.object({}).passthrough()
function requiredString(field: string) {
  return z.preprocess(
    (value) => (typeof value === 'string' ? value : ''),
    z.string().min(1, `${field} is required`)
  )
}

const patchInputSchema = z
  .object({
    patch: z.unknown(),
  })
  .passthrough()
const nodeInputSchema = z
  .object({
    nodeId: requiredString('nodeId'),
  })
  .passthrough()
const mediaAnalyzeInputSchema = z
  .object({
    nodeId: requiredString('nodeId'),
    question: z.string().optional(),
  })
  .passthrough()
const searchInputSchema = z
  .object({
    query: z.string().optional(),
  })
  .passthrough()
const schemaInputSchema = z
  .object({
    kind: z.string().optional(),
  })
  .passthrough()
const generationVerifyInputSchema = z
  .object({
    patch: z.unknown().optional(),
    generation: z.unknown().optional(),
  })
  .passthrough()
const genericInputSchema = z.record(z.string(), z.unknown())

function hasWritePermission(context: LocalAgentContext): boolean {
  return context.permissions.canRead && context.permissions.canWrite
}

function summarizeToolResult(result: LocalAgentToolResult): LocalAgentObservation {
  return {
    toolName: result.name,
    summary: result.summary,
    success: result.success,
    timestamp: new Date().toISOString(),
    output: result.output,
  }
}

function patchContainsDestructiveOperation(input: Record<string, unknown>): boolean {
  const patch = input.patch
  if (!patch || typeof patch !== 'object') return false
  const operations = (patch as { operations?: unknown }).operations
  if (!Array.isArray(operations)) return false
  return operations.some((operation) => {
    if (!operation || typeof operation !== 'object') return false
    const type = (operation as { type?: unknown }).type
    return type === 'delete_node' || type === 'clear_canvas'
  })
}

function descriptor<Input extends Record<string, unknown>>(params: {
  name: LocalAgentToolName
  title: string
  description: string
  inputSchema?: z.ZodType<Input>
  enabled?: (context: LocalAgentContext) => boolean
  readOnly: boolean | ((input: Input) => boolean)
  destructive?: (input: Input) => boolean
  concurrencySafe?: boolean | ((input: Input) => boolean)
  interruptBehavior?: (input: Input) => 'cancel' | 'block'
}): LocalAgentToolDescriptor<Input> {
  return {
    name: params.name,
    title: params.title,
    description: params.description,
    inputSchema: params.inputSchema ?? (genericInputSchema as z.ZodType<Input>),
    isEnabled: params.enabled ?? ((context) => context.permissions.canRead),
    isReadOnly: (input) =>
      typeof params.readOnly === 'function' ? params.readOnly(input) : params.readOnly,
    isDestructive: params.destructive,
    isConcurrencySafe: (input) =>
      typeof params.concurrencySafe === 'function'
        ? params.concurrencySafe(input)
        : Boolean(params.concurrencySafe),
    interruptBehavior: params.interruptBehavior,
    summarizeResult: summarizeToolResult,
  }
}

const DESCRIPTORS = [
  descriptor({
    name: 'canvas.read_summary',
    title: '读取画布',
    description: 'Read the current canvas node summaries and edges.',
    inputSchema: emptyInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'canvas.read_node',
    title: '读取节点',
    description: 'Read one canvas node detail by nodeId.',
    inputSchema: nodeInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'canvas.read_selected_nodes',
    title: '读取选中节点',
    description: 'Read details for nodes currently selected by the user.',
    inputSchema: emptyInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'canvas.search_nodes',
    title: '搜索画布节点',
    description: 'Search canvas nodes by text, type, title, or field summary.',
    inputSchema: searchInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'canvas.inspect_schema',
    title: '检查节点结构',
    description: 'Inspect editable fields and constraints for content node kinds.',
    inputSchema: schemaInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'canvas.propose_patch',
    title: '准备画布修改方案',
    description: 'Validate and summarize a canvas patch without mutating the workflow.',
    inputSchema: patchInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'canvas.apply_patch',
    title: '更新画布',
    description: 'Apply a validated canvas patch through the workflow edit tool.',
    inputSchema: patchInputSchema,
    enabled: hasWritePermission,
    readOnly: false,
    destructive: patchContainsDestructiveOperation,
    concurrencySafe: false,
  }),
  descriptor({
    name: 'canvas.verify_patch',
    title: '验证画布',
    description: 'Re-read the workflow and verify that a patch or generation wrote back.',
    inputSchema: generationVerifyInputSchema,
    readOnly: true,
    concurrencySafe: false,
  }),
  descriptor({
    name: 'canvas.generate_node_output',
    title: '生成节点内容',
    description: 'Run the appropriate generation provider for a node and write back output.',
    inputSchema: nodeInputSchema,
    enabled: hasWritePermission,
    readOnly: false,
    concurrencySafe: false,
    interruptBehavior: () => 'block',
  }),
  descriptor({
    name: 'media.analyze_node_media',
    title: '分析媒体',
    description:
      'Analyze an image, video, or audio canvas node using stored media context, file metadata, and prompt fields.',
    inputSchema: mediaAnalyzeInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'read_file',
    title: '读取文件上下文',
    description: 'Read attached file context that is already available to this request.',
    inputSchema: genericInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'search_workspace',
    title: '搜索工作区',
    description: 'Read workspace inventory context.',
    inputSchema: genericInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'query_knowledge',
    title: '查询知识库',
    description: 'Search attached knowledge context.',
    inputSchema: searchInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'search_docs',
    title: '搜索文档',
    description: 'Search attached documentation context.',
    inputSchema: searchInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'read_tasks',
    title: '读取任务',
    description: 'Read production tasks connected to the current workflow.',
    inputSchema: genericInputSchema,
    readOnly: true,
    concurrencySafe: true,
  }),
  descriptor({
    name: 'materialize_file',
    title: '保存文件到工作区',
    description: 'Save uploaded file context into workspace storage.',
    inputSchema: genericInputSchema,
    enabled: hasWritePermission,
    readOnly: false,
    concurrencySafe: false,
  }),
  descriptor({
    name: 'update_task_result',
    title: '更新任务结果',
    description: 'Update production task metadata or status.',
    inputSchema: genericInputSchema,
    enabled: hasWritePermission,
    readOnly: false,
    concurrencySafe: false,
  }),
  descriptor({
    name: 'submit_task_result',
    title: '提交任务结果',
    description: 'Submit current workflow/node output as a production task result.',
    inputSchema: genericInputSchema,
    enabled: hasWritePermission,
    readOnly: false,
    concurrencySafe: false,
  }),
] as const satisfies readonly LocalAgentToolDescriptor[]

export const LOCAL_AGENT_TOOL_DESCRIPTORS: readonly LocalAgentToolDescriptor[] = DESCRIPTORS

const DESCRIPTOR_BY_NAME = new Map<LocalAgentToolName, LocalAgentToolDescriptor>(
  LOCAL_AGENT_TOOL_DESCRIPTORS.map((item) => [item.name, item])
)

export function getLocalAgentToolDescriptor(
  toolName: LocalAgentToolName
): LocalAgentToolDescriptor | undefined {
  return DESCRIPTOR_BY_NAME.get(toolName)
}

export function getLocalAgentToolTitle(toolName: LocalAgentToolName): string {
  return getLocalAgentToolDescriptor(toolName)?.title ?? toolName
}
