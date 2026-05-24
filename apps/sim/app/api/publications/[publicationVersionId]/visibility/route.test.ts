/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockUpdatePublicationVisibility } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockUpdatePublicationVisibility: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))
vi.mock('@/lib/collaboration/service', () => ({
  updatePublicationVisibility: mockUpdatePublicationVisibility,
}))

import { PATCH } from '@/app/api/publications/[publicationVersionId]/visibility/route'

describe('Publication visibility API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
  })

  it('updates a publication visibility through the contract-bound route', async () => {
    mockUpdatePublicationVisibility.mockResolvedValue({
      id: 'publication-1',
      title: 'Team plan',
      visibility: 'selected_workgroups',
      targetWorkgroupIds: ['workgroup-2'],
      updatedAt: '2026-05-24T00:00:00.000Z',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/publications/publication-1/visibility',
      {
        method: 'PATCH',
        body: JSON.stringify({
          visibility: 'selected_workgroups',
          targetWorkgroupIds: ['workgroup-2'],
          reason: 'Limit review team',
        }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    await expect(response.json()).resolves.toEqual({
      publication: {
        id: 'publication-1',
        title: 'Team plan',
        visibility: 'selected_workgroups',
        targetWorkgroupIds: ['workgroup-2'],
        updatedAt: '2026-05-24T00:00:00.000Z',
      },
    })
    expect(response.status).toBe(200)
    expect(mockUpdatePublicationVisibility).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      publicationVersionId: 'publication-1',
      visibility: 'selected_workgroups',
      targetWorkgroupIds: ['workgroup-2'],
      reason: 'Limit review team',
    })
  })

  it('defaults omitted selected-team targets to an empty list', async () => {
    mockUpdatePublicationVisibility.mockResolvedValue({
      id: 'publication-1',
      title: 'Team plan',
      visibility: 'organization',
      targetWorkgroupIds: [],
      updatedAt: '2026-05-24T00:00:00.000Z',
    })

    const request = new NextRequest(
      'http://localhost:3000/api/publications/publication-1/visibility',
      {
        method: 'PATCH',
        body: JSON.stringify({ visibility: 'organization' }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockUpdatePublicationVisibility).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      publicationVersionId: 'publication-1',
      visibility: 'organization',
      targetWorkgroupIds: [],
      reason: undefined,
    })
  })

  it('returns 403 when the actor cannot manage the source team publication', async () => {
    mockUpdatePublicationVisibility.mockRejectedValueOnce(
      new Error('Workgroup admin access required')
    )

    const request = new NextRequest(
      'http://localhost:3000/api/publications/publication-1/visibility',
      {
        method: 'PATCH',
        body: JSON.stringify({ visibility: 'organization' }),
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
      'http://localhost:3000/api/publications/publication-1/visibility',
      {
        method: 'PATCH',
        body: JSON.stringify({ visibility: 'organization' }),
        headers: { 'content-type': 'application/json' },
      }
    )

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(401)
    expect(mockUpdatePublicationVisibility).not.toHaveBeenCalled()
  })
})
