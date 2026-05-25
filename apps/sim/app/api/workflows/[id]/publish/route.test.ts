/**
 * @vitest-environment node
 */
import { hybridAuthMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPublishWorkflowToMainline = vi.hoisted(() => vi.fn())

vi.mock('@/lib/workflows/publication', () => ({
  publishWorkflowToMainline: mockPublishWorkflowToMainline,
}))

import { POST } from '@/app/api/workflows/[id]/publish/route'

describe('Workflow Publish API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'viewer-1',
      authType: 'session',
    })
  })

  it('rejects publish attempts through cross-team shared access with 403', async () => {
    mockPublishWorkflowToMainline.mockRejectedValueOnce(new Error('Canvas access required'))

    const request = new NextRequest('http://localhost:3000/api/workflows/draft-1/publish', {
      method: 'POST',
      body: JSON.stringify({
        visibility: 'organization',
        viewerWorkgroupIds: [],
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'draft-1' }) })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Canvas access required',
    })
  })

  it('hides foreign personal workflows from publish attempts', async () => {
    mockPublishWorkflowToMainline.mockRejectedValueOnce(new Error('Workflow not found'))

    const request = new NextRequest('http://localhost:3000/api/workflows/hidden-1/publish', {
      method: 'POST',
      body: JSON.stringify({
        visibility: 'workspace',
        viewerWorkgroupIds: [],
      }),
      headers: { 'content-type': 'application/json' },
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'hidden-1' }) })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Workflow not found',
    })
  })
})
