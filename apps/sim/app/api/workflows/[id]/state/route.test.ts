/**
 * @vitest-environment node
 */
import { hybridAuthMockFns, workflowAuthzMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbTransaction } = vi.hoisted(() => ({
  mockDbTransaction: vi.fn(),
}))

const mockLoadWorkflowFromNormalizedTables = vi.hoisted(() => vi.fn())
const mockSaveWorkflowToNormalizedTables = vi.hoisted(() => vi.fn())

vi.mock('@sim/db', () => ({
  db: {
    transaction: mockDbTransaction,
  },
  workflow: {
    variables: 'variables',
    id: 'id',
  },
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mockLoadWorkflowFromNormalizedTables,
  saveWorkflowToNormalizedTables: mockSaveWorkflowToNormalizedTables,
}))

import { GET, PUT } from '@/app/api/workflows/[id]/state/route'

describe('Workflow State API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockDbTransaction.mockImplementation(async (callback) =>
      callback({
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                {
                  variables: {
                    'var-1': { id: 'var-1', name: 'secret', type: 'string', value: 'hidden' },
                  },
                },
              ]),
            }),
          }),
        }),
      })
    )
  })

  it('returns variables for workspace members', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-123', workspaceId: 'workspace-456' },
      workspacePermission: 'read',
      accessSource: 'workspace',
    })
    mockLoadWorkflowFromNormalizedTables.mockResolvedValueOnce({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/state')
    const params = Promise.resolve({ id: 'workflow-123' })

    const response = await GET(req, { params })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.variables).toEqual({
      'var-1': {
        id: 'var-1',
        name: 'secret',
        type: 'string',
        value: 'hidden',
        workflowId: 'workflow-123',
      },
    })
  })

  it('rejects workflow state reads via cross-team published access', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'viewer-123',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-123', workspaceId: 'workspace-456', track: 'published' },
      workspacePermission: 'read',
      accessSource: 'organization',
    })
    mockLoadWorkflowFromNormalizedTables.mockResolvedValueOnce({
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/state')
    const params = Promise.resolve({ id: 'workflow-123' })

    const response = await GET(req, { params })

    expect(response.status).toBe(403)
    const data = await response.json()
    expect(data.error).toBe(
      'Cross-team published workflow access does not include workflow state reads'
    )
  })

  it('rejects workflow state writes via cross-team published access', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'viewer-123',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: { id: 'workflow-123', workspaceId: 'workspace-456', track: 'published' },
      workspacePermission: 'write',
      accessSource: 'organization',
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/state', {
      method: 'PUT',
      body: JSON.stringify({
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
        variables: {},
      }),
      headers: { 'content-type': 'application/json' },
    })
    const params = Promise.resolve({ id: 'workflow-123' })

    const response = await PUT(req, { params })

    expect(response.status).toBe(403)
    const data = await response.json()
    expect(data.error).toBe(
      'Cross-team published workflow access does not include workflow state writes'
    )
    expect(mockSaveWorkflowToNormalizedTables).not.toHaveBeenCalled()
  })
})
