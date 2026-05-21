/**
 * @vitest-environment node
 */
import {
  authMock,
  authMockFns,
  createMockRequest,
  permissionsMock,
  permissionsMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}))

function createSelectChain<T>(result: T) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    then: (resolve: (value: T) => unknown) => resolve(result),
  }
  chain.from.mockReturnValue(chain)
  chain.where.mockReturnValue(chain)
  return chain
}

const { mockParseRequest } = vi.hoisted(() => ({
  mockParseRequest: vi.fn(async (_contract, _request, context) => ({
    success: true,
    data: {
      params: await context.params,
      body: { name: 'Copy Folder', workspaceId: 'ws-1' },
    },
  })),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    transaction: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => authMock)
vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/workflows/persistence/duplicate', () => ({
  duplicateWorkflow: vi.fn(),
}))
vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

import { POST } from '@/app/api/folders/[id]/duplicate/route'

describe('POST /api/folders/[id]/duplicate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParseRequest.mockImplementation(async (_contract, _request, context) => ({
      success: true,
      data: {
        params: await context.params,
        body: { name: 'Copy Folder', workspaceId: 'ws-1' },
      },
    }))
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1', email: 'user@example.com', name: 'User' },
    })
    mockDbSelect.mockReturnValue(
      createSelectChain([
        {
          id: 'folder-1',
          name: 'Source Folder',
          workspaceId: 'ws-1',
          color: '#6B7280',
          parentId: null,
          archivedAt: null,
        },
      ])
    )
  })

  it('authenticates before validating route params or body', async () => {
    authMockFns.mockGetSession.mockResolvedValueOnce(null)
    const unreadableParams = {
      then: () => {
        throw new Error('params should not be read')
      },
    } as unknown as Promise<{ id: string }>

    const response = await POST(createMockRequest('POST', {}), {
      params: unreadableParams,
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal rows no longer grant source-folder visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(
      createMockRequest('POST', { name: 'Copy Folder', workspaceId: 'ws-1' }),
      { params: Promise.resolve({ id: 'folder-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Source folder not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
