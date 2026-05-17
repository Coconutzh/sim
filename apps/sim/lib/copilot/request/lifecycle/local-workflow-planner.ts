import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import { executeProviderRequest } from '@/providers'
import { getProviderDefaultModel, getProviderModels } from '@/providers/models'
import type { ProviderResponse } from '@/providers/types'
import { extractAndParseJSON, getProviderFromModel } from '@/providers/utils'

const logger = createLogger('LocalWorkflowPlanner')

const LOCAL_COPILOT_PROVIDER_IDS = ['deepseek', 'openai'] as const
const LOCAL_COPILOT_PROVIDER_ALIASES = {
  deepseek: 'deepseek',
  openai: 'openai',
  gpt: 'openai',
} as const
const LOCAL_COPILOT_IMAGE_MODELS = ['dall-e-3', 'gpt-image-1', 'gpt-image-2'] as const
const LOCAL_COPILOT_VIDEO_PROVIDERS = ['runway', 'veo', 'luma', 'minimax', 'falai'] as const
const LOCAL_COPILOT_DURATIONS = [4, 5, 6, 8, 9, 10] as const
const LOCAL_COPILOT_ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const

type LocalCopilotProviderId = (typeof LOCAL_COPILOT_PROVIDER_IDS)[number]

export interface LocalCopilotPlannerConfig {
  provider: LocalCopilotProviderId
  model: string
  apiKey: string
  keySource: 'LOCAL_COPILOT_API_KEY' | 'DEEPSEEK_API_KEY' | 'OPENAI_API_KEY'
}

const localWorkflowPlannerResponseSchema = z.object({
  intent: z.enum(['image_to_video', 'unsupported']).catch('unsupported'),
  assistantText: z.string().catch(''),
  imagePrompt: z.string().catch(''),
  videoPrompt: z.string().catch(''),
  imageModel: z.enum(LOCAL_COPILOT_IMAGE_MODELS).catch('gpt-image-1'),
  videoProvider: z.enum(LOCAL_COPILOT_VIDEO_PROVIDERS).catch('runway'),
  durationSeconds: z
    .union([z.literal(4), z.literal(5), z.literal(6), z.literal(8), z.literal(9), z.literal(10)])
    .catch(5),
  aspectRatio: z.enum(LOCAL_COPILOT_ASPECT_RATIOS).catch('16:9'),
})

export type LocalWorkflowPlannerResponse = z.infer<typeof localWorkflowPlannerResponseSchema>

export interface LocalWorkflowPlannerResult {
  config: LocalCopilotPlannerConfig
  plan: LocalWorkflowPlannerResponse
}

const localWorkflowPlannerJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'intent',
    'assistantText',
    'imagePrompt',
    'videoPrompt',
    'imageModel',
    'videoProvider',
    'durationSeconds',
    'aspectRatio',
  ],
  properties: {
    intent: {
      type: 'string',
      enum: ['image_to_video', 'unsupported'],
    },
    assistantText: {
      type: 'string',
      description:
        'One short assistant reply that summarizes the proposed workflow in the user language.',
    },
    imagePrompt: {
      type: 'string',
      description: 'Prompt for the image generation node.',
    },
    videoPrompt: {
      type: 'string',
      description: 'Prompt for the video generation node.',
    },
    imageModel: {
      type: 'string',
      enum: [...LOCAL_COPILOT_IMAGE_MODELS],
    },
    videoProvider: {
      type: 'string',
      enum: [...LOCAL_COPILOT_VIDEO_PROVIDERS],
    },
    durationSeconds: {
      type: 'number',
      enum: [...LOCAL_COPILOT_DURATIONS],
    },
    aspectRatio: {
      type: 'string',
      enum: [...LOCAL_COPILOT_ASPECT_RATIOS],
    },
  },
} as const

function normalizeLocalCopilotProvider(
  rawValue: string | undefined
): LocalCopilotProviderId | null {
  if (!rawValue) {
    return null
  }

  const normalized = rawValue.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  return (
    LOCAL_COPILOT_PROVIDER_ALIASES[normalized as keyof typeof LOCAL_COPILOT_PROVIDER_ALIASES] ??
    null
  )
}

function inferProviderFromModel(model: string | undefined): LocalCopilotProviderId | null {
  if (!model) {
    return null
  }

  try {
    const inferredProvider = getProviderFromModel(model)
    if (inferredProvider === 'deepseek' || inferredProvider === 'openai') {
      return inferredProvider
    }
  } catch (error) {
    logger.warn('Failed to infer local Copilot provider from model', {
      model,
      error: toError(error).message,
    })
  }

  return null
}

function resolveRequestedProvider(): LocalCopilotProviderId | null {
  const explicitProvider = normalizeLocalCopilotProvider(env.LOCAL_COPILOT_PROVIDER)
  if (explicitProvider) {
    return explicitProvider
  }

  const inferredProvider = inferProviderFromModel(env.LOCAL_COPILOT_MODEL)
  if (inferredProvider) {
    return inferredProvider
  }

  return null
}

function resolvePlannerApiKey(
  provider: LocalCopilotProviderId
): Pick<LocalCopilotPlannerConfig, 'apiKey' | 'keySource'> | null {
  if (env.LOCAL_COPILOT_API_KEY) {
    return {
      apiKey: env.LOCAL_COPILOT_API_KEY,
      keySource: 'LOCAL_COPILOT_API_KEY',
    }
  }

  if (provider === 'deepseek' && env.DEEPSEEK_API_KEY) {
    return {
      apiKey: env.DEEPSEEK_API_KEY,
      keySource: 'DEEPSEEK_API_KEY',
    }
  }

  if (provider === 'openai' && env.OPENAI_API_KEY) {
    return {
      apiKey: env.OPENAI_API_KEY,
      keySource: 'OPENAI_API_KEY',
    }
  }

  return null
}

function resolvePlannerModel(provider: LocalCopilotProviderId): string {
  const requestedModel = env.LOCAL_COPILOT_MODEL?.trim()
  if (!requestedModel) {
    return getProviderDefaultModel(provider)
  }

  const providerModels = new Set(getProviderModels(provider))
  if (providerModels.has(requestedModel)) {
    return requestedModel
  }

  const inferredProvider = inferProviderFromModel(requestedModel)
  if (inferredProvider === provider) {
    return requestedModel
  }

  logger.warn('Ignoring LOCAL_COPILOT_MODEL because it does not match the selected provider', {
    provider,
    requestedModel,
  })
  return getProviderDefaultModel(provider)
}

/**
 * Resolves the local planner provider, model, and user-level API key used for
 * the right-side Copilot fallback when the hosted Copilot backend is unavailable.
 */
export function getLocalCopilotPlannerConfig(): LocalCopilotPlannerConfig | null {
  const requestedProvider = resolveRequestedProvider()
  if (env.LOCAL_COPILOT_API_KEY && !requestedProvider) {
    logger.warn('LOCAL_COPILOT_API_KEY is set without a resolvable local Copilot provider')
    return null
  }

  const providerCandidates = requestedProvider
    ? [requestedProvider]
    : (LOCAL_COPILOT_PROVIDER_IDS as readonly LocalCopilotProviderId[])

  for (const provider of providerCandidates) {
    const keyConfig = resolvePlannerApiKey(provider)
    if (!keyConfig) {
      continue
    }

    return {
      provider,
      model: resolvePlannerModel(provider),
      apiKey: keyConfig.apiKey,
      keySource: keyConfig.keySource,
    }
  }

  return null
}

function buildPlannerSystemPrompt(): string {
  return [
    'You are a local workflow planner for the Sim canvas Copilot.',
    'Your job is to transform the user request into a strict JSON plan for a workflow that creates an image first and then creates a video from that image.',
    'Only use the supported canvas shape below:',
    '- Node 1: image_generator',
    '- Node 2: a video generator node',
    '- Node 1 must connect into Node 2.',
    '- Prefer videoProvider="runway" whenever the user wants image-to-video or a chained media flow.',
    '- Keep prompts concrete and production-ready.',
    '- If the request is not asking for a workflow on the canvas, return intent="unsupported".',
    '- assistantText must be short and should match the user language when possible.',
    '- Return JSON only.',
  ].join('\n')
}

function buildPlannerUserPrompt(message: string): string {
  return [
    'Plan a Sim workflow for the following user request.',
    'Return only JSON.',
    '',
    'User request:',
    message,
  ].join('\n')
}

function assertNonStreamingProviderResponse(
  response: ProviderResponse | ReadableStream | { stream: ReadableStream; execution: unknown }
): ProviderResponse {
  if (response instanceof ReadableStream) {
    throw new Error('Local workflow planner returned an unexpected stream response')
  }

  if (response && typeof response === 'object' && 'stream' in response && 'execution' in response) {
    throw new Error('Local workflow planner returned an unexpected StreamingExecution response')
  }

  return response
}

/**
 * Uses a local LLM provider to plan the canvas workflow JSON that will later be
 * converted into edit_workflow operations.
 */
export async function planLocalWorkflow(params: {
  message: string
  abortSignal?: AbortSignal
}): Promise<LocalWorkflowPlannerResult | null> {
  const config = getLocalCopilotPlannerConfig()
  if (!config) {
    return null
  }

  logger.info('Planning workflow with local Copilot provider', {
    provider: config.provider,
    model: config.model,
    keySource: config.keySource,
  })

  const rawResponse = await executeProviderRequest(config.provider, {
    model: config.model,
    apiKey: config.apiKey,
    systemPrompt: buildPlannerSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: buildPlannerUserPrompt(params.message),
      },
    ],
    temperature: 0.2,
    maxTokens: 1200,
    responseFormat: {
      name: 'local_workflow_plan',
      schema: localWorkflowPlannerJsonSchema,
      strict: true,
    },
    abortSignal: params.abortSignal,
  })

  const response = assertNonStreamingProviderResponse(rawResponse)
  const parsed = extractAndParseJSON(response.content || '')
  const plan = localWorkflowPlannerResponseSchema.parse(parsed)

  return {
    config,
    plan,
  }
}
