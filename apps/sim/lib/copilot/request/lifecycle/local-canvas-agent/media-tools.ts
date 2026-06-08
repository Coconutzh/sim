import { toError } from '@sim/utils/errors'
import {
  loadCanvasSnapshot,
  readCanvasNodeDetail,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context'
import type {
  CanvasNodeDetail,
  LocalAgentContext,
  LocalAgentToolCall,
  LocalAgentToolResult,
  LocalMediaToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

type LocalMediaToolCall = LocalAgentToolCall & { name: LocalMediaToolName }
type MediaAnalysisMode = 'prompt_only' | 'file_metadata' | 'stored_media_context'

const MEDIA_KINDS = new Set(['image', 'video', 'audio'])
const MAX_CONTEXT_CHARS = 3000

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function clip(value: string, maxLength = MAX_CONTEXT_CHARS): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(0, maxLength - 16))}\n...[truncated]`
}

function requireString(input: Record<string, unknown>, key: string): string {
  const value = asString(input[key])
  if (!value) throw new Error(`${key} is required`)
  return value
}

function getPromptField(detail: CanvasNodeDetail): { field: string; value: string } {
  if (detail.kind === 'image') return { field: 'aiPrompt', value: asString(detail.fields.aiPrompt) }
  if (detail.kind === 'video') {
    return { field: 'videoPrompt', value: asString(detail.fields.videoPrompt) }
  }
  if (detail.kind === 'audio') {
    return { field: 'audioPrompt', value: asString(detail.fields.audioPrompt) }
  }
  return { field: 'summary', value: detail.summary }
}

function summarizeFile(file: Record<string, unknown> | null) {
  if (!file) return null
  const summary: Record<string, unknown> = {}
  for (const key of ['name', 'type', 'size', 'duration', 'width', 'height', 'provider']) {
    const value = file[key]
    if (typeof value === 'string' || typeof value === 'number') summary[key] = value
  }
  if (typeof file.url === 'string') summary.hasUrl = true
  if (typeof file.key === 'string') summary.hasStorageKey = true
  if (typeof file.path === 'string') summary.hasPath = true
  return summary
}

function resolveAnalysisMode(params: {
  file: Record<string, unknown> | null
  storedContext: string
}): MediaAnalysisMode {
  if (!params.file) return 'prompt_only'
  return params.storedContext ? 'stored_media_context' : 'file_metadata'
}

function buildAnalysisLines(params: {
  detail: CanvasNodeDetail
  file: Record<string, unknown> | null
  storedContext: string
  promptField: { field: string; value: string }
  question: string
}): string[] {
  const lines = [
    `节点 "${params.detail.name}" 是 ${params.detail.kind} 类型。`,
    params.promptField.value
      ? `生成提示来自 ${params.promptField.field}：${params.promptField.value}`
      : '这个节点没有可读的生成提示。',
  ]
  if (params.file) {
    const name = asString(params.file.name)
    const type = asString(params.file.type)
    lines.push(`节点已有媒体文件${name ? ` "${name}"` : ''}${type ? `，类型 ${type}` : ''}。`)
  } else {
    lines.push('节点还没有媒体文件，因此不能声称看过真实图片、视频或音频内容。')
  }
  if (params.storedContext) {
    lines.push(`可用的已存媒体上下文：${params.storedContext}`)
  }
  if (params.question) lines.push(`用户关注点：${params.question}`)
  return lines
}

async function analyzeNodeMedia(
  context: LocalAgentContext,
  input: Record<string, unknown>
): Promise<unknown> {
  const nodeId = requireString(input, 'nodeId')
  const question = asString(input.question) || context.message
  const snapshot = await loadCanvasSnapshot({
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
  })
  const detail = readCanvasNodeDetail(snapshot, nodeId, context.selectedNodeIds)
  if (!detail) throw new Error(`Node "${nodeId}" was not found`)
  if (!MEDIA_KINDS.has(detail.kind)) {
    throw new Error(`Node "${nodeId}" is ${detail.kind}, not image, video, or audio`)
  }

  const file = detail.file ?? (asRecord(detail.fields.file) || null)
  const fileRecord = file && Object.keys(file).length > 0 ? file : null
  const storedContext = clip(asString(fileRecord?.context))
  const promptField = getPromptField(detail)
  const mode = resolveAnalysisMode({ file: fileRecord, storedContext })

  return {
    nodeId: detail.id,
    kind: detail.kind,
    title: detail.name,
    analysisMode: mode,
    hasFile: Boolean(fileRecord),
    file: summarizeFile(fileRecord),
    prompt: {
      field: promptField.field,
      value: promptField.value,
    },
    analysis: buildAnalysisLines({
      detail,
      file: fileRecord,
      storedContext,
      promptField,
      question,
    }),
    limitations:
      mode === 'stored_media_context'
        ? 'Analysis uses stored media context and metadata available in the workflow.'
        : mode === 'file_metadata'
          ? 'Analysis uses file metadata only; binary media bytes were not fetched in this local tool.'
          : 'Analysis uses the prompt only because no generated media file is attached.',
  }
}

function summarizeMediaAnalysis(output: unknown): string {
  const record = asRecord(output)
  const kind = asString(record.kind) || 'media'
  const title = asString(record.title) || 'node'
  const mode = asString(record.analysisMode) || 'unknown'
  const hasFile = record.hasFile === true ? 'with file' : 'without file'
  return `Analyzed ${kind} node "${title}" (${mode}, ${hasFile})`
}

export async function executeMediaTool(
  context: LocalAgentContext,
  call: LocalMediaToolCall
): Promise<LocalAgentToolResult> {
  try {
    const output = await analyzeNodeMedia(context, call.input)
    return {
      name: call.name,
      success: true,
      output,
      summary: summarizeMediaAnalysis(output),
    }
  } catch (error) {
    return {
      name: call.name,
      success: false,
      error: toError(error).message,
      summary: toError(error).message,
    }
  }
}
