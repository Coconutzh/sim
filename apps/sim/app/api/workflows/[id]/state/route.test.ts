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

  it('hides foreign personal workflow state reads behind 404', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: { id: 'workflow-hidden', workspaceId: 'workspace-hidden' },
      workspacePermission: null,
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/workflow-hidden/state')
    const params = Promise.resolve({ id: 'workflow-hidden' })

    const response = await GET(req, { params })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
    expect(mockDbTransaction).not.toHaveBeenCalled()
  })

  it('returns a sanitized workflow summary for cross-team published readers', async () => {
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
      blocks: {
        'block-1': {
          id: 'block-1',
          type: 'http',
          name: 'Fetch leads',
          position: { x: 120, y: 240 },
          subBlocks: {
            token: { id: 'token', type: 'short-input', value: 'secret-token' },
          },
          outputs: {
            body: { ok: true },
          },
          enabled: true,
        },
      },
      edges: [{ id: 'edge-1', source: 'block-1', target: 'block-2' }],
      loops: {
        'loop-1': { id: 'loop-1', nodes: ['block-1'], iterations: 3, loopType: 'for' },
      },
      parallels: {
        'parallel-1': { id: 'parallel-1', nodes: ['block-1'], count: 2, parallelType: 'count' },
      },
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/workflow-123/state')
    const params = Promise.resolve({ id: 'workflow-123' })

    const response = await GET(req, { params })

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.variables).toEqual({})
    expect(data.blocks).toEqual({
      'published-block-1': {
        id: 'published-block-1',
        type: 'http',
        name: 'Fetch leads',
        position: { x: 120, y: 240 },
        subBlocks: {},
        outputs: {},
        enabled: true,
      },
    })
    expect(data.edges).toEqual([
      { id: 'published-edge-1', source: 'published', target: 'workflow-123' },
    ])
    expect(Object.keys(data.loops)).toEqual(['published-loop-1'])
    expect(Object.keys(data.parallels)).toEqual(['published-parallel-1'])
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

  it('hides foreign personal workflow state writes behind 404', async () => {
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValueOnce({
      success: true,
      userId: 'user-123',
      authType: 'session',
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: false,
      status: 404,
      message: 'Workflow not found',
      workflow: { id: 'workflow-hidden', workspaceId: 'workspace-hidden' },
      workspacePermission: null,
    })

    const req = new NextRequest('http://localhost:3000/api/workflows/workflow-hidden/state', {
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
    const params = Promise.resolve({ id: 'workflow-hidden' })

    const response = await PUT(req, { params })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow not found' })
    expect(mockSaveWorkflowToNormalizedTables).not.toHaveBeenCalled()
  })
})
