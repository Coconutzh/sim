/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockUpdatePublicationReview } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockUpdatePublicationReview: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))
vi.mock('@/lib/collaboration/service', () => ({
  updatePublicationReview: mockUpdatePublicationReview,
}))

import { PATCH } from '@/app/api/publications/[publicationVersionId]/review/route'

describe('Publication review API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
  })

  it('updates review governance fields through the contract-bound route', async () => {
    mockUpdatePublicationReview.mockResolvedValue({
      id: 'publication-1',
      title: 'Team plan',
      reviewState: 'approved',
      riskLevel: 'medium',
      reviewer: null,
      updatedAt: '2026-05-24T00:00:00.000Z',
    })

    const request = new NextRequest('http://localhost:3000/api/publications/publication-1/review', {
      method: 'PATCH',
      body: JSON.stringify({
        reviewState: 'approved',
        riskLevel: 'medium',
        reason: 'Approved for project tree',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockUpdatePublicationReview).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      publicationVersionId: 'publication-1',
      reviewState: 'approved',
      riskLevel: 'medium',
      reviewerUserId: undefined,
      reason: 'Approved for project tree',
    })
    await expect(response.json()).resolves.toEqual({
      publication: {
        id: 'publication-1',
        title: 'Team plan',
        reviewState: 'approved',
        riskLevel: 'medium',
        reviewer: null,
        updatedAt: '2026-05-24T00:00:00.000Z',
      },
    })
  })

  it('assigns a reviewer through the review governance route', async () => {
    mockUpdatePublicationReview.mockResolvedValue({
      id: 'publication-1',
      title: 'Team plan',
      reviewState: 'in_review',
      riskLevel: 'high',
      reviewer: {
        userId: 'reviewer-1',
        assignedBy: 'admin-1',
        assignedAt: '2026-05-24T00:00:00.000Z',
      },
      updatedAt: '2026-05-24T00:00:00.000Z',
    })

    const request = new NextRequest('http://localhost:3000/api/publications/publication-1/review', {
      method: 'PATCH',
      body: JSON.stringify({
        reviewState: 'in_review',
        riskLevel: 'high',
        reviewerUserId: 'reviewer-1',
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockUpdatePublicationReview).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      publicationVersionId: 'publication-1',
      reviewState: 'in_review',
      riskLevel: 'high',
      reviewerUserId: 'reviewer-1',
      reason: undefined,
    })
  })

  it('allows clearing review governance fields', async () => {
    mockUpdatePublicationReview.mockResolvedValue({
      id: 'publication-1',
      title: 'Team plan',
      reviewState: null,
      riskLevel: null,
      reviewer: null,
      updatedAt: '2026-05-24T00:00:00.000Z',
    })

    const request = new NextRequest('http://localhost:3000/api/publications/publication-1/review', {
      method: 'PATCH',
      body: JSON.stringify({ reviewState: null, riskLevel: null }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockUpdatePublicationReview).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      publicationVersionId: 'publication-1',
      reviewState: null,
      riskLevel: null,
      reviewerUserId: undefined,
      reason: undefined,
    })
  })

  it('returns 403 when the actor cannot manage the source team publication', async () => {
    mockUpdatePublicationReview.mockRejectedValueOnce(new Error('Workgroup admin access required'))

    const request = new NextRequest('http://localhost:3000/api/publications/publication-1/review', {
      method: 'PATCH',
      body: JSON.stringify({ reviewState: 'in_review', riskLevel: 'high' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Workgroup admin access required' })
  })

  it('returns 401 before parsing when no session is available', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const request = new NextRequest('http://localhost:3000/api/publications/publication-1/review', {
      method: 'PATCH',
      body: JSON.stringify({ reviewState: 'approved', riskLevel: 'low' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(401)
    expect(mockUpdatePublicationReview).not.toHaveBeenCalled()
  })
})
