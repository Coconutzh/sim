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
  permissions: {
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    userId: 'permissions.userId',
  },
  user: {
    email: 'user.email',
    id: 'user.id',
  },
  workspace: {
    archivedAt: 'workspace.archivedAt',
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
    workspaceMode: 'workspace.workspaceMode',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args) => ({ kind: 'and', args })),
  eq: vi.fn((left, right) => ({ kind: 'eq', left, right })),
  isNull: vi.fn((value) => ({ kind: 'isNull', value })),
  sql: vi.fn((strings, ...values) => ({ kind: 'sql', strings, values })),
}))

import { findWorkspaceUserIdByEmail } from '@/lib/mothership/inbox/member-resolution'

describe('findWorkspaceUserIdByEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the owner when the sender email matches the workspace owner', async () => {
    mockSelect
      .mockReturnValueOnce(createChain([{ userId: 'owner-1' }]))

    const result = await findWorkspaceUserIdByEmail('ws-1', 'owner@example.com')

    expect(result).toBe('owner-1')
  })

  it('returns a team member for organization workspaces', async () => {
    mockSelect
      .mockReturnValueOnce(createChain([]))
      .mockReturnValueOnce(
        createChain([
          {
            userId: 'member-1',
            workspaceMode: 'organization',
            workspaceOwnerId: 'owner-1',
          },
        ])
      )

    const result = await findWorkspaceUserIdByEmail('ws-1', 'member@example.com')

    expect(result).toBe('member-1')
  })

  it('ignores stale non-owner permission rows on personal workspaces', async () => {
    mockSelect
      .mockReturnValueOnce(createChain([]))
      .mockReturnValueOnce(
        createChain([
          {
            userId: 'member-1',
            workspaceMode: 'personal',
            workspaceOwnerId: 'owner-1',
          },
        ])
      )

    const result = await findWorkspaceUserIdByEmail('ws-1', 'member@example.com')

    expect(result).toBeNull()
  })
})
