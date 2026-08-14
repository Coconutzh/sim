/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { logger, mockGetPlatformProviderApiKeys, mockWhere } = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockGetPlatformProviderApiKeys: vi.fn(),
  mockWhere: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: mockWhere })),
    })),
  },
  platformModelServiceConfig: {
    consumer: 'consumer',
    capability: 'capability',
    family: 'family',
    status: 'status',
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: vi.fn(() => logger),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((left: unknown, right: unknown) => ({ left, right })),
}))

vi.mock('@/lib/api-key/platform', () => ({
  getPlatformProviderApiKeys: mockGetPlatformProviderApiKeys,
}))

import {
  getPlatformContentServiceAvailability,
  getPlatformContentServiceConfig,
} from '@/lib/content-canvas/platform-service-config'

describe('platform content service config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWhere.mockResolvedValue([])
    mockGetPlatformProviderApiKeys.mockResolvedValue([])
  })

  it('warns without secrets and returns no managed availability when the table read fails', async () => {
    mockWhere.mockRejectedValue(
      new Error('relation platform_model_service_config does not exist near managed-secret')
    )

    await expect(getPlatformContentServiceAvailability()).resolves.toEqual([])
    await expect(
      getPlatformContentServiceConfig({
        capability: 'text',
        family: 'gemini',
        modelId: 'gemini-2.5-flash',
      })
    ).resolves.toBeNull()

    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      'Failed to read managed content service availability; returning no services'
    )
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      'Failed to read managed content service configuration; returning no service',
      {
        capability: 'text',
        family: 'gemini',
        modelId: 'gemini-2.5-flash',
      }
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('managed-secret')
  })
})
