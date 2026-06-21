export type ToolbarDerivedImageGenerationKind =
  | 'cutout'
  | 'video_frame_capture'
  | 'image_outpaint'
  | 'image_crop'
  | 'image_perspective'
  | 'image_repaint'
  | 'image_erase'

type ContentVariant = 'text' | 'image' | 'video' | 'audio'

const TOOLBAR_DERIVED_IMAGE_GENERATION_KINDS = [
  'cutout',
  'video_frame_capture',
  'image_outpaint',
] as const satisfies readonly ToolbarDerivedImageGenerationKind[]

const TOOLBAR_RESULT_IMAGE_GENERATION_KINDS = [
  'image_crop',
  'image_perspective',
  'image_repaint',
  'image_erase',
] as const satisfies readonly ToolbarDerivedImageGenerationKind[]

const ALL_TOOLBAR_DERIVED_IMAGE_GENERATION_KINDS = [
  ...TOOLBAR_DERIVED_IMAGE_GENERATION_KINDS,
  ...TOOLBAR_RESULT_IMAGE_GENERATION_KINDS,
] as const satisfies readonly ToolbarDerivedImageGenerationKind[]

export function normalizeImageGenerationKind(
  value: unknown
): ToolbarDerivedImageGenerationKind | null {
  return ALL_TOOLBAR_DERIVED_IMAGE_GENERATION_KINDS.some((kind) => kind === value)
    ? (value as ToolbarDerivedImageGenerationKind)
    : null
}

export function isToolbarDerivedImageNode(params: {
  variant: ContentVariant
  generationKind: unknown
}): boolean {
  return params.variant === 'image' && normalizeImageGenerationKind(params.generationKind) !== null
}

export function shouldShowImageComposer(params: {
  variant: ContentVariant
  generationKind: unknown
  isImageToolActive?: boolean
  hasLegacyToolbarDerivedReference?: boolean
}): boolean {
  return (
    params.variant === 'image' &&
    !params.isImageToolActive &&
    !params.hasLegacyToolbarDerivedReference &&
    !isToolbarDerivedImageNode(params)
  )
}
