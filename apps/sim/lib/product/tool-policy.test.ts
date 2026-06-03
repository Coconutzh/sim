import { afterEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

async function loadToolPolicyModule() {
  vi.resetModules()
  return import('@/lib/product/tool-policy')
}

describe('tool-policy', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.resetModules()
  })

  it('enables the content canvas block in the default tapnow preset', async () => {
    delete process.env.NEXT_PUBLIC_SIM_TOOL_POLICY_PRESET
    delete process.env.NEXT_PUBLIC_SIM_ENABLED_BLOCK_TYPES

    const { isBlockEnabled } = await loadToolPolicyModule()

    expect(isBlockEnabled('content')).toBe(true)
  })
})
