/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockCheckSessionOrInternalAuth,
  mockCheckWorkspaceAccess,
  mockCreateTable,
  mockGetWorkspaceTableLimits,
  mockListTables,
  mockParseRequest,
} = vi.hoisted(() => ({
  mockCheckSessionOrInternalAuth: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
  mockCreateTable: vi.fn(),
  mockGetWorkspaceTableLimits: vi.fn(),
  mockListTables: vi.fn(),
  mockParseRequest: vi.fn(),
}))

vi.mock('@/lib/auth/hybrid', () => ({
  checkSessionOrInternalAuth: mockCheckSessionOrInternalAuth,
}))

vi.mock('@/lib/api/server/validation', () => ({
  isZodError: vi.fn(() => false),
  parseRequest: mockParseRequest,
  validationErrorResponse: vi.fn((error) => error),
}))

vi.mock('@/lib/core/utils/with-route-handler', () => ({
  withRouteHandler: vi.fn((handler) => handler),
}))

vi.mock('@/lib/posthog/server', () => ({
  captureServerEvent: vi.fn(),
}))

vi.mock('@/lib/table', () => ({
  createTable: mockCreateTable,
  getWorkspaceTableLimits: mockGetWorkspaceTableLimits,
  listTables: mockListTables,
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

import { GET, POST } from './route'

describe('/api/table', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
    })
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
    mockParseRequest.mockResolvedValue({
      success: true,
      data: {
        body: {
          workspaceId: 'ws-1',
          name: 'Orders',
          description: 'Table description',
          schema: {
            columns: [{ name: 'status', type: 'text' }],
          },
          initialRowCount: 0,
        },
      },
    })
    mockGetWorkspaceTableLimits.mockResolvedValue({
      maxRowsPerTable: 1000,
      maxTables: 10,
    })
    mockCreateTable.mockResolvedValue({
      id: 'table-1',
      name: 'Orders',
      description: 'Table description',
      schema: { columns: [{ name: 'status', type: 'text' }] },
      rowCount: 0,
      maxRows: 1000,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    mockListTables.mockResolvedValue([])
  })

  it('returns 404 when stale personal rows no longer grant table creation visibility', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await POST(createMockRequest('POST'))
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(mockGetWorkspaceTableLimits).not.toHaveBeenCalled()
    expect(mockCreateTable).not.toHaveBeenCalled()
  })

  it('returns 403 when the caller can read but cannot write tables', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })

    const response = await POST(createMockRequest('POST'))
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data).toEqual({ error: 'Write access required' })
    expect(mockGetWorkspaceTableLimits).not.toHaveBeenCalled()
  })

  it('returns 404 when stale personal rows no longer grant table listing visibility', async () => {
    mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const response = await GET(
      createMockRequest('GET', undefined, {}, 'http://test/api/table?workspaceId=ws-1')
    )
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(mockListTables).not.toHaveBeenCalled()
  })
})
