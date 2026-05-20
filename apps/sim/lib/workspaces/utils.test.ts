/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
}))

function createChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).orderBy = vi.fn(() => chain)
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
  },
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  listAccessibleWorkspaceIds: vi.fn(),
}))

import { listUserWorkspaces } from './utils'
import { listAccessibleWorkspaceIds } from '@/lib/workspaces/permissions/utils'

describe('listUserWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
