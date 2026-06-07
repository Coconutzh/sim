import type { ProductionTaskStatus } from '@/lib/api/contracts/production-tasks'
import { generateWorkspaceContext } from '@/lib/copilot/chat/workspace-context'
import type {
  LocalAgentAttachedContext,
  LocalAgentAttachment,
  LocalAgentContext,
  LocalAgentToolCall,
  LocalAgentToolName,
  LocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { executeMaterializeFile } from '@/lib/copilot/tools/handlers/materialize-file'
import {
  listProductionTasks,
  submitProductionTask,
  updateProductionTask,
} from '@/lib/production-tasks/service'

const MAX_CONTEXT_OUTPUT = 4000
const TASK_STATUSES = new Set<ProductionTaskStatus>([
  'todo',
  'in_progress',
  'submitted',
  'approved',
  'changes_requested',
  'archived',
])

function clip(value: string, maxLength = MAX_CONTEXT_OUTPUT): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 20))}\n...[truncated]`
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(asString).filter((item) => item.length > 0) : []
}

function requireInputString(input: Record<string, unknown>, key: string): string {
  const value = asString(input[key])
  if (!value) throw new Error(`${key} is required`)
  return value
}

function contextMatches(context: LocalAgentAttachedContext, query: string): boolean {
  if (!query) return true
  const normalized = query.toLowerCase()
  return (
    context.tag.toLowerCase().includes(normalized) ||
    context.type.toLowerCase().includes(normalized) ||
    context.content.toLowerCase().includes(normalized)
  )
}

function attachmentMatches(attachment: LocalAgentAttachment, query: string): boolean {
  if (!query) return true
  const normalized = query.toLowerCase()
  return [attachment.name, attachment.type, attachment.id, attachment.key, attachment.url]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLowerCase().includes(normalized))
}

function sanitizeAttachmentForAgent(
  attachment: LocalAgentAttachment
): Pick<LocalAgentAttachment, 'name' | 'type' | 'size'> {
  return {
    name: attachment.name,
    ...(attachment.type ? { type: attachment.type } : {}),
    ...(typeof attachment.size === 'number' ? { size: attachment.size } : {}),
  }
}

function summarizeAttachments(attachments: LocalAgentAttachment[] | undefined): string {
  if (!attachments?.length) return 'No file attachments are available in this request.'
  return attachments
    .map((attachment) =>
      [
        attachment.name,
        attachment.type ? `type=${attachment.type}` : '',
        typeof attachment.size === 'number' ? `size=${attachment.size}` : '',
      ]
        .filter(Boolean)
        .join(' ')
    )
    .join('\n')
}

async function materializeFileContext(context: LocalAgentContext, input: Record<string, unknown>) {
  const fileNames = asStringArray(input.fileNames)
  const fileName = asString(input.fileName)
  const inferredFileName =
    fileNames.length === 0 && !fileName && context.attachments?.length === 1
      ? context.attachments[0]?.name
      : ''
  const result = await executeMaterializeFile(
    {
      ...input,
      ...(fileNames.length > 0 ? { fileNames } : {}),
      ...(fileName || inferredFileName ? { fileName: fileName || inferredFileName } : {}),
    },
    {
      ...context.execContext,
      userId: context.userId,
      workspaceId: context.workspaceId,
      workflowId: context.workflowId,
      chatId: context.chatId,
    }
  )
  if (!result.success) {
    throw new Error(result.error ?? 'Failed to materialize file')
  }
  return {
    output: result.output,
    resources: result.resources ?? [],
    summary: 'Saved uploaded file context into workspace storage',
  }
}

function readFileContext(context: LocalAgentContext, input: Record<string, unknown>) {
  const query = asString(input.fileName) || asString(input.tag) || asString(input.query)
  const fileContexts = (context.attachedContexts ?? []).filter(
    (item) => item.type === 'file' && contextMatches(item, query)
  )
  const attachments = (context.attachments ?? []).filter((attachment) =>
    attachmentMatches(attachment, query)
  )
  if (!fileContexts.length && !attachments.length) {
    throw new Error('No matching attached file context was found')
  }
  return {
    query,
    files: attachments.map(sanitizeAttachmentForAgent),
    contexts: fileContexts.map((item) => ({
      type: item.type,
      tag: item.tag,
      content: clip(item.content),
    })),
    summary: fileContexts.length
      ? `Read ${fileContexts.length} attached file context(s)`
      : `Found ${attachments.length} attached file metadata record(s)`,
  }
}

async function searchWorkspaceContext(context: LocalAgentContext) {
  const workspaceContext = await generateWorkspaceContext(context.workspaceId, context.userId)
  return {
    workspaceId: context.workspaceId,
    content: clip(workspaceContext),
    summary: 'Read workspace inventory context',
  }
}

function queryAttachedContexts(params: {
  context: LocalAgentContext
  input: Record<string, unknown>
  type: 'knowledge' | 'docs'
}) {
  const query = asString(params.input.query) || params.context.message
  const matches = (params.context.attachedContexts ?? [])
    .filter((item) => item.type === params.type && contextMatches(item, query))
    .slice(0, 8)
    .map((item) => ({
      type: item.type,
      tag: item.tag,
      content: clip(item.content, 1200),
    }))
  return {
    query,
    results: matches,
    summary: matches.length
      ? `Found ${matches.length} attached ${params.type} context result(s)`
      : `No attached ${params.type} context matched the query`,
  }
}

async function readProductionTasks(context: LocalAgentContext, input: Record<string, unknown>) {
  const status = asString(input.status)
  const tasks = await listProductionTasks({
    userId: context.userId,
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    scope: 'auto',
    ...(TASK_STATUSES.has(status as ProductionTaskStatus)
      ? { status: status as ProductionTaskStatus }
      : {}),
    limit: 20,
  })
  return {
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.dueAt,
      sourceWorkflowId: task.sourceWorkflowId,
      resultWorkflowId: task.resultWorkflowId,
      assigneeWorkgroup: task.assigneeWorkgroup.name,
      sourceWorkgroup: task.sourceWorkgroup.name,
    })),
    summary: `Read ${tasks.length} production task(s) for the current workflow`,
  }
}

async function updateTaskResult(context: LocalAgentContext, input: Record<string, unknown>) {
  const taskId = requireInputString(input, 'taskId')
  const status = asString(input.status)
  const task = await updateProductionTask({
    userId: context.userId,
    taskId,
    ...(asString(input.title) ? { title: asString(input.title) } : {}),
    ...(typeof input.description === 'string' ? { description: input.description } : {}),
    ...(typeof input.dueAt === 'string' || input.dueAt === null
      ? { dueAt: input.dueAt as string | null }
      : {}),
    ...(TASK_STATUSES.has(status as ProductionTaskStatus)
      ? { status: status as ProductionTaskStatus }
      : {}),
  })
  return {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      dueAt: task.dueAt,
      resultWorkflowId: task.resultWorkflowId,
      resultNodeId: task.resultNodeId,
    },
    summary: `Updated production task "${task.title}" to status ${task.status}`,
  }
}

async function submitTaskResult(context: LocalAgentContext, input: Record<string, unknown>) {
  const taskId = requireInputString(input, 'taskId')
  const nodeId = asString(input.nodeId) || context.selectedNodeIds[0]
  const submissionNote = asString(input.submissionNote) || asString(input.note) || context.message
  const task = await submitProductionTask({
    userId: context.userId,
    taskId,
    workspaceId: context.workspaceId,
    ...(nodeId ? { workflowId: context.workflowId, nodeId } : {}),
    submissionNote,
  })
  return {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      resultWorkflowId: task.resultWorkflowId,
      resultNodeId: task.resultNodeId,
      submittedAt: task.submittedAt,
    },
    summary: `Submitted production task "${task.title}" with status ${task.status}`,
  }
}

function summarizeOutput(toolName: LocalAgentToolName, output: unknown): string {
  if (output && typeof output === 'object' && 'summary' in output) {
    const summary = (output as { summary?: unknown }).summary
    if (typeof summary === 'string') return summary
  }
  return `Executed ${toolName}`
}

export async function executeContextTool(
  context: LocalAgentContext,
  call: LocalAgentToolCall
): Promise<LocalAgentToolResult> {
  try {
    const output =
      call.name === 'read_file'
        ? readFileContext(context, call.input)
        : call.name === 'search_workspace'
          ? await searchWorkspaceContext(context)
          : call.name === 'materialize_file'
            ? await materializeFileContext(context, call.input)
            : call.name === 'query_knowledge'
              ? queryAttachedContexts({ context, input: call.input, type: 'knowledge' })
              : call.name === 'search_docs'
                ? queryAttachedContexts({ context, input: call.input, type: 'docs' })
                : call.name === 'read_tasks'
                  ? await readProductionTasks(context, call.input)
                  : call.name === 'update_task_result'
                    ? await updateTaskResult(context, call.input)
                    : call.name === 'submit_task_result'
                      ? await submitTaskResult(context, call.input)
                      : null
    if (!output) throw new Error(`Unsupported local agent context tool: ${call.name}`)
    return {
      name: call.name,
      success: true,
      output,
      summary: summarizeOutput(call.name, output),
    }
  } catch (error) {
    return {
      name: call.name,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      summary: error instanceof Error ? error.message : String(error),
    }
  }
}
