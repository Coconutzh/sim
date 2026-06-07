import type {
  LocalAgentContext,
  LocalAgentToolName,
  LocalCanvasToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const READ_TOOLS: LocalCanvasToolName[] = [
  'canvas.read_summary',
  'canvas.read_node',
  'canvas.read_selected_nodes',
  'canvas.search_nodes',
  'canvas.inspect_schema',
  'canvas.propose_patch',
  'canvas.verify_patch',
]

const WRITE_TOOLS: LocalCanvasToolName[] = ['canvas.apply_patch', 'canvas.generate_node_output']
const CONTEXT_READ_TOOLS: LocalAgentToolName[] = [
  'read_file',
  'search_workspace',
  'query_knowledge',
  'search_docs',
  'read_tasks',
]
const CONTEXT_WRITE_TOOLS: LocalAgentToolName[] = [
  'materialize_file',
  'update_task_result',
  'submit_task_result',
]

export function selectAvailableLocalAgentTools(context: LocalAgentContext): LocalAgentToolName[] {
  if (!context.permissions.canRead) return []
  return context.permissions.canWrite
    ? [...READ_TOOLS, ...CONTEXT_READ_TOOLS, ...WRITE_TOOLS, ...CONTEXT_WRITE_TOOLS]
    : [...READ_TOOLS, ...CONTEXT_READ_TOOLS]
}

export function selectAvailableCanvasTools(context: LocalAgentContext): LocalCanvasToolName[] {
  return selectAvailableLocalAgentTools(context).filter((tool): tool is LocalCanvasToolName =>
    tool.startsWith('canvas.')
  )
}

export function isCanvasToolAvailable(
  context: LocalAgentContext,
  toolName: LocalAgentToolName
): boolean {
  return selectAvailableLocalAgentTools(context).includes(toolName)
}
