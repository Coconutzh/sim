'use client'

import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type EraseWorkspaceImageBody,
  eraseWorkspaceImageContract,
  type GenerateWorkspaceImageBody,
  generateWorkspaceImageContract,
  type ImageGenerationResolution,
  type RepaintWorkspaceImageBody,
  repaintWorkspaceImageContract,
} from '@/lib/api/contracts/media-images'
import { resolveUserFileUrl } from '@/lib/core/utils/user-file'
import {
  DEFAULT_IMAGE_REPAINT_MODEL,
  type ImageAspectRatioValue,
  type ImageGenerationModelId,
} from '@/lib/generated-media/image/image-generation-utils'
import type { ContentReferenceRecord } from '@/lib/workflows/content-references'
import type { ImagePerspectiveValues } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/image-perspective-menu'

export interface UploadedFileValue {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
  base64?: string
}

export interface ExportedImageMask {
  base64: string
  size: number
}

export interface ImagePerspectiveGenerationRequest {
  model: ImageGenerationModelId
  prompt: string
  values: ImagePerspectiveValues
}

export interface ImageRepaintGenerationRequest {
  prompt: string
  resolution: ImageGenerationResolution
  maskImage: UploadedFileValue
  referenceImages: UploadedFileValue[]
}

export interface ImageEraseGenerationRequest {
  resolution: ImageGenerationResolution
  maskImage: UploadedFileValue
}

export interface SubmitImageRepaintParams {
  prompt: string
  resolution: ImageGenerationResolution
  mask: ExportedImageMask
  referenceImages: UploadedFileValue[]
}

export interface SubmitImageEraseParams {
  resolution: ImageGenerationResolution
  mask: ExportedImageMask
}

export type DerivedImageGenerationKind = 'image_perspective' | 'image_repaint' | 'image_erase'

interface RunImagePerspectiveRequestParams {
  workspaceId?: string
  sourceFile: UploadedFileValue
  targetBlockId: string
  request: ImagePerspectiveGenerationRequest
  requestPerspective?: typeof requestWorkspaceImagePerspective
  onComplete: (targetBlockId: string, file: UploadedFileValue) => void
  onError: (targetBlockId: string, message: string) => void
}

interface RunImageRepaintRequestParams {
  workspaceId?: string
  sourceFile: UploadedFileValue
  targetBlockId: string
  request: ImageRepaintGenerationRequest
  requestRepaint?: typeof requestWorkspaceImageRepaint
  onComplete: (targetBlockId: string, file: UploadedFileValue) => void
  onError: (targetBlockId: string, message: string) => void
}

interface RunImageEraseRequestParams {
  workspaceId?: string
  sourceFile: UploadedFileValue
  targetBlockId: string
  request: ImageEraseGenerationRequest
  requestErase?: typeof requestWorkspaceImageErase
  onComplete: (targetBlockId: string, file: UploadedFileValue) => void
  onError: (targetBlockId: string, message: string) => void
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) return error.message
  if (error instanceof Error && error.message) return error.message
  return fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeDerivedImageFile(file: UploadedFileValue) {
  const key = file.key?.trim() ?? ''
  const name = file.name?.trim() || key || 'image.png'

  return {
    id: file.id ?? '',
    name,
    url: resolveUserFileUrl(file),
    key,
    size: file.size ?? 0,
    type: file.type ?? 'image/png',
    context: file.context,
    base64: file.base64,
  }
}

export function createMaskImageFile(name: string, mask: ExportedImageMask): UploadedFileValue {
  return {
    id: '',
    name,
    path: '',
    key: name,
    size: mask.size,
    type: 'image/png',
    base64: mask.base64,
  }
}

export function mapGeneratedDerivedImageFile(file: {
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

export function buildImagePerspectivePendingSubBlockValues({
  reference,
  request,
}: {
  reference: ContentReferenceRecord
  request: ImagePerspectiveGenerationRequest
}): Record<string, unknown> {
  return {
    contentVariant: 'image',
    aiPrompt: request.prompt,
    aiModel: request.model,
    aiAspectRatio: 'auto' satisfies ImageAspectRatioValue,
    file: null,
    contentReferences: [reference],
    generationKind: 'image_perspective',
    generationStatus: 'pending',
    generationError: null,
    imagePerspectiveRequest: request,
  }
}

export function buildImageRepaintPendingSubBlockValues({
  reference,
  request,
}: {
  reference: ContentReferenceRecord
  request: ImageRepaintGenerationRequest
}): Record<string, unknown> {
  return {
    contentVariant: 'image',
    aiPrompt: '',
    aiModel: DEFAULT_IMAGE_REPAINT_MODEL,
    aiAspectRatio: 'auto' satisfies ImageAspectRatioValue,
    file: null,
    contentReferences: [reference],
    generationKind: 'image_repaint',
    generationStatus: 'pending',
    generationError: null,
    imageRepaintRequest: request,
  }
}

export function buildImageErasePendingSubBlockValues({
  reference,
  request,
}: {
  reference: ContentReferenceRecord
  request: ImageEraseGenerationRequest
}): Record<string, unknown> {
  return {
    contentVariant: 'image',
    aiPrompt: '',
    aiModel: DEFAULT_IMAGE_REPAINT_MODEL,
    aiAspectRatio: 'auto' satisfies ImageAspectRatioValue,
    file: null,
    contentReferences: [reference],
    generationKind: 'image_erase',
    generationStatus: 'pending',
    generationError: null,
    imageEraseRequest: request,
  }
}

export function getImagePerspectiveRequestMetadata(
  value: unknown
): ImagePerspectiveGenerationRequest | null {
  if (!isRecord(value)) return null
  const { model, prompt, values } = value
  if (typeof model !== 'string' || typeof prompt !== 'string' || !isRecord(values)) return null
  const { rotation, tilt, zoom, wideAngle } = values
  if (
    typeof rotation !== 'number' ||
    typeof tilt !== 'number' ||
    typeof zoom !== 'number' ||
    typeof wideAngle !== 'boolean'
  ) {
    return null
  }
  return {
    model: model as ImageGenerationModelId,
    prompt,
    values: { rotation, tilt, zoom, wideAngle },
  }
}

export function getImageRepaintRequestMetadata(
  value: unknown
): ImageRepaintGenerationRequest | null {
  if (!isRecord(value)) return null
  const { prompt, resolution, maskImage, referenceImages } = value
  if (
    typeof prompt !== 'string' ||
    !isImageGenerationResolution(resolution) ||
    !isUploadedFileValue(maskImage) ||
    !Array.isArray(referenceImages) ||
    !referenceImages.every(isUploadedFileValue)
  ) {
    return null
  }
  return { prompt, resolution, maskImage, referenceImages }
}

export function getImageEraseRequestMetadata(value: unknown): ImageEraseGenerationRequest | null {
  if (!isRecord(value)) return null
  const { resolution, maskImage } = value
  if (!isImageGenerationResolution(resolution) || !isUploadedFileValue(maskImage)) return null
  return { resolution, maskImage }
}

function isImageGenerationResolution(value: unknown): value is ImageGenerationResolution {
  return value === '1K' || value === '2K' || value === '4K'
}

function isUploadedFileValue(value: unknown): value is UploadedFileValue {
  if (!isRecord(value)) return false
  return (
    typeof value.name === 'string' &&
    typeof value.key === 'string' &&
    (value.id === undefined || typeof value.id === 'string') &&
    (value.path === undefined || typeof value.path === 'string') &&
    (value.size === undefined || typeof value.size === 'number') &&
    (value.type === undefined || typeof value.type === 'string') &&
    (value.context === undefined || typeof value.context === 'string') &&
    (value.base64 === undefined || typeof value.base64 === 'string')
  )
}

export async function requestWorkspaceImagePerspective(body: GenerateWorkspaceImageBody) {
  return requestJson(generateWorkspaceImageContract, { body })
}

export async function requestWorkspaceImageRepaint(body: RepaintWorkspaceImageBody) {
  return requestJson(repaintWorkspaceImageContract, { body })
}

export async function requestWorkspaceImageErase(body: EraseWorkspaceImageBody) {
  return requestJson(eraseWorkspaceImageContract, { body })
}

export async function runImagePerspectiveRequest({
  workspaceId,
  sourceFile,
  targetBlockId,
  request,
  requestPerspective = requestWorkspaceImagePerspective,
  onComplete,
  onError,
}: RunImagePerspectiveRequestParams): Promise<void> {
  const normalizedSourceFile = normalizeDerivedImageFile(sourceFile)
  if (!workspaceId) {
    onError(targetBlockId, 'Missing workspace context.')
    return
  }
  if (!normalizedSourceFile.key) {
    onError(targetBlockId, 'Source image is missing file information.')
    return
  }

  try {
    const response = await requestPerspective({
      workspaceId,
      model: request.model,
      prompt: request.prompt,
      aspectRatio: 'auto',
      referenceContext: {
        text: [],
        images: [normalizedSourceFile],
      },
    })
    onComplete(targetBlockId, mapGeneratedDerivedImageFile(response.file))
  } catch (caughtError) {
    onError(targetBlockId, getErrorMessage(caughtError, 'Failed to create image variant.'))
  }
}

export async function runImageRepaintRequest({
  workspaceId,
  sourceFile,
  targetBlockId,
  request,
  requestRepaint = requestWorkspaceImageRepaint,
  onComplete,
  onError,
}: RunImageRepaintRequestParams): Promise<void> {
  const normalizedSourceFile = normalizeDerivedImageFile(sourceFile)
  if (!workspaceId) {
    onError(targetBlockId, 'Missing workspace context.')
    return
  }
  if (!normalizedSourceFile.key) {
    onError(targetBlockId, 'Source image is missing file information.')
    return
  }

  try {
    const response = await requestRepaint({
      workspaceId,
      prompt: request.prompt,
      resolution: request.resolution,
      sourceImage: normalizedSourceFile,
      maskImage: normalizeDerivedImageFile(request.maskImage),
      referenceImages: request.referenceImages.map(normalizeDerivedImageFile),
    })
    onComplete(targetBlockId, mapGeneratedDerivedImageFile(response.file))
  } catch (caughtError) {
    onError(targetBlockId, getErrorMessage(caughtError, 'Repaint failed. Please try again.'))
  }
}

export async function runImageEraseRequest({
  workspaceId,
  sourceFile,
  targetBlockId,
  request,
  requestErase = requestWorkspaceImageErase,
  onComplete,
  onError,
}: RunImageEraseRequestParams): Promise<void> {
  const normalizedSourceFile = normalizeDerivedImageFile(sourceFile)
  if (!workspaceId) {
    onError(targetBlockId, 'Missing workspace context.')
    return
  }
  if (!normalizedSourceFile.key) {
    onError(targetBlockId, 'Source image is missing file information.')
    return
  }

  try {
    const response = await requestErase({
      workspaceId,
      sourceImage: normalizedSourceFile,
      maskImage: normalizeDerivedImageFile(request.maskImage),
      resolution: request.resolution,
    })
    onComplete(targetBlockId, mapGeneratedDerivedImageFile(response.file))
  } catch (caughtError) {
    onError(targetBlockId, getErrorMessage(caughtError, 'Erase failed. Please try again.'))
  }
}
