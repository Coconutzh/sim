import {
  type ContentCapability,
  type ContentModelFamily,
  type ContentServiceKind,
  getContentCanvasModelsByCapability,
} from '@/lib/content-canvas/model-catalog'

export const PLATFORM_PROVIDER_IDS = [
  'openai',
  'anthropic',
  'google',
  'gemini',
  'mistral',
  'fireworks',
  'zhipu',
  'cerebras',
  'cohere',
  'deepseek',
  'ark',
  'evolink',
  'dashscope',
  'azure-openai',
  'azure-anthropic',
] as const
export type PlatformProviderId = (typeof PLATFORM_PROVIDER_IDS)[number]

export const PLATFORM_FUNCTION_IDS = [
  'canvas-text',
  'canvas-image',
  'canvas-audio',
  'canvas-video',
  'hermes-agent',
  'hermes-ppt-image',
] as const
export type PlatformFunctionId = (typeof PLATFORM_FUNCTION_IDS)[number]

export interface PlatformProviderDefinition {
  id: PlatformProviderId
  label: string
  capabilities: string[]
}

export interface PlatformFunctionDefinition {
  id: PlatformFunctionId
  label: string
  consumer: 'sim-canvas' | 'hermes-agent' | 'hermes-ppt'
  capability: string
  multipleModels: boolean
  billedTest: boolean
}

export interface ManagedModelOption {
  id: string
  label: string
  description: string
  providerId: PlatformProviderId
  family: string
  serviceKind: ContentServiceKind
  baseUrl: string | null
}

export const PLATFORM_PROVIDERS: readonly PlatformProviderDefinition[] = [
  { id: 'openai', label: 'OpenAI', capabilities: ['文本'] },
  { id: 'anthropic', label: 'Anthropic', capabilities: ['文本'] },
  { id: 'google', label: 'Google', capabilities: ['文本', '图片'] },
  { id: 'gemini', label: 'Gemini', capabilities: ['文本', '图片'] },
  { id: 'mistral', label: 'Mistral', capabilities: ['文本'] },
  { id: 'fireworks', label: 'Fireworks', capabilities: ['文本'] },
  { id: 'zhipu', label: '智谱 AI', capabilities: ['文本'] },
  { id: 'cerebras', label: 'Cerebras', capabilities: ['文本'] },
  { id: 'cohere', label: 'Cohere', capabilities: ['文本'] },
  { id: 'deepseek', label: 'DeepSeek', capabilities: ['文本'] },
  { id: 'ark', label: '火山方舟', capabilities: ['图片'] },
  { id: 'evolink', label: 'Evolink', capabilities: ['音频', 'Hermes PPT 图片'] },
  { id: 'dashscope', label: 'DashScope', capabilities: ['视频'] },
  { id: 'azure-openai', label: 'Azure OpenAI', capabilities: ['文本'] },
  { id: 'azure-anthropic', label: 'Azure Anthropic', capabilities: ['文本'] },
] as const

export const PLATFORM_FUNCTIONS: readonly PlatformFunctionDefinition[] = [
  {
    id: 'canvas-text',
    label: '画布文本节点',
    consumer: 'sim-canvas',
    capability: 'text',
    multipleModels: true,
    billedTest: false,
  },
  {
    id: 'canvas-image',
    label: '画布图片节点',
    consumer: 'sim-canvas',
    capability: 'image',
    multipleModels: true,
    billedTest: true,
  },
  {
    id: 'canvas-audio',
    label: '画布音频节点',
    consumer: 'sim-canvas',
    capability: 'audio',
    multipleModels: true,
    billedTest: true,
  },
  {
    id: 'canvas-video',
    label: '画布视频节点',
    consumer: 'sim-canvas',
    capability: 'video',
    multipleModels: true,
    billedTest: true,
  },
  {
    id: 'hermes-agent',
    label: 'Hermes Agent',
    consumer: 'hermes-agent',
    capability: 'text',
    multipleModels: false,
    billedTest: false,
  },
  {
    id: 'hermes-ppt-image',
    label: 'Hermes PPT 图片生成',
    consumer: 'hermes-ppt',
    capability: 'image',
    multipleModels: false,
    billedTest: true,
  },
] as const

const PROVIDER_BY_FAMILY: Partial<Record<ContentModelFamily, PlatformProviderId>> = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
  glm: 'zhipu',
  mistral: 'mistral',
  fireworks: 'fireworks',
  cerebras: 'cerebras',
  cohere: 'cohere',
  deepseek: 'deepseek',
  ark: 'ark',
  suno: 'evolink',
  'wan2.6': 'dashscope',
  'wan2.7': 'dashscope',
}

const OFFICIAL_BASE_URLS: Partial<Record<PlatformProviderId, string>> = {
  google: 'https://generativelanguage.googleapis.com',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
  ark: 'https://ark.cn-beijing.volces.com/api/v3',
  evolink: 'https://api.evolink.ai/v1',
  dashscope: 'https://dashscope-intl.aliyuncs.com/api/v1',
}

function canvasOptions(capability: ContentCapability): ManagedModelOption[] {
  return getContentCanvasModelsByCapability(capability).flatMap((model) => {
    const providerId = PROVIDER_BY_FAMILY[model.family]
    if (!providerId) return []
    return [{ ...model, providerId, baseUrl: OFFICIAL_BASE_URLS[providerId] ?? null }]
  })
}

/** Returns only model/provider pairs with a concrete application adapter. */
export function getManagedModelOptions(functionId: PlatformFunctionId): ManagedModelOption[] {
  if (functionId === 'hermes-ppt-image') {
    return [
      {
        id: 'gpt-image-2',
        label: 'GPT Image 2',
        description: 'Hermes PPT 已验证图片生成模型',
        providerId: 'evolink',
        family: 'ppt',
        serviceKind: 'openai-compatible',
        baseUrl: 'https://api.evolink.ai/v1',
      },
    ]
  }
  if (functionId === 'hermes-agent')
    return canvasOptions('text').filter((model) => model.providerId === 'openai')
  const functionConfig = PLATFORM_FUNCTIONS.find((item) => item.id === functionId)
  if (!functionConfig || functionConfig.consumer !== 'sim-canvas') return []
  return canvasOptions(functionConfig.capability as ContentCapability)
}

export function getFunctionDefinition(functionId: PlatformFunctionId): PlatformFunctionDefinition {
  const definition = PLATFORM_FUNCTIONS.find((item) => item.id === functionId)
  if (!definition) throw new Error(`Unsupported platform function: ${functionId}`)
  return definition
}

export function getManagedModelOption(params: {
  functionId: PlatformFunctionId
  providerId: string
  modelId: string
}): ManagedModelOption | null {
  return (
    getManagedModelOptions(params.functionId).find(
      (model) => model.providerId === params.providerId && model.id === params.modelId
    ) ?? null
  )
}
