/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockHermesCanvasMediaExportError,
  mockExportHermesCanvasNodeImage,
  mockRecordHermesToolCallAudit,
} = vi.hoisted(() => {
  class MockHermesCanvasMediaExportError extends Error {
    constructor(
      public readonly code: string,
      message: string
    ) {
      super(message)
      this.name = 'HermesCanvasMediaExportError'
    }
  }
  return {
    MockHermesCanvasMediaExportError,
    mockExportHermesCanvasNodeImage: vi.fn(),
    mockRecordHermesToolCallAudit: vi.fn(),
  }
})

vi.mock('@/lib/core/config/env', () => ({
  env: {
    HERMES_SERVICE_TOKEN: 'h'.repeat(32),
  },
}))

vi.mock('@/lib/hermes/canvas-media-export', () => ({
  exportHermesCanvasNodeImage: mockExportHermesCanvasNodeImage,
  HermesCanvasMediaExportError: MockHermesCanvasMediaExportError,
}))

vi.mock('@/lib/hermes/tool-call-audit', () => ({
  recordHermesToolCallAudit: mockRecordHermesToolCallAudit,
}))

import { POST } from '@/app/api/internal/hermes/canvas-media/export/route'

function buildRequest(params: { body: string; token?: string; traceId?: string }): NextRequest {
  return new NextRequest('http://localhost:3000/api/internal/hermes/canvas-media/export', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(params.token ? { 'x-sim-service-token': params.token } : {}),
      ...(params.traceId ? { 'x-trace-id': params.traceId } : {}),
    },
    body: params.body,
  })
}

describe('Hermes canvas media export route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExportHermesCanvasNodeImage.mockResolvedValue({
      buffer: Buffer.from('image-bytes'),
      nodeId: 'image-1',
      nodeTitle: 'Hero Image',
      fileName: 'hero.png',
      contentType: 'image/png',
      size: 'image-bytes'.length,
    })
  })

  it('checks service auth before parsing JSON body', async () => {
    const response = await POST(buildRequest({ body: '{not-json' }))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.errorCode).toBe('UNAUTHENTICATED_SERVICE')
    expect(mockExportHermesCanvasNodeImage).not.toHaveBeenCalled()
    expect(mockRecordHermesToolCallAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'sim_canvas_media_prepare',
        status: 'unauthenticated',
        errorCode: 'UNAUTHENTICATED_SERVICE',
      })
    )
  })

  it('returns authorized image bytes with SIM audit headers', async () => {
    const response = await POST(
      buildRequest({
        token: 'h'.repeat(32),
        traceId: 'trace-header',
        body: JSON.stringify({
          userId: 'user-1',
          organizationId: 'org-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          chatId: 'chat-1',
          nodeId: 'image-1',
          question: 'Describe it',
          traceId: 'trace-body',
        }),
      })
    )
    const bytes = Buffer.from(await response.arrayBuffer())

    expect(response.status).toBe(200)
    expect(bytes).toEqual(Buffer.from('image-bytes'))
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('content-length')).toBe(String('image-bytes'.length))
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-sim-audit-id')).toBeTruthy()
    expect(response.headers.get('x-sim-canvas-node-id')).toBe('image-1')
    expect(response.headers.get('x-sim-canvas-node-title')).toBe('Hero%20Image')
    expect(response.headers.get('x-sim-media-file-name')).toBe('hero.png')
    expect(mockExportHermesCanvasNodeImage).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      nodeId: 'image-1',
      selectedNodeIds: [],
    })
    expect(mockRecordHermesToolCallAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-body',
        toolName: 'sim_canvas_media_prepare',
        status: 'success',
        userId: 'user-1',
        organizationId: 'org-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        inputSummary: expect.objectContaining({
          nodeId: 'image-1',
          questionLength: 'Describe it'.length,
        }),
        outputSummary: expect.objectContaining({
          success: true,
          nodeId: 'image-1',
          contentType: 'image/png',
        }),
      })
    )
  })

  it('maps export errors to JSON responses and audit rows', async () => {
    mockExportHermesCanvasNodeImage.mockRejectedValueOnce(
      new MockHermesCanvasMediaExportError('MEDIA_UNSUPPORTED', 'Node is not an image')
    )

    const response = await POST(
      buildRequest({
        token: 'h'.repeat(32),
        body: JSON.stringify({
          userId: 'user-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          nodeId: 'node-1',
        }),
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({
      success: false,
      errorCode: 'MEDIA_UNSUPPORTED',
      error: 'Node is not an image',
    })
    expect(mockRecordHermesToolCallAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'sim_canvas_media_prepare',
        status: 'error',
        errorCode: 'MEDIA_UNSUPPORTED',
        error: 'Node is not an image',
      })
    )
  })
})
