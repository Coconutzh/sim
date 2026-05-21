/**
 * @vitest-environment node
 */
import { auditMock, authMock, authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCheckFormAccess } = vi.hoisted(() => ({
  mockCheckFormAccess: vi.fn(),
}))

vi.mock('@sim/audit', () => auditMock)
vi.mock('@sim/db', () => ({
  db: {},
}))
vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/core/security/encryption', () => ({
  encryptSecret: vi.fn(),
}))
vi.mock('@/app/api/form/utils', () => ({
  checkFormAccess: mockCheckFormAccess,
  DEFAULT_FORM_CUSTOMIZATIONS: {},
}))
vi.mock('@/app/api/workflows/utils', () => ({
  createErrorResponse: (error: string, status: number) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  createSuccessResponse: (data: unknown) =>
    new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
}))

import { DELETE, GET } from '@/app/api/form/manage/[id]/route'

describe('Form Manage API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue(null)
  })

  it('GET authenticates before validating route params', async () => {
    const response = await GET(createMockRequest('GET'), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(mockCheckFormAccess).not.toHaveBeenCalled()
  })

  it('DELETE authenticates before validating route params', async () => {
    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ id: '' }),
    })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toEqual({ error: 'Unauthorized' })
    expect(mockCheckFormAccess).not.toHaveBeenCalled()
  })
})
