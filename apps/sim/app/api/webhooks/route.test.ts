/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockDbSelect } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbSelect: vi.fn(),
}))

function createChain<T>(result: T) {
  const chain: Record<string, unknown> = {}
  ;(chain as any).from = vi.fn(() => chain)
  ;(chain as any).innerJoin = vi.fn(() => chain)
  ;(chain as any).where = vi.fn(() => chain)
  ;(chain as any).then = (resolve: (value: T) => unknown) => resolve(result)
  return chain
}

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/api/server', () => ({
  parseRequest: vi.fn(async () => ({
    success: true,
    data: {
      query: {},
    },
  })),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

import { GET } from './route'

describe('GET /api/webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'owner-1' } })
    permissionsMockFns.mockListAccessibleWorkspaceIds.mockResolvedValue(['ws-owner'])
  })

  it('includes owner-only workspace webhooks without requiring a permission row', async () => {
    mockDbSelect.mockReturnValueOnce(
      createChain([
        {
          webhook: {
            id: 'wh-1',
            workflowId: 'wf-1',
            blockId: 'block-1',
          },
          workflow: {
            id: 'wf-1',
            name: 'Owner Flow',
          },
        },
      ])
    )

    const response = await GET(new Request('http://localhost:3000/api/webhooks') as any)

    expect(response.status).toBe(200)
    expect(permissionsMockFns.mockListAccessibleWorkspaceIds).toHaveBeenCalledWith('owner-1')
    await expect(response.json()).resolves.toMatchObject({
      webhooks: [
        {
          webhook: {
            id: 'wh-1',
            workflowId: 'wf-1',
          },
          workflow: {
            id: 'wf-1',
            name: 'Owner Flow',
          },
        },
      ],
    })
  })
})
