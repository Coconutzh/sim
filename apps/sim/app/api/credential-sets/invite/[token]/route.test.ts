/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockParseRequest, mockDbSelect, mockDbUpdate, mockDbTransaction } =
  vi.hoisted(() => ({
    mockGetSession: vi.fn(),
    mockParseRequest: vi.fn(),
    mockDbSelect: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockDbTransaction: vi.fn(),
  }))

vi.mock('@sim/audit', () => ({
  AuditAction: {
    CREDENTIAL_SET_INVITATION_ACCEPTED: 'credential_set_invitation_accepted',
  },
  AuditResourceType: {
    CREDENTIAL_SET: 'credential_set',
  },
  recordAudit: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
    transaction: mockDbTransaction,
  },
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/webhooks/utils.server', () => ({
  syncAllWebhooksForCredentialSet: vi.fn(),
}))

import { POST } from '@/app/api/credential-sets/invite/[token]/route'

describe('POST /api/credential-sets/invite/[token]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com' } })
    mockParseRequest.mockResolvedValue({
      success: false,
      response: Response.json({ error: 'Invalid request' }, { status: 400 }),
    })
  })

  it('authenticates before validating invitation params', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    const unreadableParams = {
      then: () => {
        throw new Error('params should not be read')
      },
    } as unknown as Promise<{ token: string }>

    const response = await POST(
      new NextRequest('http://localhost/api/credential-sets/invite/token-1', {
        method: 'POST',
      }),
      { params: unreadableParams }
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('validates invitation params after session authentication succeeds', async () => {
    const request = new NextRequest('http://localhost/api/credential-sets/invite/token-1', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ token: 'token-1' }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request' })
    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(mockParseRequest).toHaveBeenCalledWith(expect.any(Object), request, {
      params: expect.any(Promise),
    })
    expect(mockGetSession.mock.invocationCallOrder[0]).toBeLessThan(
      mockParseRequest.mock.invocationCallOrder[0]
    )
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
