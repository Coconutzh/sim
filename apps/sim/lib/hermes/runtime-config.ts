import type { HermesRuntimeConfigResponse } from '@/lib/api/contracts/internal/hermes-runtime-config'
import { env } from '@/lib/core/config/env'

const EVOLINK_BASE_URL = 'https://api.evolink.ai/v1'
const EVOLINK_PPT_IMAGE_MODEL = 'gpt-image-2'

interface LegacyHermesRuntimeConfigParams {
  consumer: string
  capability: string
  family: string
}

export function getLegacyHermesRuntimeConfig({
  consumer,
  capability,
  family,
}: LegacyHermesRuntimeConfigParams): HermesRuntimeConfigResponse | null {
  if (consumer !== 'hermes-ppt' || capability !== 'image' || family !== 'ppt') {
    return null
  }

  const apiKey = env.EVOLINK_API_KEY?.trim()
  if (!apiKey) return null

  return {
    providerId: 'evolink',
    serviceKind: 'openai-compatible',
    baseUrl: env.EVOLINK_BASE_URL?.trim() || EVOLINK_BASE_URL,
    apiKey,
    enabledModelIds: [EVOLINK_PPT_IMAGE_MODEL],
    defaultModelId: EVOLINK_PPT_IMAGE_MODEL,
    configVersion: 0,
  }
}
