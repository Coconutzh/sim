/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect, mockUpdateSet, mockUpdateWhere } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockUpdateSet: vi.fn(),
}))

function createChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  ;(chain as any).orderBy = vi.fn(() => chain)
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
    update: vi.fn(() => ({
      set: mockUpdateSet.mockReturnValue({
        where: mockUpdateWhere,
      }),
    })),
  },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  listAccessibleWorkspaceIds: vi.fn(),
}))

import { listUserWorkspaces, reassignBilledAccountForUser } from './utils'
import { listAccessibleWorkspaceIds } from '@/lib/workspaces/permissions/utils'

describe('listUserWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateWhere.mockResolvedValue(undefined)
  })

  it('includes owner-only workspaces even without a permission row', async () => {
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValueOnce(['ws-owner'])
    mockSelect.mockReturnValueOnce(
      createChain([
        {
          workspaceId: 'ws-owner',
          workspaceName: 'Owner Workspace',
          ownerId: 'user-1',
          permissionType: null,
        },
      ])
    )

    const result = await listUserWorkspaces('user-1')

    expect(result).toEqual([
      {
        workspaceId: 'ws-owner',
        workspaceName: 'Owner Workspace',
        role: 'owner',
      },
    ])
  })

  it('filters out foreign personal workspaces before querying workspace rows', async () => {
    vi.mocked(listAccessibleWorkspaceIds).mockResolvedValueOnce([])

    const result = await listUserWorkspaces('user-1')

    expect(result).toEqual([])
    expect(mockSelect).not.toHaveBeenCalled()
  })
})

describe('reassignBilledAccountForUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateWhere.mockResolvedValue(undefined)
  })

  it('reassigns to a non-owner admin for organization workspaces', async () => {
    mockSelect
      .mockReturnValueOnce(
        createChain([
          { id: 'ws-team', ownerId: 'departing-user', workspaceMode: 'organization' },
        ])
      )
      .mockReturnValueOnce(
        createChain([
          {
            userId: 'admin-1',
            workspaceMode: 'organization',
            workspaceOwnerId: 'departing-user',
          },
        ])
      )

    const result = await reassignBilledAccountForUser('departing-user')

    expect(result).toEqual({
      reassigned: [{ workspaceId: 'ws-team', newBilledAccountUserId: 'admin-1' }],
      unresolved: [],
    })
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({ billedAccountUserId: 'admin-1' })
    )
  })

  it('does not reassign personal workspaces to stale non-owner admin rows', async () => {
    mockSelect
      .mockReturnValueOnce(
        createChain([{ id: 'ws-personal', ownerId: 'departing-user', workspaceMode: 'personal' }])
      )
      .mockReturnValueOnce(
        createChain([
          {
            userId: 'admin-1',
            workspaceMode: 'personal',
            workspaceOwnerId: 'departing-user',
          },
        ])
      )

    const result = await reassignBilledAccountForUser('departing-user')

    expect(result).toEqual({
      reassigned: [],
      unresolved: ['ws-personal'],
    })
    expect(mockUpdateSet).not.toHaveBeenCalled()
  })
})
