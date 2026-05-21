/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockParseRequest,
  mockValidateWorkflowPermissions,
  mockDbSelect,
  mockDbFrom,
  mockDbLeftJoin,
  mockDbWhere,
  mockDbOrderBy,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockParseRequest: vi.fn(async (_contract, _request, context) => ({
    success: true,
    data: { params: await context.params },
  })),
  mockValidateWorkflowPermissions: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbFrom: vi.fn(),
  mockDbLeftJoin: vi.fn(),
  mockDbWhere: vi.fn(),
  mockDbOrderBy: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/api/server', () => ({
  parseRequest: mockParseRequest,
}))

vi.mock('@/lib/workflows/utils', () => ({
  validateWorkflowPermissions: mockValidateWorkflowPermissions,
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
  user: {
    id: 'user.id',
    name: 'user.name',
  },
  workflowDeploymentVersion: {
    id: 'deployment.id',
    version: 'deployment.version',
    name: 'deployment.name',
    description: 'deployment.description',
    isActive: 'deployment.isActive',
    createdAt: 'deployment.createdAt',
    createdBy: 'deployment.createdBy',
    workflowId: 'deployment.workflowId',
  },
}))

vi.mock('drizzle-orm', () => ({
  desc: vi.fn((field: unknown) => ({ type: 'desc', field })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: 'eq', left, right })),
}))

import { GET } from '@/app/api/workflows/[id]/deployments/route'

describe('GET /api/workflows/[id]/deployments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockParseRequest.mockImplementation(async (_contract, _request, context) => ({
      success: true,
      data: { params: await context.params },
    }))
    mockValidateWorkflowPermissions.mockResolvedValue({ error: null })
    mockDbSelect.mockReturnValue({ from: mockDbFrom })
    mockDbFrom.mockReturnValue({ leftJoin: mockDbLeftJoin })
    mockDbLeftJoin.mockReturnValue({ where: mockDbWhere })
    mockDbWhere.mockReturnValue({ orderBy: mockDbOrderBy })
    mockDbOrderBy.mockResolvedValue([])
  })

  it('authenticates before validating route params', async () => {
    mockGetSession.mockResolvedValueOnce(null)
    const unreadableParams = {
      then: () => {
        throw new Error('params should not be read')
      },
    } as unknown as Promise<{ id: string }>

    const response = await GET(new NextRequest('http://localhost/api/workflows/wf-1/deployments'), {
      params: unreadableParams,
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ error: 'Unauthorized' })
    expect(mockParseRequest).not.toHaveBeenCalled()
    expect(mockValidateWorkflowPermissions).not.toHaveBeenCalled()
  })

  it('lists deployment versions after access validation', async () => {
    mockDbOrderBy.mockResolvedValueOnce([
      {
        id: 'dep-1',
        version: 1,
        name: 'Production',
        description: null,
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'admin-api',
        deployedBy: null,
      },
    ])

    const response = await GET(new NextRequest('http://localhost/api/workflows/wf-1/deployments'), {
      params: Promise.resolve({ id: 'wf-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      versions: [
        {
          id: 'dep-1',
          version: 1,
          name: 'Production',
          description: null,
          isActive: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: 'admin-api',
          deployedBy: 'Admin',
        },
      ],
    })
    expect(mockValidateWorkflowPermissions).toHaveBeenCalledWith('wf-1', expect.any(String), 'read')
  })
})
