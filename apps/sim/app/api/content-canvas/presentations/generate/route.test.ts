/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAssertWorkflowMutable,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockCheckSessionOrInternalAuth,
  mockGeneratePresentationForCanvasNode,
} = vi.hoisted(() => ({
  mockAssertWorkflowMutable: vi.fn(),
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockGeneratePresentationForCanvasNode: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@sim/workflow-authz', () => {
  class WorkflowLockedError extends Error {
    status = 423
  }
  return {
    assertWorkflowMutable: mockAssertWorkflowMutable,
    authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
    WorkflowLockedError,
  }
})

vi.mock('@/lib/presentation/presentation-generation', () => ({
  generatePresentationForCanvasNode: mockGeneratePresentationForCanvasNode,
}))

import { POST } from '@/app/api/content-canvas/presentations/generate/route'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function buildRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/content-canvas/presentations/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-trace-id': 'trace-1' },
    body: JSON.stringify(body),
  })
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    nodeId: 'ppt-node-1',
    prompt: '根据引用节点生成科研答辩 PPT',
    slideCount: 8,
    ...overrides,
  }
}

function userFile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'file-1',
    name: 'deck.pptx',
    url: '/api/files/serve/deck.pptx?context=workspace',
    key: 'workspace/workspace-1/private/deck.pptx',
    size: 12,
    type: PPTX_MIME,
    context: 'workspace',
    ...overrides,
  }
}

describe('POST /api/content-canvas/presentations/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({ success: true, userId: 'user-1' })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      accessSource: 'workspace',
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })
    mockAssertWorkflowMutable.mockResolvedValue(undefined)
    const pptxFile = userFile()
    mockGeneratePresentationForCanvasNode.mockResolvedValue({
      answer: 'PPT generated.',
      artifact: {
        auditId: 'audit-1',
        traceId: 'trace-1',
        pptxFile,
        manifestFile: userFile({
          id: 'manifest-1',
          name: 'deck-manifest.json',
          key: 'workspace/workspace-1/private/deck-manifest.json',
          type: 'application/json',
        }),
        manifest: {
          title: 'deck',
          source: 'codex-ppt-skill',
          slideCount: 8,
          selectedStyle: '科研答辩风',
          targetNodeId: 'ppt-node-1',
          createdAt: '2026-06-17T00:00:00.000Z',
        },
      },
      hermesResult: { id: 'resp-1' },
    })
  })

  it('calls Hermes presentation generation and returns the uploaded artifact', async () => {
    const response = await POST(buildRequest(validBody()))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      success: true,
      answer: 'PPT generated.',
      nodeId: 'ppt-node-1',
      presentationStatus: 'complete',
      hermesResponseId: 'resp-1',
      presentationArtifact: {
        auditId: 'audit-1',
        pptxFile: { name: 'deck.pptx', type: PPTX_MIME },
        manifest: {
          source: 'codex-ppt-skill',
          selectedStyle: '科研答辩风',
        },
      },
      file: { name: 'deck.pptx' },
    })
    expect(mockGeneratePresentationForCanvasNode).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        nodeId: 'ppt-node-1',
        prompt: '根据引用节点生成科研答辩 PPT',
        slideCount: 8,
        traceId: 'trace-1',
      })
    )
  })

  it('rejects users without workflow write access', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      message: 'No write access',
      workflow: { id: 'workflow-1', workspaceId: 'workspace-1' },
    })

    const response = await POST(buildRequest(validBody()))
    const payload = await response.json()

    expect(response.status).toBe(403)
    expect(payload.error).toBe('No write access')
    expect(mockGeneratePresentationForCanvasNode).not.toHaveBeenCalled()
  })

  it('rejects a workflow outside the requested workspace', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      accessSource: 'workspace',
      workflow: { id: 'workflow-1', workspaceId: 'workspace-2' },
    })

    const response = await POST(buildRequest(validBody()))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toBe('Workflow does not belong to the requested workspace')
    expect(mockGeneratePresentationForCanvasNode).not.toHaveBeenCalled()
  })
})
