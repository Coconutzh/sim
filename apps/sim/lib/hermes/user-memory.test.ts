/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  extractHermesUserMemoryCandidates,
  formatHermesUserMemoryContext,
} from '@/lib/hermes/user-memory'

describe('Hermes user memory extraction', () => {
  it('extracts explicit stable user preferences', () => {
    const candidates = extractHermesUserMemoryCandidates({
      userContent: '以后我做短视频脚本时，先给我三版 hook，再给分镜。',
      assistantContent: '好的。',
    })

    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      category: 'workflow_habit',
      content: '以后我做短视频脚本时，先给我三版 hook，再给分镜。',
    })
  })

  it('does not extract secret-like content', () => {
    const candidates = extractHermesUserMemoryCandidates({
      userContent: '请记住我的 API key 是 sk-1234567890abcdef',
    })

    expect(candidates).toEqual([])
  })

  it('does not extract current canvas task state', () => {
    const candidates = extractHermesUserMemoryCandidates({
      userContent: '记住当前画布这个节点已经生成过视频了，下一步继续用 pendingActionId。',
    })

    expect(candidates).toEqual([])
  })

  it('formats context without exposing raw storage metadata', () => {
    const context = formatHermesUserMemoryContext([
      {
        id: 'memory-1',
        userId: 'user-1',
        organizationId: 'org-1',
        workspaceId: null,
        category: 'communication_style',
        content: '用户偏好先结论后风险。',
        source: 'hermes',
        sourceHermesRunId: null,
        sourceTraceId: null,
        evidenceRefs: ['chat:1'],
        metadata: { sourceWorkspaceId: 'workspace-1' },
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
        lastSeenAt: '2026-06-13T00:00:00.000Z',
      },
    ])

    expect(context).toBe('SIM user memory:\n- [communication_style] 用户偏好先结论后风险。')
    expect(context).not.toContain('workspace-1')
  })
})
