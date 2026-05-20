/**
 * @vitest-environment node
 */
import {
  auditMock,
  createMockRequest,
  hybridAuthMockFns,
  permissionsMock,
  permissionsMockFns,
  workflowsApiUtilsMock,
  workflowsPersistenceUtilsMock,
  workflowsPersistenceUtilsMockFns,
} from '@sim/testing'
import { drizzleOrmMock } from '@sim/testing/mocks'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockWorkflowCreated, mockDbSelect, mockDbInsert } = vi.hoisted(() => ({
  mockWorkflowCreated: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbInsert: vi.fn(),
}))

const mockGetUserEntityPermissions = permissionsMockFns.mockGetUserEntityPermissions
const mockListAccessibleWorkspaceIds = permissionsMockFns.mockListAccessibleWorkspaceIds

vi.mock('drizzle-orm', () => ({
  ...drizzleOrmMock,
  min: vi.fn((field) => ({ type: 'min', field })),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    transaction: vi.fn(async (fn: (tx: Record<string, unknown>) => Promise<void>) => {
      const tx = {
        select: (...args: unknown[]) => mockDbSelect(...args),
        insert: (...args: unknown[]) => mockDbInsert(...args),
      }
      await fn(tx)
    }),
  },
}))

vi.mock('@sim/audit', () => auditMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/app/api/workflows/utils', () => workflowsApiUtilsMock)

vi.mock('@/lib/core/telemetry', () => ({
  PlatformEvents: {
    workflowCreated: (...args: unknown[]) => mockWorkflowCreated(...args),
  },
}))

vi.mock('@/lib/workflows/defaults', () => ({
  buildDefaultWorkflowArtifacts: vi.fn().mockReturnValue({
    workflowState: { blocks: {}, edges: [], loops: {}, parallels: {} },
    subBlockValues: {},
    startBlockId: 'start-block-id',
  }),
}))

vi.mock('@/lib/workflows/persistence/utils', () => workflowsPersistenceUtilsMock)

import { GET, POST } from '@/app/api/workflows/route'

describe('Workflows API Route - POST ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('workflow-new-id'),
    })

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      userName: 'Test User',
      userEmail: 'test@example.com',
    })
    mockGetUserEntityPermissions.mockResolvedValue('write')
    workflowsPersistenceUtilsMockFns.mockSaveWorkflowToNormalizedTables.mockResolvedValue({
      success: true,
    })
  })

  it('uses top insertion against mixed siblings (folders + workflows)', async () => {
    const minResultsQueue: Array<Array<{ minOrder: number }>> = [
      [{ minOrder: 5 }],
      [{ minOrder: 2 }],
      [],
    ]

    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => Promise.resolve(minResultsQueue.shift() ?? [])),
          then: (onFulfilled: (value: Array<{ minOrder: number }>) => unknown) =>
            Promise.resolve(minResultsQueue.shift() ?? []).then(onFulfilled),
        })),
      }),
    }))

    let insertedValues: Record<string, unknown> | null = null
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        insertedValues = values
        return Promise.resolve(undefined)
      }),
    })

    const req = createMockRequest('POST', {
      name: 'New Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
      folderId: null,
    })

    const response = await POST(req)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.sortOrder).toBe(1)
    expect(insertedValues).not.toBeNull()
    expect(insertedValues?.sortOrder).toBe(1)
  })

  it('defaults to sortOrder 0 when there are no siblings', async () => {
    const minResultsQueue: Array<Array<{ minOrder: number }>> = [[], [], []]

    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => Promise.resolve(minResultsQueue.shift() ?? [])),
          then: (onFulfilled: (value: Array<{ minOrder: number }>) => unknown) =>
            Promise.resolve(minResultsQueue.shift() ?? []).then(onFulfilled),
        })),
      }),
    }))

    let insertedValues: Record<string, unknown> | null = null
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockImplementation((values: Record<string, unknown>) => {
        insertedValues = values
        return Promise.resolve(undefined)
      }),
    })

    const req = createMockRequest('POST', {
      name: 'New Workflow',
      description: 'desc',
      color: '#3972F6',
      workspaceId: 'workspace-123',
      folderId: null,
    })

    const response = await POST(req)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.sortOrder).toBe(0)
    expect(insertedValues?.sortOrder).toBe(0)
  })
})

describe('Workflows API Route - GET access', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-123',
      userName: 'Test User',
      userEmail: 'test@example.com',
    })
  })

  it('lists workflows from owned workspaces when no explicit permission row exists', async () => {
    mockListAccessibleWorkspaceIds.mockResolvedValue(['workspace-owned'])
    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([
            {
              id: 'workflow-1',
              name: 'Owned Workflow',
              description: null,
              color: '#3972F6',
              workspaceId: 'workspace-owned',
              folderId: null,
              sortOrder: 0,
              track: 'draft',
              visibility: 'workspace',
              sourceWorkflowId: null,
              publishedAt: null,
              createdAt: new Date('2026-05-20T00:00:00Z'),
              updatedAt: new Date('2026-05-20T00:00:00Z'),
              archivedAt: null,
              locked: false,
            },
          ]),
        }),
      }),
    }))

    const response = await GET(createMockRequest('GET'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockListAccessibleWorkspaceIds).toHaveBeenCalledWith('user-123')
    expect(data.data).toHaveLength(1)
    expect(data.data[0]).toMatchObject({
      id: 'workflow-1',
      workspaceId: 'workspace-owned',
    })
  })
})
