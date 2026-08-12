/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { envMock } = vi.hoisted(() => ({
  envMock: {
    EVOLINK_API_KEY: 'legacy-evolink-key' as string | undefined,
    EVOLINK_BASE_URL: undefined as string | undefined,
  },
}))

vi.mock('@/lib/core/config/env', () => ({ env: envMock }))

import { getLegacyHermesRuntimeConfig } from '@/lib/hermes/runtime-config'

describe('getLegacyHermesRuntimeConfig', () => {
  beforeEach(() => {
    envMock.EVOLINK_API_KEY = 'legacy-evolink-key'
    envMock.EVOLINK_BASE_URL = undefined
  })

  it('provides the existing Evolink backend for Hermes editable PPT images', () => {
    expect(
      getLegacyHermesRuntimeConfig({
        consumer: 'hermes-ppt',
        capability: 'image',
        family: 'ppt',
      })
    ).toEqual({
      providerId: 'evolink',
      serviceKind: 'openai-compatible',
      baseUrl: 'https://api.evolink.ai/v1',
      apiKey: 'legacy-evolink-key',
      enabledModelIds: ['gpt-image-2'],
      defaultModelId: 'gpt-image-2',
      configVersion: 0,
    })
  })

  it('does not expose the fallback to unrelated runtime requests', () => {
    expect(
      getLegacyHermesRuntimeConfig({
        consumer: 'hermes-agent',
        capability: 'image',
        family: 'ppt',
      })
    ).toBeNull()
  })

  it('returns no fallback when Evolink is not configured', () => {
    envMock.EVOLINK_API_KEY = undefined

    expect(
      getLegacyHermesRuntimeConfig({
        consumer: 'hermes-ppt',
        capability: 'image',
        family: 'ppt',
      })
    ).toBeNull()
  })
})
