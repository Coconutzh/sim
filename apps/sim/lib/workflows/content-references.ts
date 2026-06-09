import { uniq } from 'es-toolkit/array'
import { getContentReferenceCapability as getCatalogContentReferenceCapability } from '@/lib/content-canvas/model-catalog'
import type { UserFileLike } from '@/lib/core/utils/user-file'

export type {
  ContentNodeVariant,
  ContentReferenceCapability,
  ContentReferenceRole,
  ContentReferenceSelectionMode,
  ContentReferenceSlotCapability,
} from '@/lib/workflows/content-reference-types'

import type {
  ContentNodeVariant,
  ContentReferenceCapability,
  ContentReferenceRole,
} from '@/lib/workflows/content-reference-types'

const CONTENT_NODE_VARIANTS = ['text', 'image', 'video', 'audio'] as const

const REFERENCE_TARGET_VARIANTS_BY_SOURCE: Record<
  ContentNodeVariant,
  readonly ContentNodeVariant[]
> = {
  text: ['text', 'image', 'video', 'audio'],
  image: ['text', 'image', 'video'],
  video: ['text'],
  audio: ['video'],
} as const

export interface ContentReferenceRecord {
  sourceBlockId: string
  sourceVariant: ContentNodeVariant
  role: ContentReferenceRole
}

export interface PromptContextReferencedNode {
  name?: string
  variant: ContentNodeVariant
  textContent?: string | null
  file?: UserFileLike | null
}

interface ContentReferenceEdgeLike {
  id?: string
  source: string
  target: string
  data?: {
    kind?: unknown
    autoLinkType?: unknown
  }
}

interface VideoMediaReferenceLike {
  type: 'first_frame' | 'last_frame'
  file: {
    key?: string | null
  }
}

const TEXT_MULTI_CAPABILITY: Omit<ContentReferenceCapability, 'model'> = {
  authMode: 'api_key_only',
  targetVariant: 'text',
  selectionMode: 'multi',
  allowedSourceVariants: ['text', 'video'],
  supportedRoles: ['text_context'],
  slots: [],
}

const TEXT_MULTIMODAL_CAPABILITY: Omit<ContentReferenceCapability, 'model'> = {
  authMode: 'api_key_only',
  targetVariant: 'text',
  selectionMode: 'multi',
  allowedSourceVariants: ['text', 'image', 'video'],
  supportedRoles: ['text_context', 'image_reference'],
  slots: [],
}

const AUDIO_MULTI_CAPABILITY: Omit<ContentReferenceCapability, 'model'> = {
  authMode: 'api_key_only',
  targetVariant: 'audio',
  selectionMode: 'multi',
  allowedSourceVariants: ['text'],
  supportedRoles: ['text_context'],
  slots: [],
}

const IMAGE_TEXT_ONLY_CAPABILITY: Omit<ContentReferenceCapability, 'model'> = {
  authMode: 'api_key_only',
  targetVariant: 'image',
  selectionMode: 'multi',
  allowedSourceVariants: ['text'],
  supportedRoles: ['text_context'],
  slots: [],
}

const IMAGE_TEXT_AND_IMAGE_CAPABILITY: Omit<ContentReferenceCapability, 'model'> = {
  authMode: 'api_key_only',
  targetVariant: 'image',
  selectionMode: 'multi',
  allowedSourceVariants: ['text', 'image'],
  supportedRoles: ['text_context', 'image_reference'],
  slots: [],
}

const VIDEO_TEXT_ONLY_CAPABILITY: Omit<ContentReferenceCapability, 'model'> = {
  authMode: 'api_key_only',
  targetVariant: 'video',
  selectionMode: 'slot',
  allowedSourceVariants: ['text', 'audio'],
  supportedRoles: ['text_context', 'audio_reference'],
  slots: [],
}

const VIDEO_FIRST_FRAME_CAPABILITY: Omit<ContentReferenceCapability, 'model'> = {
  authMode: 'api_key_only',
  targetVariant: 'video',
  selectionMode: 'slot',
  allowedSourceVariants: ['text', 'image', 'audio'],
  supportedRoles: ['text_context', 'video_first_frame', 'audio_reference'],
  slots: [{ role: 'video_first_frame', sourceVariants: ['image'], maxCount: 1 }],
}

const VIDEO_FIRST_AND_LAST_CAPABILITY: Omit<ContentReferenceCapability, 'model'> = {
  authMode: 'api_key_only',
  targetVariant: 'video',
  selectionMode: 'slot',
  allowedSourceVariants: ['text', 'image', 'audio'],
  supportedRoles: ['text_context', 'video_first_frame', 'video_last_frame', 'audio_reference'],
  slots: [
    { role: 'video_first_frame', sourceVariants: ['image'], maxCount: 1 },
    { role: 'video_last_frame', sourceVariants: ['image'], maxCount: 1 },
  ],
}

function capabilityKey(targetVariant: ContentNodeVariant, model: string): string {
  return `${targetVariant}:${model}`
}

function isContentNodeVariant(value: unknown): value is ContentNodeVariant {
  return CONTENT_NODE_VARIANTS.some((variant) => variant === value)
}

function isContentReferenceRole(value: unknown): value is ContentReferenceRole {
  return (
    value === 'text_context' ||
    value === 'image_reference' ||
    value === 'video_first_frame' ||
    value === 'video_last_frame' ||
    value === 'audio_reference'
  )
}

function isContentReferenceEdgeLike(edge: ContentReferenceEdgeLike): boolean {
  return edge.data?.kind === 'content_reference'
}

function getRoleFromAutoLinkType(autoLinkType: unknown): ContentReferenceRole | null {
  if (autoLinkType === 'video_first_frame') return 'video_first_frame'
  if (autoLinkType === 'video_last_frame') return 'video_last_frame'
  return null
}

function defaultCapabilityForVariant(
  targetVariant: ContentNodeVariant,
  model: string
): ContentReferenceCapability {
  if (targetVariant === 'text') {
    return { ...TEXT_MULTI_CAPABILITY, model }
  }
  if (targetVariant === 'image') {
    return { ...IMAGE_TEXT_ONLY_CAPABILITY, model }
  }
  if (targetVariant === 'audio') {
    return { ...AUDIO_MULTI_CAPABILITY, model }
  }
  return { ...VIDEO_TEXT_ONLY_CAPABILITY, model }
}

function getAllowedRolesForSourceVariant(
  capability: ContentReferenceCapability,
  sourceVariant: ContentNodeVariant
): ContentReferenceRole[] {
  if (!canContentNodeVariantReferenceSource(capability.targetVariant, sourceVariant)) {
    return []
  }

  if (!capability.allowedSourceVariants.includes(sourceVariant)) {
    return []
  }

  if (capability.selectionMode === 'slot') {
    const slotRoles = capability.slots
      .filter((slot) => slot.sourceVariants.includes(sourceVariant))
      .map((slot) => slot.role)
    if (slotRoles.length > 0) return slotRoles
  }

  if (sourceVariant === 'text') {
    return capability.supportedRoles.filter((role) => role === 'text_context')
  }
  if (sourceVariant === 'image') {
    const roles = capability.supportedRoles.filter(
      (role) => role === 'image_reference' || role === 'text_context'
    )
    return roles.sort((left, right) => {
      if (left === 'image_reference') return -1
      if (right === 'image_reference') return 1
      return 0
    })
  }
  if (sourceVariant === 'audio') {
    const roles = capability.supportedRoles.filter(
      (role) => role === 'audio_reference' || role === 'text_context'
    )
    return roles.sort((left, right) => {
      if (left === 'audio_reference') return -1
      if (right === 'audio_reference') return 1
      return 0
    })
  }

  return capability.supportedRoles.filter((role) => role === 'text_context')
}

function getHumanVariantLabel(variant: ContentNodeVariant): string {
  return variant
}

export function getContentReferenceCapability(
  targetVariant: ContentNodeVariant,
  model: string
): ContentReferenceCapability {
  return (
    getCatalogContentReferenceCapability({
      targetVariant,
      model,
    }) ?? defaultCapabilityForVariant(targetVariant, model)
  )
}

export function getAllowedReferenceSourceVariants(
  targetVariant: ContentNodeVariant,
  model: string
): ContentNodeVariant[] {
  return getContentReferenceCapability(targetVariant, model).allowedSourceVariants.filter(
    (sourceVariant) => canContentNodeVariantReferenceSource(targetVariant, sourceVariant)
  )
}

export function canContentNodeVariantReferenceSource(
  targetVariant: ContentNodeVariant,
  sourceVariant: ContentNodeVariant
): boolean {
  return REFERENCE_TARGET_VARIANTS_BY_SOURCE[sourceVariant].includes(targetVariant)
}

export function getAllowedReferencingContentNodeVariants(
  sourceVariant: ContentNodeVariant
): ContentNodeVariant[] {
  return CONTENT_NODE_VARIANTS.filter((targetVariant) =>
    canContentNodeVariantReferenceSource(targetVariant, sourceVariant)
  )
}

export function getModelReferenceCompatibility(params: {
  targetVariant: ContentNodeVariant
  model: string
  references: ContentReferenceRecord[]
}): {
  compatible: boolean
  disabledReason: string | null
} {
  const disabledReason = getModelDisabledReason(params)
  return {
    compatible: !disabledReason,
    disabledReason,
  }
}

export function normalizeContentReferences(value: unknown): ContentReferenceRecord[] {
  const rawReferences =
    typeof value === 'string' && value.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(value) as unknown
            return Array.isArray(parsed) ? parsed : []
          } catch {
            return []
          }
        })()
      : value

  if (!Array.isArray(rawReferences)) return []

  const normalized = rawReferences.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    if (
      typeof candidate.sourceBlockId !== 'string' ||
      candidate.sourceBlockId.trim().length === 0 ||
      !isContentNodeVariant(candidate.sourceVariant) ||
      !isContentReferenceRole(candidate.role)
    ) {
      return []
    }

    return [
      {
        sourceBlockId: candidate.sourceBlockId.trim(),
        sourceVariant: candidate.sourceVariant,
        role: candidate.role,
      } satisfies ContentReferenceRecord,
    ]
  })

  return normalized.filter(
    (reference, index, items) =>
      items.findIndex(
        (candidate) =>
          candidate.sourceBlockId === reference.sourceBlockId &&
          candidate.sourceVariant === reference.sourceVariant &&
          candidate.role === reference.role
      ) === index
  )
}

export function getModelDisabledReason(params: {
  targetVariant: ContentNodeVariant
  model: string
  references: ContentReferenceRecord[]
}): string | null {
  const capability = getContentReferenceCapability(params.targetVariant, params.model)
  const references = normalizeContentReferences(params.references)

  for (const reference of references) {
    const allowedRoles = getAllowedRolesForSourceVariant(capability, reference.sourceVariant)
    if (!allowedRoles.includes(reference.role)) {
      return `This model does not support ${getHumanVariantLabel(reference.sourceVariant)} references.`
    }
  }

  if (capability.selectionMode === 'slot') {
    for (const slot of capability.slots) {
      const count = references.filter((reference) => reference.role === slot.role).length
      if (slot.maxCount && count > slot.maxCount) {
        return `This model only supports ${slot.maxCount} ${slot.role} reference.`
      }
    }
  }

  return null
}

export function buildContentReferencePromptContext(params: {
  references: ContentReferenceRecord[]
  referencedNodes: Record<string, PromptContextReferencedNode>
}): string {
  const references = normalizeContentReferences(params.references)
  const sections = references.flatMap((reference) => {
    const node = params.referencedNodes[reference.sourceBlockId]
    if (!node) return []

    const label = node.name?.trim() || reference.sourceBlockId
    if (node.variant === 'text') {
      const textContent = node.textContent?.trim()
      if (!textContent) return []
      return [`- Text: ${label}\n${textContent}`]
    }

    const fileUrl = node.file?.url?.trim()
    const fileName = node.file?.name?.trim()
    const meta = [fileName, fileUrl].filter(Boolean).join(' | ')
    if (!meta) return []
    return [`- ${node.variant}: ${label}\n${meta}`]
  })

  if (sections.length === 0) return ''

  return ['Referenced canvas context:', ...sections].join('\n\n')
}

export function buildStructuredContentReferenceContext(params: {
  references: ContentReferenceRecord[]
  referencedNodes: Record<string, PromptContextReferencedNode>
}): {
  text: string[]
  images: Array<{
    id?: string
    name: string
    url?: string
    key: string
    size: number
    type?: string
    context?: string
    base64?: string
  }>
} {
  const references = normalizeContentReferences(params.references)
  const text: string[] = []
  const images: Array<{
    id?: string
    name: string
    url?: string
    key: string
    size: number
    type?: string
    context?: string
    base64?: string
  }> = []

  for (const reference of references) {
    const node = params.referencedNodes[reference.sourceBlockId]
    if (!node) continue

    if (node.variant === 'text') {
      const textContent = node.textContent?.trim()
      if (textContent) {
        text.push(textContent)
      }
      continue
    }

    if (node.variant === 'image' && node.file?.key) {
      images.push({
        id: node.file.id ?? '',
        name: node.file.name ?? node.file.key,
        url: node.file.url ?? '',
        key: node.file.key,
        size: node.file.size ?? 0,
        type: node.file.type,
        context: node.file.context,
        base64: node.file.base64,
      })
    }
  }

  return {
    text: uniq(text),
    images: images.filter(
      (image, index, items) => items.findIndex((candidate) => candidate.key === image.key) === index
    ),
  }
}

export function getReferenceRolesForSourceVariant(params: {
  targetVariant: ContentNodeVariant
  model: string
  sourceVariant: ContentNodeVariant
}): ContentReferenceRole[] {
  const capability = getContentReferenceCapability(params.targetVariant, params.model)
  return uniq(getAllowedRolesForSourceVariant(capability, params.sourceVariant))
}

export function getDefaultReferenceRole(params: {
  targetVariant: ContentNodeVariant
  model: string
  sourceVariant: ContentNodeVariant
}): ContentReferenceRole | null {
  const roles = getReferenceRolesForSourceVariant(params)
  return roles[0] ?? null
}

export function upsertContentReference(
  references: ContentReferenceRecord[],
  nextReference: ContentReferenceRecord
): ContentReferenceRecord[] {
  const normalized = normalizeContentReferences(references)
  const withoutSameRole = normalized.filter((reference) => {
    if (reference.role !== nextReference.role) return true
    if (
      nextReference.role === 'video_first_frame' ||
      nextReference.role === 'video_last_frame' ||
      nextReference.role === 'audio_reference'
    ) {
      return false
    }
    return reference.sourceBlockId !== nextReference.sourceBlockId
  })

  return normalizeContentReferences([...withoutSameRole, nextReference])
}

export function removeContentReference(
  references: ContentReferenceRecord[],
  targetReference: ContentReferenceRecord
): ContentReferenceRecord[] {
  return normalizeContentReferences(references).filter(
    (reference) =>
      !(
        reference.sourceBlockId === targetReference.sourceBlockId &&
        reference.sourceVariant === targetReference.sourceVariant &&
        reference.role === targetReference.role
      )
  )
}

export function inferContentReferencesFromCanvas(params: {
  targetBlockId: string
  targetVariant: ContentNodeVariant
  model: string
  edges: ContentReferenceEdgeLike[]
  candidateBlockIds: string[]
  resolveVariant: (blockId: string) => ContentNodeVariant | null
  resolveFileKey: (blockId: string) => string | null
  videoMedia?: VideoMediaReferenceLike[]
}): ContentReferenceRecord[] {
  const inferred: ContentReferenceRecord[] = []

  for (const edge of params.edges) {
    if (!isContentReferenceEdgeLike(edge)) continue

    const autoLinkRole = getRoleFromAutoLinkType(edge.data?.autoLinkType)
    if (autoLinkRole) {
      if (edge.target !== params.targetBlockId) continue
      const sourceVariant = params.resolveVariant(edge.source)
      if (!sourceVariant) continue
      inferred.push({
        sourceBlockId: edge.source,
        sourceVariant,
        role: autoLinkRole,
      })
      continue
    }

    if (edge.source !== params.targetBlockId) continue
    const sourceVariant = params.resolveVariant(edge.target)
    if (!sourceVariant) continue
    const role = getDefaultReferenceRole({
      targetVariant: params.targetVariant,
      model: params.model,
      sourceVariant,
    })
    if (!role) continue
    inferred.push({
      sourceBlockId: edge.target,
      sourceVariant,
      role,
    })
  }

  for (const mediaItem of params.videoMedia ?? []) {
    const role = mediaItem.type === 'first_frame' ? 'video_first_frame' : 'video_last_frame'
    if (inferred.some((reference) => reference.role === role)) continue

    const fileKey = mediaItem.file.key?.trim()
    if (!fileKey) continue

    const matchingBlockId = params.candidateBlockIds.find(
      (blockId) =>
        blockId !== params.targetBlockId &&
        params.resolveVariant(blockId) === 'image' &&
        params.resolveFileKey(blockId) === fileKey
    )

    if (!matchingBlockId) continue

    inferred.push({
      sourceBlockId: matchingBlockId,
      sourceVariant: 'image',
      role,
    })
  }

  return normalizeContentReferences(inferred)
}

export function findMatchingContentReferenceEdgeIds(params: {
  targetBlockId: string
  reference: ContentReferenceRecord
  edges: ContentReferenceEdgeLike[]
}): string[] {
  return params.edges.flatMap((edge) => {
    if (!edge.id || !isContentReferenceEdgeLike(edge)) return []

    if (
      params.reference.role === 'video_first_frame' ||
      params.reference.role === 'video_last_frame'
    ) {
      const expectedAutoLinkType =
        params.reference.role === 'video_first_frame' ? 'video_first_frame' : 'video_last_frame'

      return edge.source === params.reference.sourceBlockId &&
        edge.target === params.targetBlockId &&
        edge.data?.autoLinkType === expectedAutoLinkType
        ? [edge.id]
        : []
    }

    return edge.source === params.targetBlockId &&
      edge.target === params.reference.sourceBlockId &&
      !getRoleFromAutoLinkType(edge.data?.autoLinkType)
      ? [edge.id]
      : []
  })
}
