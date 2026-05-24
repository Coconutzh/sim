/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockGetPublication, mockUpdatePublicationLifecycleStatus } = vi.hoisted(
  () => ({
    mockGetSession: vi.fn(),
    mockGetPublication: vi.fn(),
    mockUpdatePublicationLifecycleStatus: vi.fn(),
  })
)

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))
vi.mock('@/lib/collaboration/service', () => ({
  getPublication: mockGetPublication,
  updatePublicationLifecycleStatus: mockUpdatePublicationLifecycleStatus,
}))

import { PATCH } from '@/app/api/publications/[publicationVersionId]/route'

describe('Publication lifecycle API route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
  })

  it('archives a publication through the contract-bound lifecycle route', async () => {
    mockUpdatePublicationLifecycleStatus.mockResolvedValue({
      id: 'publication-1',
      title: 'Team plan',
      status: 'archived',
      archivedAt: '2026-05-23T00:00:00.000Z',
      retractedAt: null,
      lifecycleUpdatedAt: '2026-05-23T00:00:00.000Z',
      publishedAt: '2026-05-22T00:00:00.000Z',
    })

    const request = new NextRequest('http://localhost:3000/api/publications/publication-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'archive', reason: 'Superseded' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    await expect(response.json()).resolves.toEqual({
      publication: {
        id: 'publication-1',
        title: 'Team plan',
        status: 'archived',
        archivedAt: '2026-05-23T00:00:00.000Z',
        retractedAt: null,
        lifecycleUpdatedAt: '2026-05-23T00:00:00.000Z',
        publishedAt: '2026-05-22T00:00:00.000Z',
      },
    })
    expect(response.status).toBe(200)
    expect(mockUpdatePublicationLifecycleStatus).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      publicationVersionId: 'publication-1',
      action: 'archive',
      reason: 'Superseded',
    })
  })

  it('restores a superseded publication through the lifecycle route', async () => {
    mockUpdatePublicationLifecycleStatus.mockResolvedValue({
      id: 'publication-1',
      title: 'Team plan',
      status: 'published',
      archivedAt: null,
      retractedAt: null,
      lifecycleUpdatedAt: '2026-05-24T00:00:00.000Z',
      publishedAt: '2026-05-22T00:00:00.000Z',
    })

    const request = new NextRequest('http://localhost:3000/api/publications/publication-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'restore', reason: 'Rollback to approved cues' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(200)
    expect(mockUpdatePublicationLifecycleStatus).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      publicationVersionId: 'publication-1',
      action: 'restore',
      reason: 'Rollback to approved cues',
    })
    await expect(response.json()).resolves.toEqual({
      publication: {
        id: 'publication-1',
        title: 'Team plan',
        status: 'published',
        archivedAt: null,
        retractedAt: null,
        lifecycleUpdatedAt: '2026-05-24T00:00:00.000Z',
        publishedAt: '2026-05-22T00:00:00.000Z',
      },
    })
  })

  it('returns 403 when the actor cannot manage the source team publication', async () => {
    mockUpdatePublicationLifecycleStatus.mockRejectedValueOnce(
      new Error('Workgroup admin access required')
    )

    const request = new NextRequest('http://localhost:3000/api/publications/publication-1', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'retract' }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, {
      params: Promise.resolve({ publicationVersionId: 'publication-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Workgroup admin access required' })
  })
})
