/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const {
  mockBuildLocalAgentRoleSystemPrompt,
  mockExecuteLocalAgentModelRequest,
  mockFetchWorkspaceFileBuffer,
  mockGetWorkspaceFile,
  mockPrepareImageForVision,
  mockRenderPdfPagesToImages,
} = vi.hoisted(() => ({
  mockBuildLocalAgentRoleSystemPrompt: vi.fn(),
  mockExecuteLocalAgentModelRequest: vi.fn(),
  mockFetchWorkspaceFileBuffer: vi.fn(),
  mockGetWorkspaceFile: vi.fn(),
  mockPrepareImageForVision: vi.fn(),
  mockRenderPdfPagesToImages: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/config', () => ({
  executeLocalAgentModelRequest: mockExecuteLocalAgentModelRequest,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/models/prompts', () => ({
  buildLocalAgentRoleSystemPrompt: mockBuildLocalAgentRoleSystemPrompt,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/pdf-renderer', () => ({
  renderPdfPagesToImages: mockRenderPdfPagesToImages,
}))

vi.mock('@/lib/copilot/vfs/file-reader', () => ({
  prepareImageForVision: mockPrepareImageForVision,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: mockFetchWorkspaceFileBuffer,
  getWorkspaceFile: mockGetWorkspaceFile,
}))

import { analyzeAttachmentVision } from '@/lib/copilot/request/lifecycle/local-canvas-agent/attachment-vision'

function buildContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '请读取附件内容',
    sessionScope: 'personal',
    agent: { code: 'local_canvas_agent', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'canvas_runtime', name: 'Canvas Runtime' },
    workgroup: { id: '', name: 'Workspace', organizationId: '', teamWorkspaceId: null },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: [],
    attachments: [
      {
        id: 'wf_image',
        key: 'workspace/workspace-1/private/hero.png',
        name: 'hero.png',
        type: 'image/png',
        url: '/api/files/serve/workspace%2Fworkspace-1%2Fprivate%2Fhero.png?context=workspace',
        storageContext: 'workspace',
      },
    ],
    attachedContexts: [],
    conversationHistory: [],
    skills: [],
    model: { provider: 'google', model: 'gemini-2.5-flash', mode: 'structured' },
    confirmationMode: 'auto',
    thinkingLevel: 'standard',
    requestPayload: {},
    execContext: {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
    ...overrides,
  }
}

function workspaceRecord(id: string, name: string, type: string) {
  return {
    id,
    workspaceId: 'workspace-1',
    name,
    key: `workspace/workspace-1/private/${name}`,
    path: `/api/files/serve/workspace%2Fworkspace-1%2Fprivate%2F${name}?context=workspace`,
    size: 1024,
    type,
    uploadedBy: 'user-1',
    uploadedAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  }
}

function firstRequestParts() {
  return mockExecuteLocalAgentModelRequest.mock.calls[0]?.[1]?.messages?.[0]?.parts ?? []
}

describe('analyzeAttachmentVision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBuildLocalAgentRoleSystemPrompt.mockReturnValue('vision system prompt')
    mockGetWorkspaceFile.mockImplementation((_workspaceId: string, fileId: string) =>
      fileId === 'wf_pdf'
        ? Promise.resolve(workspaceRecord(fileId, 'brief.pdf', 'application/pdf'))
        : Promise.resolve(workspaceRecord(fileId, 'hero.png', 'image/png'))
    )
    mockFetchWorkspaceFileBuffer.mockResolvedValue(Buffer.from('file-bytes'))
    mockPrepareImageForVision.mockResolvedValue({
      buffer: Buffer.from('prepared-image'),
      mediaType: 'image/png',
      resized: false,
    })
    mockRenderPdfPagesToImages.mockResolvedValue([
      { pageNumber: 1, pageCount: 2, mimeType: 'image/png', data: 'page-one' },
      { pageNumber: 2, pageCount: 2, mimeType: 'image/jpeg', data: 'page-two' },
    ])
    mockExecuteLocalAgentModelRequest.mockResolvedValue({
      content:
        '画面中有蓝色主视觉。workspace-1 workflow-1 wf_image workspace/workspace-1/private/hero.png',
      model: 'gemini-2.5-flash',
    })
  })

  it('passes image workspace attachments to the model as image parts', async () => {
    const result = await analyzeAttachmentVision({
      context: buildContext(),
      question: '图里有什么？',
      fileName: 'hero.png',
    })

    expect(mockPrepareImageForVision).toHaveBeenCalledWith(Buffer.from('file-bytes'), 'image/png')
    expect(mockExecuteLocalAgentModelRequest).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google' }),
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({ type: 'image', mimeType: 'image/png' }),
            ]),
          }),
        ],
      })
    )
    expect(firstRequestParts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('Uploaded image "hero.png"'),
        }),
      ])
    )
    expect(result).toMatchObject({
      analyzedFileCount: 1,
      analyzedImageCount: 1,
      contexts: [expect.objectContaining({ type: 'file_vision', tag: '@hero.png' })],
    })
    expect(JSON.stringify(result.contexts)).toContain('蓝色主视觉')
    expect(JSON.stringify(result.contexts)).not.toContain('workspace-1')
    expect(JSON.stringify(result.contexts)).not.toContain('workflow-1')
    expect(JSON.stringify(result.contexts)).not.toContain('wf_image')
    expect(JSON.stringify(result.contexts)).not.toContain('workspace/workspace-1/private/hero.png')
  })

  it('renders PDF pages into multiple image parts before model analysis', async () => {
    const context = buildContext({
      attachments: [
        {
          id: 'wf_pdf',
          key: 'workspace/workspace-1/private/brief.pdf',
          name: 'brief.pdf',
          type: 'application/pdf',
          storageContext: 'workspace',
        },
      ],
    })

    const result = await analyzeAttachmentVision({
      context,
      question: '总结 PDF 页面',
      fileName: 'brief.pdf',
    })

    expect(mockRenderPdfPagesToImages).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: Buffer.from('file-bytes'),
        maxPages: 3,
      })
    )
    expect(firstRequestParts()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'text',
          text: expect.stringContaining('PDF "brief.pdf" page 1 rendered image.'),
        }),
        expect.objectContaining({ type: 'image', data: 'page-one' }),
        expect.objectContaining({ type: 'image', data: 'page-two' }),
      ])
    )
    expect(result.analyzedImageCount).toBe(2)
  })

  it('does not call the multimodal model for non-Google providers', async () => {
    const result = await analyzeAttachmentVision({
      context: buildContext({
        model: { provider: 'deepseek', model: 'deepseek-chat', mode: 'structured' },
      }),
      question: '图里有什么？',
      fileName: 'hero.png',
    })

    expect(mockGetWorkspaceFile).not.toHaveBeenCalled()
    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
    expect(result.analyzedFileCount).toBe(0)
    expect(result.contexts[0]?.content).toContain('does not support attachment visual reading')
    expect(result.limitations[0]).toContain('text/VFS fallback remains available')
  })

  it('returns a limitation when PDF rendering fails without throwing', async () => {
    mockRenderPdfPagesToImages.mockRejectedValueOnce(new Error('renderer unavailable'))
    const context = buildContext({
      attachments: [
        {
          id: 'wf_pdf',
          name: 'brief.pdf',
          type: 'application/pdf',
          storageContext: 'workspace',
        },
      ],
    })

    const result = await analyzeAttachmentVision({
      context,
      question: '总结 PDF',
      fileName: 'brief.pdf',
    })

    expect(result.contexts).toEqual([])
    expect(result.limitations).toEqual([
      'Attachment "brief.pdf" visual analysis failed; text fallback remains available.',
    ])
    expect(mockExecuteLocalAgentModelRequest).not.toHaveBeenCalled()
  })

  it('reports file and page budget limitations', async () => {
    mockRenderPdfPagesToImages.mockResolvedValueOnce([
      { pageNumber: 1, pageCount: 5, mimeType: 'image/png', data: 'page-one' },
      { pageNumber: 2, pageCount: 5, mimeType: 'image/png', data: 'page-two' },
    ])
    const context = buildContext({
      attachments: [
        {
          id: 'wf_pdf',
          name: 'brief.pdf',
          type: 'application/pdf',
          storageContext: 'workspace',
        },
        {
          id: 'wf_image',
          name: 'hero.png',
          type: 'image/png',
          storageContext: 'workspace',
        },
      ],
    })

    const result = await analyzeAttachmentVision({
      context,
      question: '读取附件',
      maxFiles: 1,
      maxPdfPages: 2,
    })

    expect(result.limitations).toEqual(
      expect.arrayContaining([
        'Only the first 1 visual attachment(s) were analyzed; 1 matching attachment(s) were skipped.',
        'PDF "brief.pdf" has 5 page(s); only the first 2 page(s) were analyzed visually.',
      ])
    )
  })
})
