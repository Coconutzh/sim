import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  loadCanvasSnapshot,
  readCanvasNodeDetail,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context'
import { executeLocalAgentModelRequest } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/config'
import { buildLocalAgentRoleSystemPrompt } from '@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts'
import type {
  CanvasNodeDetail,
  LocalAgentContext,
  LocalAgentToolCall,
  LocalAgentToolResult,
  LocalMediaToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { downloadFileFromStorage, downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'
import { getProviderFromModel } from '@/providers/utils'

type LocalMediaToolCall = LocalAgentToolCall & { name: LocalMediaToolName }
type MediaAnalysisMode =
  | 'prompt_only'
  | 'file_metadata'
  | 'stored_media_context'
  | 'binary_image_analysis'
type MediaAnalysisGoal = 'describe' | 'quality_check' | 'extract_prompt' | 'compare_with_prompt'
type MediaContentEvidence =
  | 'prompt_only'
  | 'file_metadata_only'
  | 'stored_media_context'
  | 'binary_image_analysis'

const logger = createLogger('LocalCanvasAgentMediaTools')
const MEDIA_KINDS = new Set(['image', 'video', 'audio'])
const MEDIA_ANALYSIS_GOALS = new Set<MediaAnalysisGoal>([
  'describe',
  'quality_check',
  'extract_prompt',
  'compare_with_prompt',
])
const MAX_CONTEXT_CHARS = 3000
const MAX_IMAGE_ANALYSIS_BYTES = 8 * 1024 * 1024

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

function getMimeType(file: Record<string, unknown> | null): string {
  const type = asString(file?.type)
  if (type) return type
  const name = asString(file?.name).toLowerCase()
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg'
  if (name.endsWith('.png')) return 'image/png'
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.gif')) return 'image/gif'
  if (name.endsWith('.mp4')) return 'video/mp4'
  if (name.endsWith('.webm')) return 'video/webm'
  if (name.endsWith('.mp3')) return 'audio/mpeg'
  if (name.endsWith('.wav')) return 'audio/wav'
  return ''
}

function toUserFile(file: Record<string, unknown>, fallbackName: string): UserFile {
  const key = asString(file.key)
  const url = asString(file.url) || asString(file.path)
  const name = asString(file.name) || fallbackName
  return {
    id: asString(file.id) || key || url || name,
    name,
    url,
    size: typeof file.size === 'number' ? file.size : 0,
    type: getMimeType(file) || 'application/octet-stream',
    key,
    ...(asString(file.context) ? { context: asString(file.context) } : {}),
  }
}

function supportsImageMessageParts(context: LocalAgentContext): boolean {
  const provider = context.model.provider ?? getProviderFromModel(context.model.model)
  return provider === 'google'
}

function resolveAnalysisMode(params: {
  file: Record<string, unknown> | null
  storedContext: string
  binaryAnalysis: string
}): MediaAnalysisMode {
  if (params.binaryAnalysis) return 'binary_image_analysis'
  if (!params.file) return 'prompt_only'
  return params.storedContext ? 'stored_media_context' : 'file_metadata'
}

function resolveAnalysisGoal(input: Record<string, unknown>): MediaAnalysisGoal {
  const goal = asString(input.analysisGoal)
  return MEDIA_ANALYSIS_GOALS.has(goal as MediaAnalysisGoal)
    ? (goal as MediaAnalysisGoal)
    : 'describe'
}

function buildMediaContentAccess(params: { mode: MediaAnalysisMode; hasFile: boolean }): {
  hasFile: boolean
  binaryFetched: boolean
  contentEvidence: MediaContentEvidence
  canDescribeActualMedia: boolean
  safeDescriptionScope: string
} {
  if (params.mode === 'binary_image_analysis') {
    return {
      hasFile: params.hasFile,
      binaryFetched: true,
      contentEvidence: 'binary_image_analysis',
      canDescribeActualMedia: true,
      safeDescriptionScope:
        'May describe actual image content from fetched binary image bytes and the vision model response.',
    }
  }
  if (params.mode === 'stored_media_context') {
    return {
      hasFile: params.hasFile,
      binaryFetched: false,
      contentEvidence: 'stored_media_context',
      canDescribeActualMedia: true,
      safeDescriptionScope:
        'May describe media only from stored media context and safe metadata; binary bytes were not fetched.',
    }
  }
  if (params.mode === 'file_metadata') {
    return {
      hasFile: params.hasFile,
      binaryFetched: false,
      contentEvidence: 'file_metadata_only',
      canDescribeActualMedia: false,
      safeDescriptionScope:
        'May describe file metadata and prompts only; do not claim to have seen or heard the media content.',
    }
  }
  return {
    hasFile: false,
    binaryFetched: false,
    contentEvidence: 'prompt_only',
    canDescribeActualMedia: false,
    safeDescriptionScope:
      'May describe the generation prompt only; do not claim to have seen or heard generated media.',
  }
}

function buildAnalysisLines(params: {
  detail: CanvasNodeDetail
  file: Record<string, unknown> | null
  storedContext: string
  binaryAnalysis: string
  promptField: { field: string; value: string }
  analysisGoal: MediaAnalysisGoal
  question: string
}): string[] {
  const lines = [
    `节点 "${params.detail.name}" 是 ${params.detail.kind} 类型。`,
    `分析目标：${params.analysisGoal}。`,
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
  if (params.binaryAnalysis) {
    lines.push(`基于真实图片二进制内容的模型分析：${params.binaryAnalysis}`)
  }
  if (params.question) lines.push(`用户关注点：${params.question}`)
  return lines
}

async function fetchMediaBuffer(params: {
  detail: CanvasNodeDetail
  file: Record<string, unknown>
}): Promise<Buffer | null> {
  const userFile = toUserFile(params.file, params.detail.name)
  if (userFile.key) {
    return downloadFileFromStorage(userFile, `local-canvas-agent-${params.detail.id}`, logger)
  }
  if (userFile.url) {
    return downloadFileFromUrl(userFile.url, 15_000)
  }
  return null
}

async function analyzeImageBinary(params: {
  context: LocalAgentContext
  detail: CanvasNodeDetail
  file: Record<string, unknown> | null
  promptField: { field: string; value: string }
  analysisGoal: MediaAnalysisGoal
  question: string
}): Promise<string> {
  if (params.detail.kind !== 'image' || !params.file) return ''
  if (!supportsImageMessageParts(params.context)) return ''
  const mimeType = getMimeType(params.file)
  if (!mimeType.startsWith('image/')) return ''
  try {
    const buffer = await fetchMediaBuffer({
      detail: params.detail,
      file: params.file,
    })
    if (!buffer) return ''
    if (buffer.length > MAX_IMAGE_ANALYSIS_BYTES) return ''
    const response = await executeLocalAgentModelRequest(params.context.model, {
      role: 'decision',
      workspaceId: params.context.workspaceId,
      systemPrompt: buildLocalAgentRoleSystemPrompt({
        context: params.context,
        role: 'decision',
        roleInstruction:
          'Analyze the provided image for a local canvas media tool. Return concise factual observations only. Do not mention hidden storage paths or internal identifiers.',
      }),
      prompt: params.question,
      temperature: 0,
      maxTokens: 500,
      messages: [
        {
          role: 'user',
          content: null,
          parts: [
            {
              type: 'text',
              text: [
                `Analysis goal: ${params.analysisGoal}`,
                `User question: ${params.question}`,
                params.promptField.value
                  ? `Generation prompt: ${params.promptField.value}`
                  : 'No generation prompt is available.',
                'Describe only what can be inferred from the image and prompt.',
              ].join('\n'),
            },
            {
              type: 'image',
              mimeType,
              data: buffer.toString('base64'),
            },
          ],
        },
      ],
      abortSignal: params.context.options.abortSignal,
    })
    return clip(response.content?.trim() ?? '', MAX_CONTEXT_CHARS)
  } catch (error) {
    logger.warn('Failed to analyze image binary for local canvas media node', {
      workspaceId: params.context.workspaceId,
      workflowId: params.context.workflowId,
      nodeId: params.detail.id,
      error: toError(error).message,
    })
    return ''
  }
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
  const analysisGoal = resolveAnalysisGoal(input)
  const binaryAnalysis = await analyzeImageBinary({
    context,
    detail,
    file: fileRecord,
    promptField,
    analysisGoal,
    question,
  })
  const mode = resolveAnalysisMode({ file: fileRecord, storedContext, binaryAnalysis })
  const mediaContentAccess = buildMediaContentAccess({
    mode,
    hasFile: Boolean(fileRecord),
  })

  return {
    nodeId: detail.id,
    kind: detail.kind,
    title: detail.name,
    analysisMode: mode,
    analysisGoal,
    hasFile: Boolean(fileRecord),
    mediaContentAccess,
    file: summarizeFile(fileRecord),
    prompt: {
      field: promptField.field,
      value: promptField.value,
    },
    analysis: buildAnalysisLines({
      detail,
      file: fileRecord,
      storedContext,
      binaryAnalysis,
      promptField,
      analysisGoal,
      question,
    }),
    limitations:
      mode === 'stored_media_context'
        ? 'Analysis uses stored media context and metadata available in the workflow.'
        : mode === 'binary_image_analysis'
          ? 'Analysis uses fetched image bytes and a vision model response; storage paths remain hidden.'
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
