/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceMembershipAccess, mockRecordHermesToolCallAudit, mockUploadWorkspaceFile } =
  vi.hoisted(() => ({
    mockGetWorkspaceMembershipAccess: vi.fn(),
    mockRecordHermesToolCallAudit: vi.fn(),
    mockUploadWorkspaceFile: vi.fn(),
  }))

vi.mock('@/lib/core/config/env', () => ({
  env: {
    HERMES_SERVICE_TOKEN: 'h'.repeat(32),
  },
}))

vi.mock('@/app/api/workflows/utils', () => ({
  getWorkspaceMembershipAccess: mockGetWorkspaceMembershipAccess,
}))

vi.mock('@/lib/uploads/contexts/workspace', () => ({
  uploadWorkspaceFile: mockUploadWorkspaceFile,
}))

vi.mock('@/lib/hermes/tool-call-audit', () => ({
  recordHermesToolCallAudit: mockRecordHermesToolCallAudit,
}))

import { POST } from '@/app/api/internal/hermes/presentation-artifacts/upload/route'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function asBase64(value: string): string {
  return Buffer.from(value).toString('base64')
}

function buildRequest(params: { body: string; token?: string; traceId?: string }): NextRequest {
  return new NextRequest(
    'http://localhost:3000/api/internal/hermes/presentation-artifacts/upload',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(params.token ? { 'x-sim-service-token': params.token } : {}),
        ...(params.traceId ? { 'x-trace-id': params.traceId } : {}),
      },
      body: params.body,
    }
  )
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    organizationId: 'org-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    chatId: 'chat-1',
    targetNodeId: 'ppt-node-1',
    title: 'AI 项目汇报',
    slideCount: 8,
    selectedStyle: '科研答辩风',
    styleBrief: '克制学术风格，图表优先。',
    outlineMarkdown: '# Outline',
    speechMarkdown: '# Speech',
    pptx: {
      fileName: 'AI 项目汇报.pptx',
      contentType: PPTX_MIME,
      base64: asBase64('pptx-bytes'),
      size: 'pptx-bytes'.length,
    },
    coverImage: {
      fileName: 'cover.png',
      contentType: 'image/png',
      base64: asBase64('cover-bytes'),
      size: 'cover-bytes'.length,
    },
    traceId: 'trace-body',
    hermesRunId: 'run-1',
    ...overrides,
  }
}

describe('Hermes presentation artifact upload route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetWorkspaceMembershipAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      permission: 'write',
      canWrite: true,
    })
    mockUploadWorkspaceFile.mockImplementation(
      async (
        _workspaceId: string,
        _userId: string,
        buffer: Buffer,
        fileName: string,
        contentType: string
      ) => ({
        id: `wf_${mockUploadWorkspaceFile.mock.calls.length}`,
        name: fileName,
        size: buffer.length,
        type: contentType,
        url: `/api/files/serve/workspace%2F${encodeURIComponent(fileName)}?context=workspace`,
        key: `workspace/workspace-1/private/${fileName}`,
        context: 'workspace',
      })
    )
  })

  it('checks service auth before parsing JSON body', async () => {
    const response = await POST(buildRequest({ body: '{not-json' }))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.errorCode).toBe('UNAUTHENTICATED_SERVICE')
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
    expect(mockRecordHermesToolCallAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'sim_presentation_artifact_upload',
        status: 'unauthenticated',
        errorCode: 'UNAUTHENTICATED_SERVICE',
      })
    )
  })

  it('uploads pptx, cover image, and manifest into workspace storage', async () => {
    const response = await POST(
      buildRequest({
        token: 'h'.repeat(32),
        traceId: 'trace-header',
        body: JSON.stringify(validBody()),
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      traceId: 'trace-body',
      pptxFile: { name: 'AI 项目汇报.pptx', type: PPTX_MIME },
      coverImageFile: { name: 'cover.png', type: 'image/png' },
      manifestFile: { name: 'AI 项目汇报-manifest.json', type: 'application/json' },
      manifest: {
        title: 'AI 项目汇报',
        source: 'codex-ppt-skill',
        slideCount: 8,
        selectedStyle: '科研答辩风',
        targetNodeId: 'ppt-node-1',
      },
    })
    expect(mockGetWorkspaceMembershipAccess).toHaveBeenCalledWith('user-1', 'workspace-1')
    expect(mockUploadWorkspaceFile).toHaveBeenCalledTimes(3)
    expect(mockUploadWorkspaceFile).toHaveBeenNthCalledWith(
      1,
      'workspace-1',
      'user-1',
      Buffer.from('pptx-bytes'),
      'AI 项目汇报.pptx',
      PPTX_MIME
    )
    expect(mockUploadWorkspaceFile).toHaveBeenNthCalledWith(
      2,
      'workspace-1',
      'user-1',
      Buffer.from('cover-bytes'),
      'cover.png',
      'image/png'
    )
    expect(mockRecordHermesToolCallAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-body',
        hermesRunId: 'run-1',
        toolName: 'sim_presentation_artifact_upload',
        operation: 'upload',
        status: 'success',
        userId: 'user-1',
        organizationId: 'org-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        inputSummary: expect.objectContaining({
          title: 'AI 项目汇报',
          slideCount: 8,
          source: 'codex-ppt-skill',
          hasCoverImage: true,
          hasTargetNodeId: true,
        }),
        outputSummary: expect.objectContaining({
          success: true,
          pptxFileId: expect.stringMatching(/^wf_/),
          manifestFileId: expect.stringMatching(/^wf_/),
        }),
      })
    )
  })

  it('rejects users without write access to the workspace', async () => {
    mockGetWorkspaceMembershipAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      permission: 'read',
      canWrite: false,
    })

    const response = await POST(
      buildRequest({
        token: 'h'.repeat(32),
        body: JSON.stringify(validBody()),
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload).toMatchObject({
      success: false,
      errorCode: 'USER_PERMISSION_DENIED',
    })
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('rejects base64 payloads whose declared size does not match decoded bytes', async () => {
    const response = await POST(
      buildRequest({
        token: 'h'.repeat(32),
        body: JSON.stringify(
          validBody({
            pptx: {
              fileName: 'deck.pptx',
              contentType: PPTX_MIME,
              base64: asBase64('pptx-bytes'),
              size: 999,
            },
          })
        ),
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload).toMatchObject({
      success: false,
      errorCode: 'PRESENTATION_FILE_INVALID',
    })
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })
})
