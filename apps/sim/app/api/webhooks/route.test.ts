/**
 * @vitest-environment node
 */
import { permissionsMock, permissionsMockFns, workflowAuthzMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetSession, mockDbSelect, mockParseRequest } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockDbSelect: vi.fn(),
  mockParseRequest: vi.fn(),
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
vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission:
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission,
}))
vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
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
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      accessSource: 'workspace',
      workflow: { id: 'wf-1', workspaceId: 'ws-owner' },
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        query: {},
      },
    })
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

  it('hides workflow block webhooks from published workflow readers', async () => {
    mockDbSelect.mockReturnValueOnce({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi
            .fn()
            .mockResolvedValue([{ id: 'wf-1', userId: 'owner-1', workspaceId: 'ws-owner' }]),
        })),
      })),
    })
    mockParseRequest.mockResolvedValueOnce({
      success: true,
      data: {
        query: { workflowId: 'wf-1', blockId: 'block-1' },
      },
    })
    workflowAuthzMockFns.mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      accessSource: 'published',
      workflow: { id: 'wf-1', workspaceId: 'ws-owner' },
    })

    const response = await GET(
      new Request('http://localhost:3000/api/webhooks?workflowId=wf-1&blockId=block-1') as any
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ webhooks: [] })
  })
})
