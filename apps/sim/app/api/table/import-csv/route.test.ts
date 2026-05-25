/**
 * @vitest-environment node
 */
import { hybridAuthMockFns, permissionsMock, permissionsMockFns } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockParseCsvBuffer,
  mockInferSchemaFromCsv,
  mockGetWorkspaceTableLimits,
  mockCreateTable,
  mockBatchInsertRows,
} = vi.hoisted(() => ({
  mockParseCsvBuffer: vi.fn(),
  mockInferSchemaFromCsv: vi.fn(),
  mockGetWorkspaceTableLimits: vi.fn(),
  mockCreateTable: vi.fn(),
  mockBatchInsertRows: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)
vi.mock('@/lib/table', () => ({
  batchInsertRows: mockBatchInsertRows,
  CSV_MAX_BATCH_SIZE: 500,
  coerceRowsForTable: vi.fn(() => [{ name: 'Alice' }]),
  createTable: mockCreateTable,
  deleteTable: vi.fn(),
  getWorkspaceTableLimits: mockGetWorkspaceTableLimits,
  inferSchemaFromCsv: mockInferSchemaFromCsv,
  parseCsvBuffer: mockParseCsvBuffer,
  sanitizeName: vi.fn((name: string) => name),
  TABLE_LIMITS: { MAX_TABLE_NAME_LENGTH: 100 },
}))
vi.mock('@/app/api/table/utils', () => ({
  normalizeColumn: vi.fn((column: unknown) => column),
}))

import { POST } from '@/app/api/table/import-csv/route'

describe('POST /api/table/import-csv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hybridAuthMockFns.mockCheckSessionOrInternalAuth.mockResolvedValue({
      success: true,
      userId: 'user-1',
      userName: 'User',
      userEmail: 'user@example.com',
    })
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: 'ws-1', ownerId: 'user-1', workspaceMode: 'organization' },
    })
    permissionsMockFns.mockGetUserEntityPermissions.mockResolvedValue('write')
    mockParseCsvBuffer.mockResolvedValue({
      headers: ['name'],
      rows: [['Alice']],
    })
    mockInferSchemaFromCsv.mockReturnValue({
      columns: [{ name: 'name', type: 'text' }],
      headerToColumn: new Map([['name', 'name']]),
    })
    mockGetWorkspaceTableLimits.mockResolvedValue({
      maxRowsPerTable: 1000,
      maxTables: 100,
    })
    mockCreateTable.mockResolvedValue({
      id: 'table-1',
      name: 'contacts',
      description: 'Imported from contacts.csv',
    })
    mockBatchInsertRows.mockResolvedValue([{ id: 'row-1' }])
  })

  it('imports csv files for accessible workspaces', async () => {
    const formData = new FormData()
    formData.append('workspaceId', 'ws-1')
    formData.append('file', new File(['name\nAlice\n'], 'contacts.csv', { type: 'text/csv' }))

    const request = new NextRequest('http://localhost/api/table/import-csv', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(permissionsMockFns.mockCheckWorkspaceAccess).toHaveBeenCalledWith('ws-1', 'user-1')
  })

  it('returns 404 when stale personal rows no longer grant csv-import visibility', async () => {
    permissionsMockFns.mockCheckWorkspaceAccess.mockResolvedValueOnce({
      exists: true,
      hasAccess: false,
      canWrite: false,
      workspace: { id: 'ws-1', ownerId: 'owner-2', workspaceMode: 'personal' },
    })

    const formData = new FormData()
    formData.append('workspaceId', 'ws-1')
    formData.append('file', new File(['name\nAlice\n'], 'contacts.csv', { type: 'text/csv' }))

    const request = new NextRequest('http://localhost/api/table/import-csv', {
      method: 'POST',
      body: formData,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data).toEqual({ error: 'Canvas not found' })
    expect(permissionsMockFns.mockGetUserEntityPermissions).not.toHaveBeenCalled()
  })
})
