/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetWorkflowPublicationDetails = vi.hoisted(() => vi.fn())
const mockUpdateWorkflowPublicationDetails = vi.hoisted(() => vi.fn())

vi.mock('@/lib/workflows/publication', () => ({
  getWorkflowPublicationDetails: mockGetWorkflowPublicationDetails,
  updateWorkflowPublicationDetails: mockUpdateWorkflowPublicationDetails,
}))

import { GET, PATCH } from '@/app/api/workflows/[id]/publication/route'

describe('Workflow Publication API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'viewer-1',
      authType: 'session',
    })
  })

  it('rejects publication updates through cross-team shared access with 403', async () => {
    mockUpdateWorkflowPublicationDetails.mockRejectedValueOnce(new Error('Canvas access required'))

    const request = new NextRequest('http://localhost:3000/api/workflows/published-1/publication', {
      method: 'PATCH',
      body: JSON.stringify({
        visibility: 'organization',
        viewerWorkgroupIds: [],
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'published-1' }) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Canvas access required',
    })
  })

  it('hides foreign personal workflows from publication reads', async () => {
    mockGetWorkflowPublicationDetails.mockRejectedValueOnce(new Error('Workflow not found'))

    const request = new NextRequest('http://localhost:3000/api/workflows/hidden-1/publication')

    const response = await GET(request, { params: Promise.resolve({ id: 'hidden-1' }) })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Workflow not found',
    })
  })

  it('hides foreign personal workflows from publication updates', async () => {
    mockUpdateWorkflowPublicationDetails.mockRejectedValueOnce(new Error('Workflow not found'))

    const request = new NextRequest('http://localhost:3000/api/workflows/hidden-1/publication', {
      method: 'PATCH',
      body: JSON.stringify({
        visibility: 'workspace',
        viewerWorkgroupIds: [],
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'hidden-1' }) })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Workflow not found',
    })
  })
})
