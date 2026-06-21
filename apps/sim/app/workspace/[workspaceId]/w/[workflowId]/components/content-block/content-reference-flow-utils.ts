import {
  type ContentNodeVariant,
  type ContentReferenceRecord,
  canContentNodeVariantReferenceSource,
  getAllowedReferencingContentNodeVariants,
  getDefaultReferenceRole,
  getModelDisabledReason,
  upsertContentReference,
} from '@/lib/workflows/content-references'

const CONTENT_REFERENCE_CREATE_TARGET_VARIANTS: readonly ContentNodeVariant[] = [
  'text',
  'image',
  'video',
  'audio',
] as const

export function getContentReferenceCreateTargetVariants(
  sourceVariant: ContentNodeVariant
): ContentNodeVariant[] {
  const allowedTargetVariants = getAllowedReferencingContentNodeVariants(sourceVariant)
  return CONTENT_REFERENCE_CREATE_TARGET_VARIANTS.filter((targetVariant) =>
    allowedTargetVariants.includes(targetVariant)
  )
}

export function getContentReferenceRoleForTarget(params: {
  targetVariant: ContentNodeVariant
  targetModel: string
  sourceVariant: ContentNodeVariant
}) {
  if (!canContentNodeVariantReferenceSource(params.targetVariant, params.sourceVariant)) {
    return null
  }

  return getDefaultReferenceRole({
    targetVariant: params.targetVariant,
    model: params.targetModel,
    sourceVariant: params.sourceVariant,
  })
}

export function getNextContentReferencesForSource(params: {
  targetVariant: ContentNodeVariant
  targetModel: string
  targetReferences: ContentReferenceRecord[]
  sourceBlockId: string
  sourceVariant: ContentNodeVariant
}): {
  referenceRole: ContentReferenceRecord['role'] | null
  nextReferences: ContentReferenceRecord[]
  disabledReason: string | null
} {
  const referenceRole = getContentReferenceRoleForTarget({
    targetVariant: params.targetVariant,
    targetModel: params.targetModel,
    sourceVariant: params.sourceVariant,
  })

  if (!referenceRole) {
    return {
      referenceRole: null,
      nextReferences: params.targetReferences,
      disabledReason: 'This node cannot be used as a reference.',
    }
  }

  const nextReferences = upsertContentReference(params.targetReferences, {
    sourceBlockId: params.sourceBlockId,
    sourceVariant: params.sourceVariant,
    role: referenceRole,
  })

  return {
    referenceRole,
    nextReferences,
    disabledReason: getModelDisabledReason({
      targetVariant: params.targetVariant,
      model: params.targetModel,
      references: nextReferences,
    }),
  }
}
