import { getEnv } from '@/lib/core/config/env'
import {
  getContentCanvasModel,
  getContentCanvasModelsByCapability,
  getContentCanvasModelsByFamily,
  type ContentCapability,
  type ContentModelFamily,
  type ContentServiceKind,
} from '@/lib/content-canvas/model-catalog'

export interface ContentServiceConfig {
  kind: ContentServiceKind
  baseUrl: string
  apiKey?: string
  enabledModelIds: string[]
  defaultModelId: string
}

export interface ResolvedContentService {
  kind: ContentServiceKind
  baseUrl: string
  apiKey?: string
  modelId: string
}

export interface ContentCanvasCapabilityAvailability {
  enabledModelIds: string[]
  defaultModelId: string | null
}

export interface ContentCanvasModelAvailabilitySnapshot {
  text: ContentCanvasCapabilityAvailability
  image: ContentCanvasCapabilityAvailability
  audio: ContentCanvasCapabilityAvailability
  video: ContentCanvasCapabilityAvailability
}

const GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com'
const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
const ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
const EVOLINK_BASE_URL = 'https://api.evolink.ai/v1'
const DASHSCOPE_BASE_URL = 'https://dashscope-intl.aliyuncs.com/api/v1'

interface ContentServiceEnvMapping {
  defaultKind: ContentServiceKind
  officialBaseUrl: string
  newEnvBaseUrl?: string
  newEnvApiKey?: string
  newEnvEnabledModels?: string
  newEnvDefaultModel?: string
}

function parseEnabledModelIds(value: string | undefined, fallback: string[]) {
  const parsed = value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  return parsed?.length ? parsed : fallback
}

function resolveLegacyApiKey(capability: ContentCapability, family: ContentModelFamily) {
  if (family === 'gemini') {
    return (
      getEnv('GEMINI_API_KEY_1')?.trim() ||
      getEnv('GEMINI_API_KEY_2')?.trim() ||
      getEnv('GEMINI_API_KEY_3')?.trim() ||
      getEnv('GEMINI_API_KEY')?.trim() ||
      undefined
    )
  }
  if (family === 'glm') return getEnv('ZHIPU_API_KEY')?.trim() || undefined
  if (capability === 'image' && family === 'ark') return getEnv('ARK_API_KEY')?.trim() || undefined
  if (capability === 'audio' && family === 'suno') return getEnv('EVOLINK_API_KEY')?.trim() || undefined
  if (capability === 'video' && (family === 'wan2.6' || family === 'wan2.7')) {
    return getEnv('DASHSCOPE_API_KEY')?.trim() || undefined
  }
  return undefined
}

function getServiceEnvMapping(
  capability: ContentCapability,
  family: ContentModelFamily
): ContentServiceEnvMapping {
  if (capability === 'text' && family === 'gemini') {
    return {
      defaultKind: 'google-native',
      officialBaseUrl: GOOGLE_BASE_URL,
      newEnvBaseUrl: 'CONTENT_TEXT_GEMINI_BASE_URL',
      newEnvApiKey: 'CONTENT_TEXT_GEMINI_API_KEY',
      newEnvEnabledModels: 'CONTENT_TEXT_GEMINI_ENABLED_MODELS',
      newEnvDefaultModel: 'CONTENT_TEXT_GEMINI_DEFAULT_MODEL',
    }
  }
  if (capability === 'text' && family === 'glm') {
    return {
      defaultKind: 'openai-compatible',
      officialBaseUrl: ZHIPU_BASE_URL,
      newEnvBaseUrl: 'CONTENT_TEXT_GLM_BASE_URL',
      newEnvApiKey: 'CONTENT_TEXT_GLM_API_KEY',
      newEnvEnabledModels: 'CONTENT_TEXT_GLM_ENABLED_MODELS',
      newEnvDefaultModel: 'CONTENT_TEXT_GLM_DEFAULT_MODEL',
    }
  }
  if (capability === 'image' && family === 'gemini') {
    return {
      defaultKind: 'google-native',
      officialBaseUrl: GOOGLE_BASE_URL,
      newEnvBaseUrl: 'CONTENT_IMAGE_GEMINI_BASE_URL',
      newEnvApiKey: 'CONTENT_IMAGE_GEMINI_API_KEY',
      newEnvEnabledModels: 'CONTENT_IMAGE_GEMINI_ENABLED_MODELS',
      newEnvDefaultModel: 'CONTENT_IMAGE_GEMINI_DEFAULT_MODEL',
    }
  }
  if (capability === 'image' && family === 'ark') {
    return {
      defaultKind: 'ark-image',
      officialBaseUrl: ARK_BASE_URL,
      newEnvBaseUrl: 'CONTENT_IMAGE_ARK_BASE_URL',
      newEnvApiKey: 'CONTENT_IMAGE_ARK_API_KEY',
      newEnvEnabledModels: 'CONTENT_IMAGE_ARK_ENABLED_MODELS',
      newEnvDefaultModel: 'CONTENT_IMAGE_ARK_DEFAULT_MODEL',
    }
  }
  if (capability === 'audio' && family === 'suno') {
    return {
      defaultKind: 'evolink-audio',
      officialBaseUrl: EVOLINK_BASE_URL,
      newEnvBaseUrl: 'CONTENT_AUDIO_BASE_URL',
      newEnvApiKey: 'CONTENT_AUDIO_API_KEY',
      newEnvEnabledModels: 'CONTENT_AUDIO_ENABLED_MODELS',
      newEnvDefaultModel: 'CONTENT_AUDIO_DEFAULT_MODEL',
    }
  }
  if (capability === 'video' && (family === 'wan2.6' || family === 'wan2.7')) {
    return {
      defaultKind: 'dashscope-video',
      officialBaseUrl: DASHSCOPE_BASE_URL,
      newEnvBaseUrl: 'CONTENT_VIDEO_BASE_URL',
      newEnvApiKey: 'CONTENT_VIDEO_API_KEY',
      newEnvEnabledModels: 'CONTENT_VIDEO_ENABLED_MODELS',
      newEnvDefaultModel: 'CONTENT_VIDEO_DEFAULT_MODEL',
    }
  }

  throw new Error(`Unsupported content-canvas service family: ${capability}/${family}`)
}

function resolveServiceKind(params: {
  capability: ContentCapability
  family: ContentModelFamily
  mapping: ContentServiceEnvMapping
  configuredBaseUrl?: string
}) {
  if (params.family === 'gemini' && params.configuredBaseUrl) {
    return 'openai-compatible' as const
  }
  return params.mapping.defaultKind
}

export function getContentServiceConfig(params: {
  capability: ContentCapability
  family: ContentModelFamily
}): ContentServiceConfig {
  const mapping = getServiceEnvMapping(params.capability, params.family)
  const familyModels = getContentCanvasModelsByFamily(params.capability, params.family).map(
    (model) => model.id
  )

  if (familyModels.length === 0) {
    throw new Error(`No content-canvas models registered for ${params.capability}/${params.family}`)
  }

  const configuredBaseUrl = mapping.newEnvBaseUrl ? getEnv(mapping.newEnvBaseUrl)?.trim() : undefined
  const legacyBaseUrl =
    params.capability === 'image' && params.family === 'ark'
      ? getEnv('ARK_BASE_URL')?.trim()
      : params.capability === 'audio' && params.family === 'suno'
        ? getEnv('EVOLINK_BASE_URL')?.trim()
        : params.capability === 'video' && (params.family === 'wan2.6' || params.family === 'wan2.7')
          ? getEnv('DASHSCOPE_BASE_URL')?.trim()
          : undefined
  const apiKey =
    (mapping.newEnvApiKey ? getEnv(mapping.newEnvApiKey)?.trim() : undefined) ||
    resolveLegacyApiKey(params.capability, params.family)
  const enabledModelIds = parseEnabledModelIds(
    mapping.newEnvEnabledModels ? getEnv(mapping.newEnvEnabledModels) : undefined,
    familyModels
  ).filter((modelId) => familyModels.includes(modelId))
  const fallbackDefaultModelId = enabledModelIds[0] ?? familyModels[0]
  const configuredDefaultModelId = mapping.newEnvDefaultModel
    ? getEnv(mapping.newEnvDefaultModel)?.trim()
    : undefined

  return {
    kind: resolveServiceKind({
      capability: params.capability,
      family: params.family,
      mapping,
      configuredBaseUrl,
    }),
    baseUrl: configuredBaseUrl || legacyBaseUrl || mapping.officialBaseUrl,
    apiKey,
    enabledModelIds,
    defaultModelId:
      configuredDefaultModelId && enabledModelIds.includes(configuredDefaultModelId)
        ? configuredDefaultModelId
        : fallbackDefaultModelId,
  }
}

export function resolveContentService(params: {
  capability: ContentCapability
  modelId: string
}): ResolvedContentService {
  const model = getContentCanvasModel(params.modelId)
  if (!model || model.capability !== params.capability) {
    throw new Error(`Unknown content-canvas ${params.capability} model: ${params.modelId}`)
  }

  const config = getContentServiceConfig({
    capability: params.capability,
    family: model.family,
  })

  return {
    kind: config.kind,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    modelId: params.modelId,
  }
}

function getCapabilityFamilies(capability: ContentCapability): ContentModelFamily[] {
  return Array.from(
    new Set(getContentCanvasModelsByCapability(capability).map((model) => model.family))
  ) as ContentModelFamily[]
}

export function getContentCanvasModelAvailability(): ContentCanvasModelAvailabilitySnapshot {
  const capabilities: ContentCapability[] = ['text', 'image', 'audio', 'video']
  const availability: ContentCanvasModelAvailabilitySnapshot = {
    text: { enabledModelIds: [], defaultModelId: null },
    image: { enabledModelIds: [], defaultModelId: null },
    audio: { enabledModelIds: [], defaultModelId: null },
    video: { enabledModelIds: [], defaultModelId: null },
  }

  for (const capability of capabilities) {
    const enabledModelIds: string[] = []
    let defaultModelId: string | null = null

    for (const family of getCapabilityFamilies(capability)) {
      const config = getContentServiceConfig({ capability, family })
      if (!config.apiKey) continue

      enabledModelIds.push(...config.enabledModelIds)
      if (!defaultModelId && config.defaultModelId) {
        defaultModelId = config.defaultModelId
      }
    }

    availability[capability] = { enabledModelIds, defaultModelId }
  }

  return availability
}
