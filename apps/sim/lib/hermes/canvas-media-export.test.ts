/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CanvasNodeDetail,
  CanvasSnapshot,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const {
  mockDownloadFileFromStorage,
  mockDownloadFileFromUrl,
  mockLoadCanvasSnapshot,
  mockReadCanvasNodeDetail,
  mockResolveLocalAgentPermissions,
} = vi.hoisted(() => ({
  mockDownloadFileFromStorage: vi.fn(),
  mockDownloadFileFromUrl: vi.fn(),
  mockLoadCanvasSnapshot: vi.fn(),
  mockReadCanvasNodeDetail: vi.fn(),
  mockResolveLocalAgentPermissions: vi.fn(),
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-context', () => ({
  loadCanvasSnapshot: mockLoadCanvasSnapshot,
  readCanvasNodeDetail: mockReadCanvasNodeDetail,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/permissions', () => ({
  resolveLocalAgentPermissions: mockResolveLocalAgentPermissions,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mockDownloadFileFromStorage,
  downloadFileFromUrl: mockDownloadFileFromUrl,
}))

import { exportHermesCanvasNodeImage } from '@/lib/hermes/canvas-media-export'

const emptySnapshot: CanvasSnapshot = {
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  nodes: [],
  edges: [],
}

function buildImageDetail(overrides: Partial<CanvasNodeDetail> = {}): CanvasNodeDetail {
  const file = {
    name: 'hero.png',
    type: 'image/png',
    size: 1024,
    key: 'workspace/generated/hero.png',
  }
  return {
    id: 'image-1',
    name: 'Hero Image',
    blockType: 'content',
    kind: 'image',
    position: { x: 0, y: 0 },
    selected: true,
    summary: 'Generated hero visual',
    capabilities: {
      canRead: true,
      canWrite: true,
      canGenerate: true,
      canReferenceFile: true,
    },
    fields: { file },
    file,
    ...overrides,
  }
}

describe('exportHermesCanvasNodeImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveLocalAgentPermissions.mockResolvedValue({
      canRead: true,
      canWrite: false,
      canPublish: false,
    })
    mockLoadCanvasSnapshot.mockResolvedValue(emptySnapshot)
    mockReadCanvasNodeDetail.mockReturnValue(buildImageDetail())
    mockDownloadFileFromStorage.mockResolvedValue(Buffer.from('image-bytes'))
    mockDownloadFileFromUrl.mockResolvedValue(Buffer.from('url-image-bytes'))
  })

  it('exports image node bytes from a storage key', async () => {
    const result = await exportHermesCanvasNodeImage({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      nodeId: 'image-1',
    })

    expect(result).toEqual({
      buffer: Buffer.from('image-bytes'),
      nodeId: 'image-1',
      nodeTitle: 'Hero Image',
      fileName: 'hero.png',
      contentType: 'image/png',
      size: 'image-bytes'.length,
    })
    expect(mockResolveLocalAgentPermissions).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: 'workflow-1',
    })
    expect(mockReadCanvasNodeDetail).toHaveBeenCalledWith(emptySnapshot, 'image-1', [])
    expect(mockDownloadFileFromStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'hero.png',
        key: 'workspace/generated/hero.png',
        type: 'image/png',
      }),
      'hermes-canvas-media-image-1',
      expect.any(Object)
    )
    expect(mockDownloadFileFromUrl).not.toHaveBeenCalled()
  })

  it('denies export when the user lacks read permission', async () => {
    mockResolveLocalAgentPermissions.mockResolvedValueOnce({
      canRead: false,
      canWrite: false,
      canPublish: false,
      readonlyReason: 'No access',
    })

    await expect(
      exportHermesCanvasNodeImage({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        nodeId: 'image-1',
      })
    ).rejects.toMatchObject({
      code: 'USER_PERMISSION_DENIED',
      message: 'No access',
    })
    expect(mockLoadCanvasSnapshot).not.toHaveBeenCalled()
  })

  it('rejects non-image nodes', async () => {
    mockReadCanvasNodeDetail.mockReturnValueOnce(buildImageDetail({ kind: 'text' }))

    await expect(
      exportHermesCanvasNodeImage({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        nodeId: 'text-1',
      })
    ).rejects.toMatchObject({
      code: 'MEDIA_UNSUPPORTED',
    })
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
  })

  it('rejects image nodes without generated files', async () => {
    mockReadCanvasNodeDetail.mockReturnValueOnce(
      buildImageDetail({
        fields: {},
        file: null,
      })
    )

    await expect(
      exportHermesCanvasNodeImage({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        nodeId: 'image-1',
      })
    ).rejects.toMatchObject({
      code: 'MEDIA_FILE_NOT_FOUND',
    })
  })

  it('rejects ambiguous selected nodes without an explicit node id', async () => {
    await expect(
      exportHermesCanvasNodeImage({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        selectedNodeIds: ['image-1', 'image-2'],
      })
    ).rejects.toMatchObject({
      code: 'MEDIA_NODE_AMBIGUOUS',
    })
    expect(mockLoadCanvasSnapshot).not.toHaveBeenCalled()
  })
})
