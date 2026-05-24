/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockUpdatePublicationDetails } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockUpdatePublicationDetails: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))
vi.mock('@/lib/collaboration/service', () => ({
  updatePublicationDetails: mockUpdatePublicationDetails,
}))

import { PATCH } from '@/app/api/publications/[publicationVersionId]/details/route'

describe('Publication details API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
  })

  it('updates publication title and description through the contract-bound route', async () => {
    mockUpdatePublicationDetails.mockResolvedValue({
      id: 'publication-1',
      title: 'Updated team plan',
      description: 'Ready for project review.',
      updatedAt: '2026-05-24T00:00:00.000Z',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/publications/publication-1/details',
      {
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Updated team plan',
          description: 'Ready for project review.',
          reason: 'Clarified project-facing title',
        }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockUpdatePublicationDetails).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      publicationVersionId: 'publication-1',
      title: 'Updated team plan',
      description: 'Ready for project review.',
      reason: 'Clarified project-facing title',
    })
    await expect(response.json()).resolves.toEqual({
      publication: {
        id: 'publication-1',
        title: 'Updated team plan',
        description: 'Ready for project review.',
        updatedAt: '2026-05-24T00:00:00.000Z',
      },
    })
  })

  it('allows clearing the publication description', async () => {
    mockUpdatePublicationDetails.mockResolvedValue({
      id: 'publication-1',
      title: 'Updated team plan',
      description: null,
      updatedAt: '2026-05-24T00:00:00.000Z',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/publications/publication-1/details',
      {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated team plan', description: null }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockUpdatePublicationDetails).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      publicationVersionId: 'publication-1',
      title: 'Updated team plan',
      description: null,
      reason: undefined,
    })
  })

  it('returns 403 when the actor cannot manage the source team publication', async () => {
    mockUpdatePublicationDetails.mockRejectedValueOnce(new Error('Workgroup admin access required'))

    const request = new NextRequest(
      'http://localhost:3000/api/publications/publication-1/details',
      {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated team plan', description: null }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Workgroup admin access required' })
  })

  it('returns 401 before parsing when no session is available', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const request = new NextRequest(
      'http://localhost:3000/api/publications/publication-1/details',
      {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Updated team plan', description: null }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(401)
    expect(mockUpdatePublicationDetails).not.toHaveBeenCalled()
  })
})
