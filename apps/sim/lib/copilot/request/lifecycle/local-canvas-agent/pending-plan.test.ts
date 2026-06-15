/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  consumeLocalAgentPreviewPlan,
  deleteLocalAgentPreviewPlan,
  LOCAL_CANVAS_PREVIEW_CONFIRM_PREFIX,
  LOCAL_CANVAS_PREVIEW_DISCARD_PREFIX,
  parseLocalAgentPendingPlanCommand,
  putLocalAgentPreviewPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/pending-plan'
import type {
  LocalAgentContext,
  LocalAgentPlan,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function createContext(chatId: string): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    chatId,
  } as unknown as LocalAgentContext
}

function createPlan(goal: string): LocalAgentPlan {
  return {
    goal,
    risk: 'medium',
    requiresClarification: false,
    steps: [],
    successCriteria: ['done'],
  }
}

describe('local canvas preview plans', () => {
  it('keeps the latest preview when an old preview id is consumed', () => {
    const context = createContext('preview-chat-1')
    const first = putLocalAgentPreviewPlan({ context, plan: createPlan('first') })
    const second = putLocalAgentPreviewPlan({ context, plan: createPlan('second') })

    expect(
      consumeLocalAgentPreviewPlan({
        context,
        previewActionId: first.id,
      })
    ).toEqual({ status: 'id_mismatch' })
    expect(
      consumeLocalAgentPreviewPlan({
        context,
        previewActionId: second.id,
      })
    ).toEqual({
      status: 'found',
      pending: second,
    })
  })

  it('supports explicitly discarding a preview plan', () => {
    const context = createContext('preview-chat-2')
    const preview = putLocalAgentPreviewPlan({ context, plan: createPlan('discard me') })

    deleteLocalAgentPreviewPlan(context)

    expect(
      consumeLocalAgentPreviewPlan({
        context,
        previewActionId: preview.id,
      })
    ).toEqual({ status: 'not_found' })
  })

  it('parses preview confirmation and discard commands', () => {
    expect(parseLocalAgentPendingPlanCommand(`${LOCAL_CANVAS_PREVIEW_CONFIRM_PREFIX}preview-1`))
      .toEqual({
        action: 'preview_confirm',
        id: 'preview-1',
      })
    expect(parseLocalAgentPendingPlanCommand(`${LOCAL_CANVAS_PREVIEW_DISCARD_PREFIX}preview-2`))
      .toEqual({
        action: 'preview_discard',
        id: 'preview-2',
      })
  })
})
