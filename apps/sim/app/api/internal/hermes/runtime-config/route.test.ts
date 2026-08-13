/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'

const { mockLimit } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: mockLimit,
          })),
        })),
      })),
    })),
  },
  platformModelServiceConfig: {
    consumer: 'consumer',
    capability: 'capability',
    family: 'family',
    status: 'status',
    priority: 'priority',
  },
}))

vi.mock('@/lib/core/config/env', () => ({ env: { HERMES_SERVICE_TOKEN: 'service-token' } }))

vi.mock('@/lib/api-key/platform', () => ({
  getPlatformProviderApiKey: vi.fn(),
}))

import { GET } from '@/app/api/internal/hermes/runtime-config/route'

describe('GET /api/internal/hermes/runtime-config', () => {
  it('returns unavailable when managed configuration cannot be read', async () => {
    mockLimit.mockRejectedValueOnce(new Error('relation does not exist'))
    const request = new NextRequest(
      'http://localhost:3000/api/internal/hermes/runtime-config' +
        '?consumer=hermes-ppt&capability=image&family=ppt',
      {
        headers: { 'x-sim-service-token': 'service-token' },
      }
    )

    const response = await GET(request)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      config: null,
    })
  })
})
