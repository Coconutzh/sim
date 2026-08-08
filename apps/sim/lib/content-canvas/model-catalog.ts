import type {
  ContentNodeVariant,
  ContentReferenceCapability,
} from '@/lib/workflows/content-reference-types'

export type ContentCapability = Extract<ContentNodeVariant, 'text' | 'image' | 'audio' | 'video'>

export type ContentServiceKind =
  | 'openai-compatible'
  | 'google-native'
  | 'ark-image'
  | 'evolink-audio'
  | 'dashscope-video'
  | 'provider-native'

export type ContentModelFamily =
  | 'gemini'
  | 'glm'
  | 'ark'
  | 'suno'
  | 'wan2.6'
  | 'wan2.7'
  | 'openai'
  | 'anthropic'
  | 'mistral'
  | 'fireworks'
  | 'cerebras'
  | 'deepseek'

export interface ContentCanvasModelDefinition {
  id: string
  capability: ContentCapability
  family: ContentModelFamily
  serviceKind: ContentServiceKind
  label: string
  description: string
  referenceCapability: Omit<ContentReferenceCapability, 'model'>
}

export interface ContentCanvasModelOption {
  id: string
  label: string
  description: string
}

export interface ContentCanvasModelFamilyOption {
  id: ContentModelFamily
  label: string
  description: string
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

const PRESENTATION_MULTI_CAPABILITY: Omit<ContentReferenceCapability, 'model'> = {
  authMode: 'api_key_only',
  targetVariant: 'presentation',
  selectionMode: 'multi',
  allowedSourceVariants: ['text', 'image', 'video', 'audio'],
  supportedRoles: ['text_context', 'image_reference', 'audio_reference'],
  slots: [],
}

export const CONTENT_CANVAS_MODEL_CATALOG: readonly ContentCanvasModelDefinition[] = [
  {
    id: 'gpt-4.1',
    capability: 'text',
    family: 'openai',
    serviceKind: 'provider-native',
    label: 'GPT-4.1',
    description: 'OpenAI general model',
    referenceCapability: TEXT_MULTIMODAL_CAPABILITY,
  },
  {
    id: 'claude-sonnet-4-6',
    capability: 'text',
    family: 'anthropic',
    serviceKind: 'provider-native',
    label: 'Claude Sonnet 4.6',
    description: 'Anthropic balanced model',
    referenceCapability: TEXT_MULTIMODAL_CAPABILITY,
  },
  {
    id: 'mistral-large-latest',
    capability: 'text',
    family: 'mistral',
    serviceKind: 'provider-native',
    label: 'Mistral Large',
    description: 'Mistral general model',
    referenceCapability: TEXT_MULTI_CAPABILITY,
  },
  {
    id: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    capability: 'text',
    family: 'fireworks',
    serviceKind: 'provider-native',
    label: 'Llama 3.3 70B Instruct',
    description: 'Fireworks hosted model',
    referenceCapability: TEXT_MULTI_CAPABILITY,
  },
  {
    id: 'cerebras/gpt-oss-120b',
    capability: 'text',
    family: 'cerebras',
    serviceKind: 'provider-native',
    label: 'GPT OSS 120B',
    description: 'Cerebras hosted model',
    referenceCapability: TEXT_MULTI_CAPABILITY,
  },
  {
    id: 'deepseek-chat',
    capability: 'text',
    family: 'deepseek',
    serviceKind: 'provider-native',
    label: 'DeepSeek Chat',
    description: 'DeepSeek chat model',
    referenceCapability: TEXT_MULTI_CAPABILITY,
  },
  {
    id: 'gemini-3.1-flash-lite-preview',
    capability: 'text',
    family: 'gemini',
    serviceKind: 'google-native',
    label: 'Gemini 3.1 Flash Lite',
    description: 'Fast draft',
    referenceCapability: TEXT_MULTIMODAL_CAPABILITY,
  },
  {
    id: 'gemini-2.5-flash',
    capability: 'text',
    family: 'gemini',
    serviceKind: 'google-native',
    label: 'Gemini 2.5 Flash',
    description: 'Balanced',
    referenceCapability: TEXT_MULTIMODAL_CAPABILITY,
  },
  {
    id: 'gemini-2.5-pro',
    capability: 'text',
    family: 'gemini',
    serviceKind: 'google-native',
    label: 'Gemini 2.5 Pro',
    description: 'Best quality',
    referenceCapability: TEXT_MULTIMODAL_CAPABILITY,
  },
  {
    id: 'gemini-3.1-pro-preview',
    capability: 'text',
    family: 'gemini',
    serviceKind: 'google-native',
    label: 'Gemini 3.1 Pro',
    description: 'Deep writing',
    referenceCapability: TEXT_MULTIMODAL_CAPABILITY,
  },
  {
    id: 'glm-4.7-flash',
    capability: 'text',
    family: 'glm',
    serviceKind: 'openai-compatible',
    label: 'GLM 4.7 Flash',
    description: 'Fast Chinese',
    referenceCapability: TEXT_MULTI_CAPABILITY,
  },
  {
    id: 'glm-4.7',
    capability: 'text',
    family: 'glm',
    serviceKind: 'openai-compatible',
    label: 'GLM 4.7',
    description: 'Best Chinese',
    referenceCapability: TEXT_MULTI_CAPABILITY,
  },
  {
    id: 'glm-4.6',
    capability: 'text',
    family: 'glm',
    serviceKind: 'openai-compatible',
    label: 'GLM 4.6',
    description: 'Balanced Chinese',
    referenceCapability: TEXT_MULTI_CAPABILITY,
  },
  {
    id: 'glm-4.5',
    capability: 'text',
    family: 'glm',
    serviceKind: 'openai-compatible',
    label: 'GLM 4.5',
    description: 'Compatibility',
    referenceCapability: TEXT_MULTI_CAPABILITY,
  },
  {
    id: 'jimeng-4.5',
    capability: 'image',
    family: 'ark',
    serviceKind: 'ark-image',
    label: '即梦 4.5',
    description: '画质更高，适合成片感更强的图片',
    referenceCapability: IMAGE_TEXT_AND_IMAGE_CAPABILITY,
  },
  {
    id: 'jimeng-4.0',
    capability: 'image',
    family: 'ark',
    serviceKind: 'ark-image',
    label: '即梦 4.0',
    description: '速度更稳，适合快速探索方向',
    referenceCapability: IMAGE_TEXT_AND_IMAGE_CAPABILITY,
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    capability: 'image',
    family: 'gemini',
    serviceKind: 'google-native',
    label: 'Gemini 3.1 Flash Image',
    description: 'Supports reference images and fast edits',
    referenceCapability: IMAGE_TEXT_AND_IMAGE_CAPABILITY,
  },
  {
    id: 'gemini-3-pro-image',
    capability: 'image',
    family: 'gemini',
    serviceKind: 'google-native',
    label: 'Gemini 3 Pro Image',
    description: 'Nano Banana Pro image editing with reference images',
    referenceCapability: IMAGE_TEXT_AND_IMAGE_CAPABILITY,
  },
  {
    id: 'gemini-3-pro-image-preview',
    capability: 'image',
    family: 'gemini',
    serviceKind: 'google-native',
    label: 'Gemini 3 Pro Image Preview',
    description: 'Nano Banana Pro preview compatibility fallback',
    referenceCapability: IMAGE_TEXT_AND_IMAGE_CAPABILITY,
  },
  {
    id: 'suno-v5-beta',
    capability: 'audio',
    family: 'suno',
    serviceKind: 'evolink-audio',
    label: 'Suno v5',
    description: 'Newest Suno music generation model',
    referenceCapability: AUDIO_MULTI_CAPABILITY,
  },
  {
    id: 'suno-v4.5-beta',
    capability: 'audio',
    family: 'suno',
    serviceKind: 'evolink-audio',
    label: 'Suno v4.5',
    description: 'Balanced quality and speed',
    referenceCapability: AUDIO_MULTI_CAPABILITY,
  },
  {
    id: 'suno-v4-beta',
    capability: 'audio',
    family: 'suno',
    serviceKind: 'evolink-audio',
    label: 'Suno v4',
    description: 'Previous stable music model',
    referenceCapability: AUDIO_MULTI_CAPABILITY,
  },
  {
    id: 'wan2.7-i2v',
    capability: 'video',
    family: 'wan2.7',
    serviceKind: 'dashscope-video',
    label: 'Wan 2.7',
    description: 'First/last-frame image-to-video',
    referenceCapability: VIDEO_FIRST_AND_LAST_CAPABILITY,
  },
  {
    id: 'wan2.6-t2v',
    capability: 'video',
    family: 'wan2.6',
    serviceKind: 'dashscope-video',
    label: 'Wan 2.6 Text',
    description: 'Text-to-video',
    referenceCapability: VIDEO_TEXT_ONLY_CAPABILITY,
  },
  {
    id: 'wan2.6-i2v-flash',
    capability: 'video',
    family: 'wan2.6',
    serviceKind: 'dashscope-video',
    label: 'Wan 2.6 Image',
    description: 'First-frame image-to-video',
    referenceCapability: VIDEO_FIRST_FRAME_CAPABILITY,
  },
] as const

export function getContentCanvasModel(modelId: string): ContentCanvasModelDefinition | null {
  return CONTENT_CANVAS_MODEL_CATALOG.find((model) => model.id === modelId) ?? null
}

export function getContentCanvasModelOptions(
  capability: ContentCapability
): readonly ContentCanvasModelOption[] {
  return getContentCanvasModelsByCapability(capability).map((model) => ({
    id: model.id,
    label: model.label,
    description: model.description,
  }))
}

export function getContentCanvasModelFamilyOptions(
  capability: ContentCapability
): readonly ContentCanvasModelFamilyOption[] {
  return Array.from(
    new Map(
      getContentCanvasModelsByCapability(capability).map((model) => [
        model.family,
        {
          id: model.family,
          label:
            model.family === 'wan2.7'
              ? 'Wan 2.7'
              : model.family === 'wan2.6'
                ? 'Wan 2.6'
                : model.label,
          description:
            model.family === 'wan2.7'
              ? 'First/last-frame video generation'
              : model.family === 'wan2.6'
                ? 'Auto-switch between text-only and first-frame generation'
                : model.description,
        } satisfies ContentCanvasModelFamilyOption,
      ])
    ).values()
  )
}

export function getContentCanvasModelsByCapability(
  capability: ContentCapability
): ContentCanvasModelDefinition[] {
  return CONTENT_CANVAS_MODEL_CATALOG.filter((model) => model.capability === capability)
}

export function getContentCanvasModelsByFamily(
  capability: ContentCapability,
  family: ContentModelFamily
): ContentCanvasModelDefinition[] {
  return CONTENT_CANVAS_MODEL_CATALOG.filter(
    (model) => model.capability === capability && model.family === family
  )
}

export function getContentReferenceCapability(params: {
  targetVariant: ContentNodeVariant
  model: string
}): ContentReferenceCapability {
  const model = getContentCanvasModel(params.model)
  if (!model || model.capability !== params.targetVariant) {
    if (params.targetVariant === 'text') {
      return { ...TEXT_MULTI_CAPABILITY, model: params.model }
    }
    if (params.targetVariant === 'image') {
      return { ...IMAGE_TEXT_ONLY_CAPABILITY, model: params.model }
    }
    if (params.targetVariant === 'audio') {
      return { ...AUDIO_MULTI_CAPABILITY, model: params.model }
    }
    if (params.targetVariant === 'presentation') {
      return { ...PRESENTATION_MULTI_CAPABILITY, model: params.model }
    }
    return { ...VIDEO_TEXT_ONLY_CAPABILITY, model: params.model }
  }

  return {
    ...model.referenceCapability,
    model: params.model,
  }
}
