import { describe, expect, it } from 'vitest'
import { getManagedModelOptions, PLATFORM_PROVIDERS } from '@/lib/platform-models/catalog'

describe('platform model catalog', () => {
  it('lists every supported provider even when no key is configured', () => {
    expect(PLATFORM_PROVIDERS.map((provider) => provider.id)).toContain('dashscope')
    expect(PLATFORM_PROVIDERS.map((provider) => provider.id)).toContain('evolink')
  })

  it('only allows the verified Hermes PPT image adapter', () => {
    expect(getManagedModelOptions('hermes-ppt-image')).toEqual([
      expect.objectContaining({ id: 'gpt-image-2', providerId: 'evolink' }),
    ])
  })

  it('does not expose unsupported providers for canvas video', () => {
    expect(new Set(getManagedModelOptions('canvas-video').map((model) => model.providerId))).toEqual(
      new Set(['dashscope'])
    )
  })
})
