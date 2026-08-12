/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDownloadFileFromStorage,
  mockLoadWorkflowFromNormalizedTables,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockVerifyFileAccess,
} = vi.hoisted(() => ({
  mockDownloadFileFromStorage: vi.fn(),
  mockLoadWorkflowFromNormalizedTables: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockVerifyFileAccess: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mockLoadWorkflowFromNormalizedTables,
}))

vi.mock('@/app/api/files/authorization', () => ({
  verifyFileAccess: mockVerifyFileAccess,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mockDownloadFileFromStorage,
}))

import {
  exportHermesPresentationSource,
  type HermesPresentationSourceError,
} from '@/lib/hermes/presentation-source'

const PPTX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02])

function presentationBlock() {
  return {
    id: 'ppt-node-1',
    subBlocks: {
      presentationArtifact: {
        id: 'presentationArtifact',
        value: {
          pptxFile: {
            id: 'current-pptx',
            name: 'current.pptx',
            key: 'workspace/workspace-1/private/current.pptx',
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          },
          originalPptxFile: {
            id: 'original-pptx',
            name: 'original.pptx',
            key: 'workspace/workspace-1/private/original.pptx',
            type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            context: 'workspace',
          },
        },
      },
    },
  }
}

describe('exportHermesPresentationSource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      accessSource: 'workspace',
      workflow: { workspaceId: 'workspace-1' },
    })
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue({
      blocks: { 'ppt-node-1': presentationBlock() },
    })
    mockVerifyFileAccess.mockResolvedValue(true)
    mockDownloadFileFromStorage.mockResolvedValue(PPTX_BYTES)
  })

  it('returns the authorized original PPTX instead of the current artifact', async () => {
    const result = await exportHermesPresentationSource({
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      nodeId: 'ppt-node-1',
    })

    expect(result).toMatchObject({
      fileName: 'original.pptx',
      size: PPTX_BYTES.length,
    })
    expect(result.buffer).toEqual(PPTX_BYTES)
    expect(mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
      userId: 'user-1',
      workflowId: 'workflow-1',
      action: 'write',
    })
    expect(mockVerifyFileAccess).toHaveBeenCalledWith(
      'workspace/workspace-1/private/original.pptx',
      'user-1',
      undefined,
      'workspace'
    )
    expect(mockDownloadFileFromStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'original-pptx',
        key: 'workspace/workspace-1/private/original.pptx',
      }),
      'hermes-presentation-source-ppt-node-1',
      expect.anything()
    )
  })

  it('rejects users without write access before loading the artifact', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      accessSource: null,
      workflow: { workspaceId: 'workspace-1' },
      message: 'Canvas write access denied',
    })

    await expect(
      exportHermesPresentationSource({
        userId: 'user-2',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        nodeId: 'ppt-node-1',
      })
    ).rejects.toMatchObject<Partial<HermesPresentationSourceError>>({
      code: 'USER_PERMISSION_DENIED',
    })
    expect(mockLoadWorkflowFromNormalizedTables).not.toHaveBeenCalled()
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
  })

  it('rejects a workspace id that does not own the workflow', async () => {
    await expect(
      exportHermesPresentationSource({
        userId: 'user-1',
        workspaceId: 'workspace-2',
        workflowId: 'workflow-1',
        nodeId: 'ppt-node-1',
      })
    ).rejects.toMatchObject<Partial<HermesPresentationSourceError>>({
      code: 'WORKFLOW_NOT_FOUND',
    })
    expect(mockLoadWorkflowFromNormalizedTables).not.toHaveBeenCalled()
  })

  it('rejects storage references the user cannot access', async () => {
    mockVerifyFileAccess.mockResolvedValueOnce(false)

    await expect(
      exportHermesPresentationSource({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        nodeId: 'ppt-node-1',
      })
    ).rejects.toMatchObject<Partial<HermesPresentationSourceError>>({
      code: 'PRESENTATION_FILE_NOT_FOUND',
    })
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
  })

  it('rejects downloaded content that is not a PPTX ZIP package', async () => {
    mockDownloadFileFromStorage.mockResolvedValueOnce(Buffer.from('not-a-pptx'))

    await expect(
      exportHermesPresentationSource({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        nodeId: 'ppt-node-1',
      })
    ).rejects.toMatchObject<Partial<HermesPresentationSourceError>>({
      code: 'PRESENTATION_FILE_INVALID',
    })
  })
})
