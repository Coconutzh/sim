/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockHermesPresentationSourceError,
  mockExportHermesPresentationSource,
  mockRecordHermesToolCallAudit,
} = vi.hoisted(() => {
  class MockHermesPresentationSourceError extends Error {
    constructor(
      public readonly code: string,
      message: string
    ) {
      super(message)
      this.name = 'HermesPresentationSourceError'
    }
  }
  return {
    MockHermesPresentationSourceError,
    mockExportHermesPresentationSource: vi.fn(),
    mockRecordHermesToolCallAudit: vi.fn(),
  }
})

vi.mock('@/lib/core/config/env', () => ({
  env: { HERMES_SERVICE_TOKEN: 'h'.repeat(32) },
}))

vi.mock('@/lib/hermes/presentation-source', () => ({
  exportHermesPresentationSource: mockExportHermesPresentationSource,
  HermesPresentationSourceError: MockHermesPresentationSourceError,
}))

vi.mock('@/lib/hermes/tool-call-audit', () => ({
  recordHermesToolCallAudit: mockRecordHermesToolCallAudit,
}))

import { GET } from '@/app/api/internal/hermes/presentation-artifacts/source/route'

function buildRequest(params: { token?: string; includeQuery?: boolean } = {}): NextRequest {
  const query = new URLSearchParams({
    userId: 'user-1',
    organizationId: 'org-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    nodeId: 'ppt-node-1',
    traceId: 'trace-1',
  })
  return new NextRequest(
    `http://localhost:3000/api/internal/hermes/presentation-artifacts/source${
      params.includeQuery === false ? '' : `?${query.toString()}`
    }`,
    {
      headers: params.token ? { Authorization: `Bearer ${params.token}` } : {},
    }
  )
}

describe('Hermes presentation source route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExportHermesPresentationSource.mockResolvedValue({
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      fileName: 'original deck.pptx',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      size: 4,
    })
  })

  it('checks service auth before parsing query parameters', async () => {
    const response = await GET(buildRequest({ includeQuery: false }))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.errorCode).toBe('UNAUTHENTICATED_SERVICE')
    expect(mockExportHermesPresentationSource).not.toHaveBeenCalled()
  })

  it('returns the authorized PPTX with no-store headers', async () => {
    const response = await GET(buildRequest({ token: 'h'.repeat(32) }))
    const bytes = Buffer.from(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(bytes).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-sim-presentation-file-name')).toBe('original%20deck.pptx')
    expect(mockExportHermesPresentationSource).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      nodeId: 'ppt-node-1',
    })
    expect(mockRecordHermesToolCallAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-1',
        toolName: 'sim_presentation_editable_source_prepare',
        status: 'success',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
      })
    )
  })

  it('maps source access failures to a non-disclosing 404', async () => {
    mockExportHermesPresentationSource.mockRejectedValueOnce(
      new MockHermesPresentationSourceError(
        'PRESENTATION_FILE_NOT_FOUND',
        'The original PPT is unavailable or no longer accessible.'
      )
    )

    const response = await GET(buildRequest({ token: 'h'.repeat(32) }))
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload).toMatchObject({
      success: false,
      errorCode: 'PRESENTATION_FILE_NOT_FOUND',
    })
  })
})
