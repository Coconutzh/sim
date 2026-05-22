/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  insertedBlocks,
  insertedEdges,
  mockAuthorizeWorkflowByWorkspacePermission,
  mockDbSelect,
  mockDbTransaction,
  mockGenerateId,
  mockGetSession,
  mockResolveCanvasScope,
  selectRows,
  workflowBlocksTable,
  workflowEdgesTable,
} = vi.hoisted(() => {
  const insertedBlocks: unknown[] = []
  const insertedEdges: unknown[] = []
  const selectRows: unknown[][] = []
  const workflowBlocksTable = {
    id: 'workflow_blocks.id',
    workflowId: 'workflow_blocks.workflow_id',
  }
  const workflowEdgesTable = {
    id: 'workflow_edges.id',
    workflowId: 'workflow_edges.workflow_id',
    sourceBlockId: 'workflow_edges.source_block_id',
    targetBlockId: 'workflow_edges.target_block_id',
  }

  return {
    insertedBlocks,
    insertedEdges,
    mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
    mockDbSelect: vi.fn(),
    mockDbTransaction: vi.fn(),
    mockGenerateId: vi.fn(),
    mockGetSession: vi.fn(),
    mockResolveCanvasScope: vi.fn(),
    selectRows,
    workflowBlocksTable,
    workflowEdgesTable,
  }
})

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
  resolveCanvasScope: mockResolveCanvasScope,
}))

vi.mock('@sim/db/schema', () => ({
  workflowBlocks: workflowBlocksTable,
  workflowEdges: workflowEdgesTable,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    transaction: mockDbTransaction,
  },
}))

vi.mock('drizzle-orm', () => ({
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  eq: (left: unknown, right: unknown) => ({ op: 'eq', left, right }),
  inArray: (left: unknown, values: unknown[]) => ({ op: 'inArray', left, values }),
}))

import { POST } from '@/app/api/workflows/[id]/copy-selection/route'

function createSelectChain(rows: unknown[]) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve(rows)),
    })),
  }
}

function createRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/workflows/source-workflow/copy-selection', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const sourceAccess = {
  allowed: true,
  status: 200,
  workflow: { id: 'source-workflow', workspaceId: 'personal-ws', track: 'draft' },
  workspacePermission: 'admin',
  accessSource: 'workspace',
  workspaceMode: 'personal',
  workspaceWorkgroupId: 'wg-1',
}

const targetAccess = {
  allowed: true,
  status: 200,
  workflow: { id: 'target-workflow', workspaceId: 'team-ws', track: 'draft' },
  workspacePermission: 'write',
  accessSource: 'workspace',
  workspaceMode: 'organization',
  workspaceWorkgroupId: 'wg-1',
}

describe('Copy Selection API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedBlocks.length = 0
    insertedEdges.length = 0
    selectRows.length = 0

    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorizeWorkflowByWorkspacePermission
      .mockResolvedValueOnce(sourceAccess)
      .mockResolvedValueOnce(targetAccess)
    mockResolveCanvasScope.mockImplementation((params) => {
      if (params.workflowTrack === 'published') return 'showcase'
      if (params.workspaceMode === 'personal') return 'personal'
      if (params.workspaceMode === 'organization' && params.workspaceWorkgroupId) return 'team'
      return null
    })
    mockDbSelect.mockImplementation(() => createSelectChain(selectRows.shift() ?? []))
    mockDbTransaction.mockImplementation(async (callback) =>
      callback({
        insert: (table: unknown) => ({
          values: (values: unknown[]) => {
            if (table === workflowBlocksTable) insertedBlocks.push(...values)
            if (table === workflowEdgesTable) insertedEdges.push(...values)
            return Promise.resolve()
          },
        }),
      })
    )
  })

  it('copies selected blocks and internal edges into the target canvas with sanitized data', async () => {
    selectRows.push(
      [
        {
          id: 'block-a',
          workflowId: 'source-workflow',
          type: 'api',
          name: 'API Block',
          positionX: '10',
          positionY: '20',
          enabled: true,
          horizontalHandles: true,
          isWide: false,
          advancedMode: false,
          triggerMode: false,
          locked: true,
          height: '240',
          subBlocks: { credentialId: 'credential-1', prompt: 'public' },
          outputs: { response: 'ok', debugLog: 'hidden' },
          data: {
            imageFile: {
              id: 'file-1',
              name: 'draft.png',
              url: 'https://files.example/private',
              size: 42,
              type: 'image/png',
              key: 'private/file-1',
            },
            profile: { label: 'keep this non-file field' },
          },
        },
        {
          id: 'block-b',
          workflowId: 'source-workflow',
          type: 'function',
          name: 'Function Block',
          positionX: '30',
          positionY: '40',
          enabled: true,
          horizontalHandles: false,
          isWide: true,
          advancedMode: true,
          triggerMode: false,
          locked: false,
          height: '120',
          subBlocks: {},
          outputs: {},
          data: {},
        },
      ],
      [
        {
          id: 'edge-internal',
          workflowId: 'source-workflow',
          sourceBlockId: 'block-a',
          targetBlockId: 'block-b',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
        {
          id: 'edge-external',
          workflowId: 'source-workflow',
          sourceBlockId: 'block-a',
          targetBlockId: 'block-c',
          sourceHandle: 'source',
          targetHandle: 'target',
        },
      ]
    )
    mockGenerateId
      .mockReturnValueOnce('new-block-a')
      .mockReturnValueOnce('new-block-b')
      .mockReturnValueOnce('new-edge-internal')

    const response = await POST(
      createRequest({
        source: { type: 'personal', workflowId: 'source-workflow' },
        target: { type: 'team', workspaceId: 'team-ws', workflowId: 'target-workflow' },
        selection: { blockIds: ['block-a', 'block-a', 'block-b'], edgeIds: [] },
        placement: { offsetX: 120, offsetY: -20 },
      }),
      { params: Promise.resolve({ id: 'source-workflow' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      inserted: { blockIds: ['new-block-a', 'new-block-b'], edgeIds: ['new-edge-internal'] },
      mappings: {
        blockIds: { 'block-a': 'new-block-a', 'block-b': 'new-block-b' },
        edgeIds: { 'edge-internal': 'new-edge-internal' },
      },
    })
    expect(insertedBlocks).toMatchObject([
      {
        id: 'new-block-a',
        workflowId: 'target-workflow',
        positionX: '130',
        positionY: '0',
        locked: false,
        subBlocks: { credentialId: { type: 'credential', label: '已配置凭证' }, prompt: 'public' },
        outputs: { response: 'ok' },
        data: {
          imageFile: { type: 'file', label: '已隐藏文件' },
          profile: { label: 'keep this non-file field' },
        },
      },
      { id: 'new-block-b', workflowId: 'target-workflow', positionX: '150', positionY: '20' },
    ])
    expect(insertedEdges).toMatchObject([
      {
        id: 'new-edge-internal',
        workflowId: 'target-workflow',
        sourceBlockId: 'new-block-a',
        targetBlockId: 'new-block-b',
      },
    ])
  })

  it('denies copying when source read or target write access fails', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockReset()
    mockAuthorizeWorkflowByWorkspacePermission
      .mockResolvedValueOnce({ ...sourceAccess, allowed: false, status: 404 })
      .mockResolvedValueOnce(targetAccess)

    const response = await POST(
      createRequest({
        source: { type: 'personal', workflowId: 'source-workflow' },
        target: { type: 'team', workspaceId: 'team-ws', workflowId: 'target-workflow' },
        selection: { blockIds: ['block-a'], edgeIds: [] },
      }),
      { params: Promise.resolve({ id: 'source-workflow' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Copy selection access denied' })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('rejects client-supplied canvas types that do not match the authorized workflows', async () => {
    const response = await POST(
      createRequest({
        source: { type: 'team', workflowId: 'source-workflow' },
        target: { type: 'team', workspaceId: 'team-ws', workflowId: 'target-workflow' },
        selection: { blockIds: ['block-a'], edgeIds: [] },
      }),
      { params: Promise.resolve({ id: 'source-workflow' }) }
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Copy selection canvas type mismatch',
    })
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('requires the source workflow body field to match the route workflow id', async () => {
    const response = await POST(
      createRequest({
        source: { type: 'personal', workflowId: 'other-source' },
        target: { type: 'team', workspaceId: 'team-ws', workflowId: 'target-workflow' },
        selection: { blockIds: ['block-a'], edgeIds: [] },
      }),
      { params: Promise.resolve({ id: 'source-workflow' }) }
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Source workflow mismatch' })
    expect(mockAuthorizeWorkflowByWorkspacePermission).not.toHaveBeenCalled()
  })

  it('still authorizes source and target before returning an empty selection response', async () => {
    const response = await POST(
      createRequest({
        source: { type: 'personal', workflowId: 'source-workflow' },
        target: { type: 'team', workspaceId: 'team-ws', workflowId: 'target-workflow' },
        selection: { blockIds: [], edgeIds: [] },
      }),
      { params: Promise.resolve({ id: 'source-workflow' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      inserted: { blockIds: [], edgeIds: [] },
      mappings: { blockIds: {}, edgeIds: {} },
    })
    expect(mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledTimes(2)
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
