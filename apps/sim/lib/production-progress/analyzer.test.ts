/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductionTask } from '@/lib/api/contracts/production-tasks'

const { MockHermesClientError, mockCallHermesChatCompletion, mockListProductionTasks } = vi.hoisted(
  () => {
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
      mockListProductionTasks: vi.fn(),
    }
  }
)

vi.mock('@/lib/hermes/client', () => ({
  HermesClientError: MockHermesClientError,
  callHermesChatCompletion: mockCallHermesChatCompletion,
}))

vi.mock('@/lib/production-tasks/service', () => ({
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
})
