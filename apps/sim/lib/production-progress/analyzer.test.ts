/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductionTask } from '@/lib/api/contracts/production-tasks'

const {
  MockHermesClientError,
  mockCallHermesChatCompletion,
  mockListProductionTaskMessages,
  mockListProductionTasks,
} = vi.hoisted(() => {
    class MockHermesClientError extends Error {
      constructor(
        message: string,
        public readonly status?: number
      ) {
        super(message)
        this.name = 'HermesClientError'
      }
    }

    return {
      MockHermesClientError,
      mockCallHermesChatCompletion: vi.fn(),
      mockListProductionTaskMessages: vi.fn(),
      mockListProductionTasks: vi.fn(),
    }
  })

vi.mock('@/lib/hermes/client', () => ({
  HermesClientError: MockHermesClientError,
  callHermesChatCompletion: mockCallHermesChatCompletion,
}))

vi.mock('@/lib/production-tasks/service', () => ({
  listProductionTaskMessages: mockListProductionTaskMessages,
  listProductionTasks: mockListProductionTasks,
}))

import { analyzeProductionProgress } from '@/lib/production-progress/analyzer'

function createTask(overrides: Partial<ProductionTask>): ProductionTask {
  return {
    id: 'task-1',
    organizationId: 'org-1',
    title: '灯光 Cue 表复核',
    status: 'todo',
    dueAt: '2026-06-14T06:00:00.000Z',
    delayReason: null,
    submittedAt: null,
    reviewNote: null,
    latestSubmission: null,
    messageCount: 0,
    attachments: [],
    submissionAttachments: [],
    submissions: [],
    sourceWorkgroup: { name: '导演组' },
    assigneeWorkgroup: { name: '灯光组' },
    ...overrides,
  } as ProductionTask
}

describe('analyzeProductionProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-16T06:00:00.000Z'))
    vi.clearAllMocks()
    mockCallHermesChatCompletion.mockRejectedValue(new MockHermesClientError('unconfigured', 503))
    mockListProductionTaskMessages.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flags overdue visible tasks that are missing delay reasons', async () => {
    mockListProductionTasks.mockResolvedValueOnce([
      createTask({
        id: 'task-overdue',
        title: '首幕灯光 Cue 表',
        dueAt: '2026-06-14T06:00:00.000Z',
      }),
      createTask({
        id: 'task-approved',
        title: '已审核脚本',
        status: 'approved',
        dueAt: '2026-06-15T06:00:00.000Z',
      }),
    ])

    const analysis = await analyzeProductionProgress({
      userId: 'user-1',
      projects: [{ organizationId: 'org-1', name: '巡演 A', teamWorkspaceId: 'ws-1' }],
      question: '分析异常拖延任务',
    })

    expect(mockListProductionTasks).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
      scope: 'auto',
      limit: 250,
    })
    expect(analysis.generatedBy).toBe('rules')
    expect(analysis.metrics).toMatchObject({
      taskCount: 2,
      completedTaskCount: 1,
      openTaskCount: 1,
      overdueTaskCount: 1,
      delayReasonMissingCount: 1,
    })
    expect(analysis.projects[0]).toMatchObject({
      projectName: '巡演 A',
      health: 'blocked',
      overdueTaskCount: 1,
      delayReasonMissingCount: 1,
    })
    expect(analysis.riskTasks[0]).toMatchObject({
      taskId: 'task-overdue',
      projectName: '巡演 A',
      severity: 'critical',
      daysOverdue: 2,
    })
    expect(analysis.riskTasks[0].reason).toContain('尚未提交延期理由')
    expect(analysis.answer).toContain('存在阻塞风险')
  })

  it('uses Hermes wording when the Hermes analysis call succeeds', async () => {
    mockListProductionTasks.mockResolvedValueOnce([
      createTask({
        id: 'task-submitted',
        title: '舞美参数提交',
        status: 'submitted',
        dueAt: '2026-06-17T06:00:00.000Z',
        latestSubmission: {
          submittedAt: '2026-06-16T05:00:00.000Z',
          reviewNote: null,
        },
      }),
    ])
    mockCallHermesChatCompletion.mockResolvedValueOnce({
      content: 'Hermes 判断：整体可控，但有 1 个任务等待导演审核。',
      raw: {},
    })

    const analysis = await analyzeProductionProgress({
      userId: 'user-1',
      projects: [{ organizationId: 'org-1', name: '巡演 A', teamWorkspaceId: 'ws-1' }],
      question: '现在是否正常？',
      history: [{ role: 'user', content: '上一轮有哪些风险？' }],
    })

    expect(analysis.generatedBy).toBe('hermes')
    expect(analysis.answer).toBe('Hermes 判断：整体可控，但有 1 个任务等待导演审核。')
    expect(mockCallHermesChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: 'production-progress-analysis',
        metadata: expect.objectContaining({
          source: 'sim-production-progress-analysis',
          taskCount: 1,
          projectCount: 1,
        }),
      })
    )
  })

  it('sends focused visible task submissions and messages to Hermes', async () => {
    mockListProductionTasks.mockResolvedValueOnce([
      createTask({
        id: 'task-focused',
        title: '首幕灯光 Cue 表',
        status: 'changes_requested',
        dueAt: '2026-06-17T06:00:00.000Z',
        reviewNote: '第 12 段光强需要降低。',
        submissions: [
          {
            id: 'submission-2',
            taskId: 'task-focused',
            versionNumber: 2,
            workflowId: 'workflow-1',
            nodeId: 'node-2',
            note: '第二版已补充第 12 段调整。',
            status: 'changes_requested',
            submittedBy: { id: 'user-light', name: '灯光成员', email: null, avatarUrl: null },
            submittedAt: '2026-06-16T04:00:00.000Z',
            reviewedBy: { id: 'user-director', name: '导演', email: null, avatarUrl: null },
            reviewedAt: '2026-06-16T05:00:00.000Z',
            reviewNote: '第 12 段光强需要降低。',
            adoptedBy: null,
            adoptedAt: null,
            createdAt: '2026-06-16T04:00:00.000Z',
            updatedAt: '2026-06-16T05:00:00.000Z',
            attachments: [
              {
                id: 'attachment-1',
                name: 'cue-v2.xlsx',
                url: 'https://example.test/cue-v2.xlsx',
                downloadUrl: null,
                source: 'url',
                workspaceFileId: null,
                key: null,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                size: 1200,
                createdBy: null,
                createdAt: '2026-06-16T04:00:00.000Z',
              },
            ],
          },
          {
            id: 'submission-1',
            taskId: 'task-focused',
            versionNumber: 1,
            workflowId: 'workflow-1',
            nodeId: 'node-1',
            note: '第一版 Cue 表草案。',
            status: 'submitted',
            submittedBy: { id: 'user-light', name: '灯光成员', email: null, avatarUrl: null },
            submittedAt: '2026-06-15T04:00:00.000Z',
            reviewedBy: null,
            reviewedAt: null,
            reviewNote: null,
            adoptedBy: null,
            adoptedAt: null,
            createdAt: '2026-06-15T04:00:00.000Z',
            updatedAt: '2026-06-15T04:00:00.000Z',
            attachments: [],
          },
        ],
      }),
    ])
    mockListProductionTaskMessages.mockResolvedValueOnce([
      {
        id: 'message-1',
        taskId: 'task-focused',
        senderUser: { id: 'user-light', name: '灯光成员', email: null, avatarUrl: null },
        senderAgentCode: null,
        body: '我们已经确认延期原因是场馆电力图纸晚到。',
        createdAt: '2026-06-16T03:00:00.000Z',
      },
    ])
    mockCallHermesChatCompletion.mockResolvedValueOnce({
      content: '这个任务的主要问题是第 12 段光强仍需返修，并且延期原因来自场馆电力图纸晚到。',
      raw: {},
    })

    const analysis = await analyzeProductionProgress({
      userId: 'user-1',
      projects: [{ organizationId: 'org-1', name: '巡演 A', teamWorkspaceId: 'ws-1' }],
      question: '这个任务为什么拖住了？',
      focusTaskId: 'task-focused',
    })

    expect(mockListProductionTaskMessages).toHaveBeenCalledWith({
      userId: 'user-1',
      taskId: 'task-focused',
    })
    expect(analysis.focusedTask).toMatchObject({
      taskId: 'task-focused',
      title: '首幕灯光 Cue 表',
      submissionVersionCount: 2,
      messageCount: 1,
      includedMessageCount: 1,
      messageHistoryTruncated: false,
    })
    const hermesCall = mockCallHermesChatCompletion.mock.calls[0]?.[0]
    const userPrompt = hermesCall.messages.at(-1)?.content as string
    expect(userPrompt).toContain('第二版已补充第 12 段调整')
    expect(userPrompt).toContain('第一版 Cue 表草案')
    expect(userPrompt).toContain('场馆电力图纸晚到')
  })

  it('does not load task messages when the focused task is not visible', async () => {
    mockListProductionTasks.mockResolvedValueOnce([
      createTask({
        id: 'visible-task',
        title: '可见任务',
      }),
    ])

    const analysis = await analyzeProductionProgress({
      userId: 'user-1',
      projects: [{ organizationId: 'org-1', name: '巡演 A', teamWorkspaceId: 'ws-1' }],
      question: '请分析这个任务',
      focusTaskId: 'hidden-task',
    })

    expect(mockListProductionTaskMessages).not.toHaveBeenCalled()
    expect(analysis.focusedTask).toBeNull()
    expect(analysis.answer).toContain('没有找到你指定的任务')
  })
})
