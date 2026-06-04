export type ContentNodeVariant = 'text' | 'image' | 'video' | 'audio'
export type ContentReferenceSelectionMode = 'multi' | 'slot'
export type ContentReferenceRole =
  | 'text_context'
  | 'image_reference'
  | 'video_first_frame'
  | 'video_last_frame'
  | 'audio_reference'

export interface ContentReferenceSlotCapability {
  role: ContentReferenceRole
  sourceVariants: ContentNodeVariant[]
  maxCount?: number
}

export interface ContentReferenceCapability {
  authMode: 'api_key_only'
  targetVariant: ContentNodeVariant
  model: string
  selectionMode: ContentReferenceSelectionMode
  allowedSourceVariants: ContentNodeVariant[]
  supportedRoles: ContentReferenceRole[]
  slots: ContentReferenceSlotCapability[]
}
