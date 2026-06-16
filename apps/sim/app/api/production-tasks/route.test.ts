/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockProductionTaskServiceError,
  mockCreateProductionTask,
  mockGetSession,
  mockListProductionTasks,
  mockReviewProductionTask,
  mockScanProductionTaskReminders,
  mockSubmitProductionTask,
  mockUpdateProductionTask,
  mockVerifyCronAuth,
} = vi.hoisted(() => {
  class MockProductionTaskServiceError extends Error {
    constructor(
      message: string,
      public readonly status: number
    ) {
      super(message)
      this.name = 'ProductionTaskServiceError'
    }
  }

  return {
    MockProductionTaskServiceError,
    mockCreateProductionTask: vi.fn(),
    mockGetSession: vi.fn(),
    mockListProductionTasks: vi.fn(),
    mockReviewProductionTask: vi.fn(),
    mockScanProductionTaskReminders: vi.fn(),
    mockSubmitProductionTask: vi.fn(),
    mockUpdateProductionTask: vi.fn(),
    mockVerifyCronAuth: vi.fn(),
  }
})

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/production-tasks/service', () => ({
  ProductionTaskServiceError: MockProductionTaskServiceError,
  createProductionTask: mockCreateProductionTask,
  listProductionTasks: mockListProductionTasks,
  reviewProductionTask: mockReviewProductionTask,
  scanProductionTaskReminders: mockScanProductionTaskReminders,
  submitProductionTask: mockSubmitProductionTask,
  updateProductionTask: mockUpdateProductionTask,
}))

vi.mock('@/lib/auth/internal', () => ({
  verifyCronAuth: mockVerifyCronAuth,
}))

import { PATCH as REVIEW } from './[taskId]/review/route'
import { PATCH as UPDATE } from './[taskId]/route'
import { POST as SUBMIT } from './[taskId]/submit/route'
import { GET as SCAN_REMINDERS } from './reminders/scan/route'
import { POST as CREATE, GET } from './route'

describe('production task routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockListProductionTasks.mockResolvedValue([{ id: 'task-1' }])
    mockCreateProductionTask.mockResolvedValue({ id: 'task-1' })
    mockSubmitProductionTask.mockResolvedValue({
      id: 'task-1',
      status: 'submitted',
    })
    mockUpdateProductionTask.mockResolvedValue({
      id: 'task-1',
      delayReason: 'Need one more render pass',
    })
    mockReviewProductionTask.mockResolvedValue({
      id: 'task-1',
      status: 'approved',
    })
    mockScanProductionTaskReminders.mockResolvedValue({
      scannedAt: '2026-06-04T06:00:00.000Z',
      remindedCount: 1,
      taskIds: ['task-1'],
    })
    mockVerifyCronAuth.mockReturnValue(null)
  })

  it('authenticates before parsing list query params', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/production-tasks?workspaceId='
      )
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockListProductionTasks).not.toHaveBeenCalled()
  })

  it('lists production tasks through the service with parsed filters', async () => {
    const response = await GET(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/production-tasks?workspaceId=ws-1&workflowId=wf-1&scope=auto&status=todo&limit=20'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      tasks: [{ id: 'task-1' }],
    })
    expect(mockListProductionTasks).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      scope: 'auto',
      status: 'todo',
      limit: 20,
    })
  })

  it('creates a production task through the service', async () => {
    const dueAt = '2026-06-05T10:30:00.000Z'
    const response = await CREATE(
      createMockRequest('POST', {
        workspaceId: 'ws-1',
        sourceWorkflowId: 'wf-1',
        assigneeWorkgroupId: 'wg-lighting',
        title: '检查灯光 Cue',
        description: '整理第一幕灯光切点',
        dueAt,
        dependencyTaskIds: ['task-parent'],
        attachments: [{ name: 'cue 表', url: 'https://example.com/cue' }],
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ task: { id: 'task-1' } })
    expect(mockCreateProductionTask).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
      sourceWorkflowId: 'wf-1',
      assigneeWorkgroupId: 'wg-lighting',
      title: '检查灯光 Cue',
      description: '整理第一幕灯光切点',
      dueAt,
      dependencyTaskIds: ['task-parent'],
      attachments: [{ source: 'url', name: 'cue 表', url: 'https://example.com/cue' }],
    })
  })

  it('creates a production task with uploaded workspace file attachments', async () => {
    const response = await CREATE(
      createMockRequest('POST', {
        workspaceId: 'ws-1',
        assigneeWorkgroupId: 'wg-lighting',
        title: '整理舞美参考',
        attachments: [
          {
            source: 'workspace_file',
            name: '舞美参考.pdf',
            workspaceFileId: 'file-1',
            url: '/api/files/serve/workspace/file-1',
            key: 'workspace/ws-1/file-1.pdf',
            contentType: 'application/pdf',
            size: 2048,
          },
        ],
      })
    )

    expect(response.status).toBe(200)
    expect(mockCreateProductionTask).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
      sourceWorkflowId: undefined,
      assigneeWorkgroupId: 'wg-lighting',
      title: '整理舞美参考',
      description: undefined,
      dueAt: undefined,
      dependencyTaskIds: undefined,
      attachments: [
        {
          source: 'workspace_file',
          name: '舞美参考.pdf',
          workspaceFileId: 'file-1',
          url: '/api/files/serve/workspace/file-1',
          key: 'workspace/ws-1/file-1.pdf',
          contentType: 'application/pdf',
          size: 2048,
        },
      ],
    })
  })

  it('rejects uploaded attachment payloads without a workspace file id', async () => {
    const response = await CREATE(
      createMockRequest('POST', {
        workspaceId: 'ws-1',
        assigneeWorkgroupId: 'wg-lighting',
        title: '整理舞美参考',
        attachments: [{ source: 'workspace_file', name: '舞美参考.pdf' }],
      })
    )

    expect(response.status).toBe(400)
    expect(mockCreateProductionTask).not.toHaveBeenCalled()
  })

  it('submits a selected workflow node for review', async () => {
    const response = await SUBMIT(
      createMockRequest('POST', {
        workspaceId: 'ws-1',
        workflowId: 'wf-1',
        nodeId: 'node-1',
      }),
      { params: Promise.resolve({ taskId: 'task-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      task: { id: 'task-1', status: 'submitted' },
    })
    expect(mockSubmitProductionTask).toHaveBeenCalledWith({
      userId: 'user-1',
      taskId: 'task-1',
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      nodeId: 'node-1',
      submissionNote: undefined,
      attachments: undefined,
    })
  })

  it('submits text and uploaded files for review without a workflow node', async () => {
    const response = await SUBMIT(
      createMockRequest('POST', {
        workspaceId: 'ws-1',
        submissionNote: '已完成第一版灯光视频，请审核。',
        attachments: [
          {
            source: 'workspace_file',
            name: '灯光预览.mp4',
            workspaceFileId: 'file-1',
            url: '/api/files/serve/workspace/file-1',
            key: 'workspace/ws-1/file-1.mp4',
            contentType: 'video/mp4',
            size: 4096,
          },
        ],
      }),
      { params: Promise.resolve({ taskId: 'task-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      task: { id: 'task-1', status: 'submitted' },
    })
    expect(mockSubmitProductionTask).toHaveBeenCalledWith({
      userId: 'user-1',
      taskId: 'task-1',
      workspaceId: 'ws-1',
      workflowId: undefined,
      nodeId: undefined,
      submissionNote: '已完成第一版灯光视频，请审核。',
      attachments: [
        {
          source: 'workspace_file',
          name: '灯光预览.mp4',
          workspaceFileId: 'file-1',
          url: '/api/files/serve/workspace/file-1',
          key: 'workspace/ws-1/file-1.mp4',
          contentType: 'video/mp4',
          size: 4096,
        },
      ],
    })
  })

  it('rejects empty production task submissions', async () => {
    const response = await SUBMIT(
      createMockRequest('POST', {
        workspaceId: 'ws-1',
      }),
      { params: Promise.resolve({ taskId: 'task-1' }) }
    )

    expect(response.status).toBe(400)
    expect(mockSubmitProductionTask).not.toHaveBeenCalled()
  })

  it('reviews a submitted production task', async () => {
    const response = await REVIEW(
      createMockRequest('PATCH', {
        action: 'approve',
        reviewNote: '通过，进入联排。',
      }),
      { params: Promise.resolve({ taskId: 'task-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      task: { id: 'task-1', status: 'approved' },
    })
    expect(mockReviewProductionTask).toHaveBeenCalledWith({
      userId: 'user-1',
      taskId: 'task-1',
      action: 'approve',
      reviewNote: '通过，进入联排。',
    })
  })

  it('updates an overdue task delay reason', async () => {
    const response = await UPDATE(
      createMockRequest('PATCH', {
        delayReason: 'Need one more render pass',
      }),
      { params: Promise.resolve({ taskId: 'task-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      task: { id: 'task-1', delayReason: 'Need one more render pass' },
    })
    expect(mockUpdateProductionTask).toHaveBeenCalledWith({
      userId: 'user-1',
      taskId: 'task-1',
      title: undefined,
      description: undefined,
      dueAt: undefined,
      assigneeWorkgroupId: undefined,
      status: undefined,
      dependencyTaskIds: undefined,
      attachments: undefined,
      delayReason: 'Need one more render pass',
    })
  })

  it('runs the DDL reminder scan through cron auth', async () => {
    const response = await SCAN_REMINDERS(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/production-tasks/reminders/scan'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      scannedAt: '2026-06-04T06:00:00.000Z',
      remindedCount: 1,
      taskIds: ['task-1'],
    })
    expect(mockVerifyCronAuth).toHaveBeenCalledWith(
      expect.anything(),
      'Production task DDL reminders'
    )
    expect(mockScanProductionTaskReminders).toHaveBeenCalledWith()
  })

  it('rejects DDL reminder scans without cron auth', async () => {
    mockVerifyCronAuth.mockReturnValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const response = await SCAN_REMINDERS(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/production-tasks/reminders/scan'
      )
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockScanProductionTaskReminders).not.toHaveBeenCalled()
  })
})
