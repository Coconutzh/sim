import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type ImageGenerationResolution,
  type ImageOutpaintAspectRatio,
  type OutpaintWorkspaceImageBody,
  outpaintWorkspaceImageContract,
} from '@/lib/api/contracts/media-images'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'
import {
  DEFAULT_IMAGE_REPAINT_MODEL,
  type ImageAspectRatioValue,
} from '@/lib/generated-media/image/image-generation-utils'
import { resolveStorageKeyFromFileInput } from '@/lib/uploads/utils/file-utils'

interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

interface OutpaintPlacement {
  x: number
  y: number
  width: number
  height: number
  canvasWidth: number
  canvasHeight: number
}

interface ImageOutpaintReferenceValue {
  sourceBlockId: string
  sourceVariant: string
  role: string
}

export interface SubmitImageOutpaintParams {
  placement: OutpaintPlacement
  resolution: ImageGenerationResolution
  targetAspectRatio: ImageOutpaintAspectRatio
  customAspectRatio?: {
    width: number
    height: number
  }
  prompt?: string
}

interface RunImageOutpaintRequestParams extends SubmitImageOutpaintParams {
  workspaceId?: string
  sourceFile: UploadedFileValue
  targetBlockId: string
  requestOutpaint?: typeof requestWorkspaceImageOutpaint
  onComplete: (targetBlockId: string, file: UploadedFileValue) => void
  onError: (targetBlockId: string, message: string) => void
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return '扩图失败，请稍后重试。'
}

export function normalizeImageOutpaintFile(file: UploadedFileValue) {
  const url = resolveUserFileUrl(file)
  const key =
    resolveStorageKeyFromFileInput({
      key: file.key,
      path: file.path,
      url,
    }) ?? ''
  const name = file.name?.trim() || key || 'image.png'

  return {
    id: file.id ?? '',
    name,
    url,
    key,
    size: file.size ?? 0,
    type: file.type ?? 'image/png',
    context: file.context,
  }
}

export function mapGeneratedImageOutpaintFile(file: {
  id: string
  name: string
  url: string
  key: string
  size: number
  type: string
  context?: string
}): UploadedFileValue {
  return {
    id: file.id,
    name: file.name,
    path: file.url,
    key: file.key,
    size: file.size,
    type: file.type,
    context: file.context,
  }
}

export function buildImageOutpaintPendingSubBlockValues({
  aiAspectRatio,
  reference,
}: {
  aiAspectRatio: ImageAspectRatioValue
  reference: ImageOutpaintReferenceValue
}): Record<string, unknown> {
  return {
    contentVariant: 'image',
    aiPrompt: '',
    aiModel: DEFAULT_IMAGE_REPAINT_MODEL,
    aiAspectRatio,
    file: null,
    contentReferences: [reference],
    generationKind: 'image_outpaint',
    generationStatus: 'pending',
    generationError: null,
  }
}

export async function requestWorkspaceImageOutpaint(body: OutpaintWorkspaceImageBody) {
  return requestJson(outpaintWorkspaceImageContract, { body })
}

export async function runImageOutpaintRequest({
  workspaceId,
  sourceFile,
  targetBlockId,
  placement,
  resolution,
  targetAspectRatio,
  customAspectRatio,
  prompt,
  requestOutpaint = requestWorkspaceImageOutpaint,
  onComplete,
  onError,
}: RunImageOutpaintRequestParams): Promise<void> {
  const normalizedSourceFile = normalizeImageOutpaintFile(sourceFile)

  if (!workspaceId) {
    onError(targetBlockId, '缺少工作区上下文。')
    return
  }

  if (!normalizedSourceFile.key) {
    onError(targetBlockId, '源图片缺少文件信息。')
    return
  }

  try {
    const response = await requestOutpaint({
      workspaceId,
      sourceImage: normalizedSourceFile,
      resolution,
      targetAspectRatio,
      customAspectRatio,
      placement,
      prompt: prompt?.trim() ?? '',
    })

    onComplete(targetBlockId, mapGeneratedImageOutpaintFile(response.file))
  } catch (caughtError) {
    onError(targetBlockId, getErrorMessage(caughtError))
  }
}
