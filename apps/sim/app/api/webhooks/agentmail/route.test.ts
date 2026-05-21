/**
 * @vitest-environment node
 */
import { schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockDbResults = vi.hoisted(() => ({ value: [] as any[] }))
const mockFindWorkspaceUserIdByEmail = vi.hoisted(() => vi.fn())

function createSelectChain() {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).leftJoin = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).limit = vi.fn(() => Promise.resolve(mockDbResults.value.shift() || []))
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    select: vi.fn(() => createSelectChain()),
  },
  mothershipInboxAllowedSender: {
    id: 'id',
    workspaceId: 'workspaceId',
    email: 'email',
  },
  mothershipInboxTask: {},
  mothershipInboxWebhook: {},
  permissions: {
    userId: 'userId',
    entityType: 'entityType',
    entityId: 'entityId',
  },
  user: {
    id: 'id',
    email: 'email',
  },
  workspace: {
    id: 'id',
    ownerId: 'ownerId',
  },
}))

vi.mock('@sim/db/schema', () => schemaMock)
vi.mock('@trigger.dev/sdk', () => ({
  tasks: {
    trigger: vi.fn(),
  },
}))
vi.mock('svix', () => ({
  Webhook: class {
    verify() {
      return true
    }
  },
}))
vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: (handler: unknown) => handler,
}))
vi.mock('@/lib/core/config/feature-flags', () => ({
  isTriggerDevEnabled: false,
}))
vi.mock('@/lib/mothership/inbox/executor', () => ({
  executeInboxTask: vi.fn(),
}))
vi.mock('@/lib/mothership/inbox/member-resolution', () => ({
  findWorkspaceUserIdByEmail: mockFindWorkspaceUserIdByEmail,
}))

import { isSenderAllowed } from './route'

describe('isSenderAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDbResults.value = []
    mockFindWorkspaceUserIdByEmail.mockResolvedValue(null)
  })

  it('allows owner-only workspace owners without an explicit permission row', async () => {
    mockDbResults.value = [[]]
    mockFindWorkspaceUserIdByEmail.mockResolvedValue('owner-1')

    await expect(isSenderAllowed('owner@example.com', 'ws-owner')).resolves.toBe(true)
  })

  it('rejects stale personal-workspace permission rows', async () => {
    mockDbResults.value = [[]]
    mockFindWorkspaceUserIdByEmail.mockResolvedValue(null)

    await expect(isSenderAllowed('member@example.com', 'ws-owner')).resolves.toBe(false)
  })

  it('rejects senders when they are neither allowed senders, members, nor owners', async () => {
    mockDbResults.value = [[]]

    await expect(isSenderAllowed('stranger@example.com', 'ws-owner')).resolves.toBe(false)
  })
})
