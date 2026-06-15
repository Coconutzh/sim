/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetWorkspaceFile, mockListChatUploads, mockReadFileRecord } = vi.hoisted(() => ({
  mockGetWorkspaceFile: vi.fn(),
  mockListChatUploads: vi.fn(),
  mockReadFileRecord: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: mockGetWorkspaceFile,
}))

vi.mock('@/lib/copilot/tools/handlers/upload-file-reader', () => ({
  listChatUploads: mockListChatUploads,
}))

vi.mock('@/lib/copilot/vfs/file-reader', () => ({
  readFileRecord: mockReadFileRecord,
}))

import { buildHermesMultimodalInput } from '@/lib/hermes/multimodal-attachments'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const NOW = new Date('2026-06-15T00:00:00.000Z')

function makeRecord(overrides: Partial<WorkspaceFileRecord> = {}): WorkspaceFileRecord {
  return {
    id: 'wf_image',
    workspaceId: 'workspace-1',
    name: 'image.png',
    key: 'workspace/workspace-1/image.png',
    path: '/api/files/serve/workspace%2Fworkspace-1%2Fimage.png?context=workspace',
    size: 12,
    type: 'image/png',
    uploadedBy: 'user-1',
    deletedAt: null,
    uploadedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('buildHermesMultimodalInput', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListChatUploads.mockResolvedValue([])
    mockReadFileRecord.mockResolvedValue({
      content: 'Image: image.png',
      totalLines: 1,
      attachment: {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'AAAA',
        },
      },
    })
  })

  it('returns undefined when the request has no supported attachments', async () => {
    const input = await buildHermesMultimodalInput({
      requestPayload: {
        fileAttachments: [
          {
            id: 'attachment-1',
            workspaceFileId: 'wf_audio',
            key: 'workspace/workspace-1/audio.mp3',
            filename: 'audio.mp3',
            media_type: 'audio/mpeg',
            size: 123,
            storageContext: 'workspace',
          },
        ],
      },
      message: 'summarize this',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
    })

    expect(input).toBeUndefined()
    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
    expect(mockReadFileRecord).not.toHaveBeenCalled()
  })

  it('builds Responses text input from a workspace PDF attachment', async () => {
    mockGetWorkspaceFile.mockResolvedValueOnce(
      makeRecord({
        id: 'wf_doc',
        name: 'brief.pdf',
        key: 'workspace/workspace-1/brief.pdf',
        path: '/api/files/serve/workspace%2Fworkspace-1%2Fbrief.pdf?context=workspace',
        type: 'application/pdf',
        size: 123,
      })
    )
    mockReadFileRecord.mockResolvedValueOnce({
      content: 'Paper title\nAbstract: This paper studies agent memory.',
      totalLines: 2,
    })

    const input = await buildHermesMultimodalInput({
      requestPayload: {
        fileAttachments: [
          {
            id: 'attachment-1',
            workspaceFileId: 'wf_doc',
            key: 'workspace/workspace-1/brief.pdf',
            filename: 'brief.pdf',
            media_type: 'application/pdf',
            size: 123,
            storageContext: 'workspace',
          },
        ],
      },
      message: 'summarize this paper',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
    })

    expect(mockGetWorkspaceFile).toHaveBeenCalledWith('workspace-1', 'wf_doc')
    expect(mockReadFileRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf_doc' }))
    expect(input).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: expect.stringContaining('Attached documents extracted and supplied to Hermes'),
          },
          {
            type: 'input_text',
            text: expect.stringContaining('Attached document: brief.pdf'),
          },
        ],
      },
    ])
    expect(input?.[0]?.content[1]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining('This paper studies agent memory.'),
      })
    )
  })

  it('builds Responses multimodal input from a workspace image attachment', async () => {
    mockGetWorkspaceFile.mockResolvedValueOnce(makeRecord())

    const input = await buildHermesMultimodalInput({
      requestPayload: {
        fileAttachments: [
          {
            id: 'attachment-1',
            workspaceFileId: 'wf_image',
            key: 'workspace/workspace-1/image.png',
            filename: 'image.png',
            media_type: 'image/png',
            size: 12,
            storageContext: 'workspace',
          },
        ],
      },
      message: 'describe this image',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
    })

    expect(mockGetWorkspaceFile).toHaveBeenCalledWith('workspace-1', 'wf_image')
    expect(mockReadFileRecord).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf_image' }))
    expect(input).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: expect.stringContaining('describe this image'),
          },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,AAAA',
          },
        ],
      },
    ])
    expect(input?.[0]?.content[0]).toEqual(
      expect.objectContaining({
        text: expect.stringContaining('Attached images supplied to Hermes'),
      })
    )
  })

  it('builds Responses multimodal input from a chat-scoped mothership upload', async () => {
    mockGetWorkspaceFile.mockResolvedValueOnce(null)
    mockListChatUploads.mockResolvedValueOnce([
      makeRecord({
        id: 'wf_upload',
        name: 'screenshot.png',
        key: 'mothership/chat-1/screenshot.png',
        path: '/api/files/serve/mothership%2Fchat-1%2Fscreenshot.png?context=mothership',
        storageContext: 'mothership',
      }),
    ])

    const input = await buildHermesMultimodalInput({
      requestPayload: {
        fileAttachments: [
          {
            id: 'attachment-1',
            key: 'mothership/chat-1/screenshot.png',
            filename: 'screenshot.png',
            media_type: 'image/png',
            size: 12,
            storageContext: 'mothership',
          },
        ],
      },
      message: 'what is in it?',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
    })

    expect(mockListChatUploads).toHaveBeenCalledWith('chat-1')
    expect(mockReadFileRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'wf_upload', storageContext: 'mothership' })
    )
    expect(input).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: expect.stringContaining('screenshot.png'),
          },
          {
            type: 'input_image',
            image_url: 'data:image/png;base64,AAAA',
          },
        ],
      },
    ])
  })
})
