/**
 * @vitest-environment node
 */
import {
  auditMock,
  auditMockFns,
  authMockFns,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockPackerToBuffer, mockUploadWorkspaceFile, mockGetWorkspaceFile } = vi.hoisted(() => ({
  mockPackerToBuffer: vi.fn(),
  mockUploadWorkspaceFile: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
}))

vi.mock('docx', () => {
  class Document {
    constructor(public readonly options: unknown) {}
  }

  class Paragraph {
    constructor(public readonly options: unknown) {}
  }

  class TextRun {
    constructor(public readonly options: unknown) {}
  }

  return {
    Document,
    Paragraph,
    TextRun,
    Packer: {
      toBuffer: mockPackerToBuffer,
    },
  }
})

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  uploadWorkspaceFile: mockUploadWorkspaceFile,
  getWorkspaceFile: mockGetWorkspaceFile,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@sim/audit', () => auditMock)

const WS = '7727ef3f-8cf6-4686-b063-2bb006a10785'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

import { POST } from '@/app/api/workspaces/[id]/files/docx/route'

const params = (id = WS) => ({ params: Promise.resolve({ id }) })

function makeRequest(body: unknown) {
  return new NextRequest(`http://localhost/api/workspaces/${WS}/files/docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/workspaces/[id]/files/docx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', name: 'User One', email: 'u@example.com' },
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: WS, ownerId: 'user-1', workspaceMode: 'organization' },
    })
    mockPackerToBuffer.mockResolvedValue(Buffer.from('PK\x03\x04docx'))
    mockUploadWorkspaceFile.mockResolvedValue({ id: 'wf_docx' })
    mockGetWorkspaceFile.mockResolvedValue({
      id: 'wf_docx',
      workspaceId: WS,
      name: 'agent-output.docx',
      key: `workspace/${WS}/agent-output.docx`,
      path: `/api/files/serve/workspace%2F${WS}%2Fagent-output.docx?context=workspace`,
      size: 8,
      type: DOCX_MIME,
      uploadedBy: 'user-1',
      uploadedAt: new Date('2026-06-10T00:00:00.000Z'),
      updatedAt: new Date('2026-06-10T00:00:00.000Z'),
      storageContext: 'workspace',
    })
  })

  it('generates a DOCX and uploads it as a workspace file', async () => {
    const request = makeRequest({
      content: '# Summary\n\nThis is the answer.',
      fileName: 'summary',
      chatId: 'chat-1',
      messageId: 'msg-1',
      workflowId: 'wf-1',
    })

    const response = await POST(request, params())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      file: { id: 'wf_docx', name: 'agent-output.docx', key: `workspace/${WS}/agent-output.docx` },
    })
    expect(mockPackerToBuffer).toHaveBeenCalledWith(expect.any(Object))
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      WS,
      'user-1',
      expect.any(Buffer),
      'summary.docx',
      DOCX_MIME
    )
    expect(auditMockFns.mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WS,
        resourceId: 'wf_docx',
        metadata: expect.objectContaining({
          chatId: 'chat-1',
          messageId: 'msg-1',
          workflowId: 'wf-1',
        }),
      })
    )
  })

  it('returns a clear error when DOCX generation fails', async () => {
    mockPackerToBuffer.mockRejectedValueOnce(new Error('DOCX generation failed'))

    const response = await POST(makeRequest({ content: 'answer' }), params())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ success: false, error: 'DOCX generation failed' })
    expect(mockUploadWorkspaceFile).not.toHaveBeenCalled()
  })

  it('returns a clear error when workspace upload fails', async () => {
    mockUploadWorkspaceFile.mockRejectedValueOnce(new Error('Storage limit exceeded'))

    const response = await POST(makeRequest({ content: 'answer' }), params())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ success: false, error: 'Storage limit exceeded' })
  })

  it('returns 403 when the user cannot write workspace files', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: { id: WS, ownerId: 'owner-1', workspaceMode: 'organization' },
    })

    const response = await POST(makeRequest({ content: 'answer' }), params())

    expect(response.status).toBe(403)
    expect(mockPackerToBuffer).not.toHaveBeenCalled()
  })
})
