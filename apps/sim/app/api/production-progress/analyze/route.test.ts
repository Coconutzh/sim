/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockAnalyzeProductionProgress, mockGetSession, mockProductionTaskErrorResponse } =
  vi.hoisted(() => ({
    mockAnalyzeProductionProgress: vi.fn(),
    mockGetSession: vi.fn(),
    mockProductionTaskErrorResponse: vi.fn(),
  }))

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/production-progress/analyzer', () => ({
  analyzeProductionProgress: mockAnalyzeProductionProgress,
}))

vi.mock('@/app/api/production-tasks/_utils', () => ({
  productionTaskErrorResponse: mockProductionTaskErrorResponse,
}))

import { POST } from '@/app/api/production-progress/analyze/route'

const analysis = {
  generatedAt: '2026-06-16T06:00:00.000Z',
  generatedBy: 'rules',
  answer: '整体存在 1 个超期任务，需要补交延期理由。',
  metrics: {
    projectCount: 1,
    taskCount: 2,
    completedTaskCount: 1,
    openTaskCount: 1,
    overdueTaskCount: 1,
    delayReasonMissingCount: 1,
    dueWithin24hCount: 0,
    dueWithin72hCount: 0,
    submittedAwaitingReviewCount: 0,
    changesRequestedCount: 0,
    unplannedTaskCount: 0,
  },
  projects: [
    {
      organizationId: 'org-1',
      projectName: '巡演 A',
      health: 'blocked',
      summary: '存在 1 个超期任务，其中 1 个缺少延期理由。',
      taskCount: 2,
      completedTaskCount: 1,
      overdueTaskCount: 1,
      delayReasonMissingCount: 1,
      dueWithin72hCount: 0,
      submittedAwaitingReviewCount: 0,
      changesRequestedCount: 0,
    },
  ],
  riskTasks: [],
  recommendations: ['先要求超期任务补交延期理由。'],
  focusedTask: null,
} as const

describe('/api/production-progress/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAnalyzeProductionProgress.mockResolvedValue(analysis)
    mockProductionTaskErrorResponse.mockImplementation((_logger, _message, error) =>
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Failed to analyze progress' },
        { status: 500 }
      )
    )
  })

  it('authenticates before parsing the analysis body', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await POST(createMockRequest('POST', { projects: [] }))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockAnalyzeProductionProgress).not.toHaveBeenCalled()
  })

  it('rejects invalid analysis input after authentication', async () => {
    const response = await POST(createMockRequest('POST', { projects: [] }))

    expect(response.status).toBe(400)
    expect(mockAnalyzeProductionProgress).not.toHaveBeenCalled()
  })

  it('calls the analyzer with parsed projects, question, history, and user id', async () => {
    const history = [{ role: 'assistant' as const, content: '上一轮分析：灯光任务超期。' }]
    const project = {
      organizationId: 'org-1',
      name: '巡演 A',
      teamWorkspaceId: 'ws-1',
      estimatedDueAt: null,
      status: 'active' as const,
      phases: [],
    }

    const response = await POST(
      createMockRequest('POST', {
        projects: [project],
        question: '哪些任务拖延最严重？',
        history,
        focusTaskId: 'task-1',
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ analysis })
    expect(mockAnalyzeProductionProgress).toHaveBeenCalledWith({
      userId: 'user-1',
      projects: [project],
      question: '哪些任务拖延最严重？',
      history,
      focusTaskId: 'task-1',
      signal: expect.any(AbortSignal),
    })
  })

  it('uses the shared production task error response for analyzer failures', async () => {
    const error = new Error('analysis failed')
    mockAnalyzeProductionProgress.mockRejectedValueOnce(error)

    const response = await POST(
      createMockRequest('POST', {
        projects: [{ organizationId: 'org-1', name: '巡演 A', teamWorkspaceId: 'ws-1' }],
        question: '分析风险',
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'analysis failed' })
    expect(mockProductionTaskErrorResponse).toHaveBeenCalledWith(
      expect.anything(),
      'Failed to analyze production progress',
      error
    )
  })
})
