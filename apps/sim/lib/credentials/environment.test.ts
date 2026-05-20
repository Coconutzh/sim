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
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(result))
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: mockSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  credential: {},
  credentialMember: {},
  permissions: {
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    userId: 'permissions.userId',
  },
  workspace: {
    archivedAt: 'workspace.archivedAt',
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
    workspaceMode: 'workspace.workspaceMode',
  },
}))

vi.mock('@sim/utils/id', () => ({
  generateId: vi.fn(() => 'generated-id'),
}))

import { getUserWorkspaceIds, getWorkspaceMemberUserIds } from '@/lib/credentials/environment'

describe('credential environment membership helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('filters stale non-owner permission rows from personal workspace members', async () => {
    mockSelect
      .mockReturnValueOnce(
        createChain([{ ownerId: 'owner-1', workspaceMode: 'personal' }])
      )
      .mockReturnValueOnce(
        createChain([
          { userId: 'owner-1', workspaceMode: 'personal', workspaceOwnerId: 'owner-1' },
          { userId: 'member-1', workspaceMode: 'personal', workspaceOwnerId: 'owner-1' },
        ])
      )

    const result = await getWorkspaceMemberUserIds('ws-1')

    expect(result).toEqual(['owner-1'])
  })

  it('filters foreign personal workspaces from personal env credential scope', async () => {
    mockSelect
      .mockReturnValueOnce(
        createChain([
          {
            workspaceId: 'ws-personal-foreign',
            workspaceMode: 'personal',
            workspaceOwnerId: 'owner-1',
          },
          {
            workspaceId: 'ws-team',
            workspaceMode: 'organization',
            workspaceOwnerId: 'owner-2',
          },
        ])
      )
      .mockReturnValueOnce(createChain([{ workspaceId: 'ws-owned' }]))

    const result = await getUserWorkspaceIds('user-1')

    expect(result).toEqual(['ws-team', 'ws-owned'])
  })
})
