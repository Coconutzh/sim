/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import type { PersistedMessage } from '@/lib/copilot/chat/persisted-message'
import {
  MothershipStreamV1EventType,
  MothershipStreamV1ToolPhase,
} from '@/lib/copilot/generated/mothership-stream-v1'
import type { StreamBatchEvent } from '@/lib/copilot/request/session/types'
import {
  applyTextStreamChunk,
  buildMothershipChatAbortRequestInit,
  buildMothershipChatRequestBody,
  getReplayCompletedWorkflowToolCallIds,
  mergeChatSendOptions,
  reconcileLiveAssistantTurn,
  selectReconnectReplayState,
} from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

vi.mock('next/navigation', () => ({
  usePathname: () => '/workspace/workspace-1/home',
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}))

function userMessage(id: string): PersistedMessage {
  return {
    id,
    role: 'user',
    content: 'Question',
    timestamp: '2026-05-08T00:00:00.000Z',
  }
}

function assistantMessage(id: string, content: string): PersistedMessage {
  return {
    id,
    role: 'assistant',
    content,
    timestamp: '2026-05-08T00:00:01.000Z',
  }
}

function toolBatchEvent(
  eventId: number,
  toolCallId: string,
  toolName: string,
  phase: MothershipStreamV1ToolPhase
): StreamBatchEvent {
  return {
    eventId,
    streamId: 'stream-1',
    event: {
      v: 1,
      seq: eventId,
      ts: '2026-05-08T00:00:00.000Z',
      type: MothershipStreamV1EventType.tool,
      stream: { streamId: 'stream-1' },
      payload: {
        phase,
        toolCallId,
        toolName,
      },
    },
  } as StreamBatchEvent
}

describe('reconcileLiveAssistantTurn', () => {
  it('replaces the live assistant for the active stream owner', () => {
    const liveAssistant = assistantMessage('live-assistant:stream-1', 'updated')
    const messages = [userMessage('stream-1'), assistantMessage('live-assistant:stream-1', 'old')]

    const result = reconcileLiveAssistantTurn({
      messages,
      streamId: 'stream-1',
      liveAssistant,
      activeStreamId: 'stream-1',
    })

    expect(result).toEqual([userMessage('stream-1'), liveAssistant])
  })

  it('replaces the generated assistant after the owner while the stream is active', () => {
    const liveAssistant = assistantMessage('live-assistant:stream-1', 'live content')

    const result = reconcileLiveAssistantTurn({
      messages: [userMessage('stream-1'), assistantMessage('final-1', 'persisted content')],
      streamId: 'stream-1',
      liveAssistant,
      activeStreamId: 'stream-1',
    })

    expect(result).toEqual([userMessage('stream-1'), liveAssistant])
  })

  it('leaves a terminal persisted assistant alone when the stream is no longer active', () => {
    const messages = [userMessage('stream-1'), assistantMessage('final-1', 'persisted content')]

    const result = reconcileLiveAssistantTurn({
      messages,
      streamId: 'stream-1',
      liveAssistant: assistantMessage('live-assistant:stream-1', 'stale live content'),
      activeStreamId: null,
    })

    expect(result).toBe(messages)
  })

  it('removes stale live assistant duplicates when a terminal persisted assistant exists', () => {
    const finalAssistant = assistantMessage('final-1', 'persisted content')
    const staleLiveAssistant = assistantMessage('live-assistant:stream-1', 'stale live content')

    const result = reconcileLiveAssistantTurn({
      messages: [
        userMessage('stream-1'),
        finalAssistant,
        userMessage('next-user'),
        staleLiveAssistant,
      ],
      streamId: 'stream-1',
      liveAssistant: staleLiveAssistant,
      activeStreamId: null,
    })

    expect(result).toEqual([userMessage('stream-1'), finalAssistant, userMessage('next-user')])
  })

  it('inserts the live assistant immediately after its owner', () => {
    const nextUser = userMessage('next-user')
    const liveAssistant = assistantMessage('live-assistant:stream-1', 'live content')

    const result = reconcileLiveAssistantTurn({
      messages: [userMessage('stream-1'), nextUser],
      streamId: 'stream-1',
      liveAssistant,
      activeStreamId: 'stream-1',
    })

    expect(result).toEqual([userMessage('stream-1'), liveAssistant, nextUser])
  })
})

describe('Local Canvas Agent stop request payload', () => {
  it('builds the mothership abort request with stream id, chat id, traceparent, and timeout signal', () => {
    const abortController = new AbortController()
    const request = buildMothershipChatAbortRequestInit({
      streamId: 'stream-1',
      chatId: 'chat-1',
      traceparent: '00-trace-span-01',
      signal: abortController.signal,
    })

    expect(request.method).toBe('POST')
    expect(request.signal).toBe(abortController.signal)
    expect(request.headers).toEqual({
      'Content-Type': 'application/json',
      traceparent: '00-trace-span-01',
    })
    expect(JSON.parse(String(request.body))).toEqual({
      streamId: 'stream-1',
      chatId: 'chat-1',
    })
  })

  it('does not send an empty chat id when aborting a stream before chat resolution', () => {
    const request = buildMothershipChatAbortRequestInit({
      streamId: 'stream-1',
    })

    expect(JSON.parse(String(request.body))).toEqual({
      streamId: 'stream-1',
    })
  })
})

describe('selectReconnectReplayState', () => {
  it('hydrates nonzero cursor replay from a cached live assistant that is ahead', () => {
    const cachedBlock: ContentBlock = { type: 'text', content: 'Hello world' }

    const result = selectReconnectReplayState({
      afterCursor: '4',
      cachedLiveAssistant: {
        content: 'Hello world',
        contentBlocks: [cachedBlock],
      },
      currentContent: 'Hello',
      currentBlocks: [],
    })

    expect(result).toEqual({
      afterCursor: '4',
      content: 'Hello world',
      contentBlocks: [cachedBlock],
      preserveExistingState: true,
      source: 'cache',
    })
  })

  it('resets to replay from the beginning when a nonzero cursor has no usable live cache', () => {
    const result = selectReconnectReplayState({
      afterCursor: '4',
      cachedLiveAssistant: null,
      currentContent: '',
      currentBlocks: [],
    })

    expect(result).toEqual({
      afterCursor: '0',
      content: '',
      contentBlocks: [],
      preserveExistingState: false,
      source: 'reset',
    })
  })

  it('resets when cached live content diverges from the local prefix', () => {
    const result = selectReconnectReplayState({
      afterCursor: '4',
      cachedLiveAssistant: {
        content: 'Goodbye world',
        contentBlocks: [{ type: 'text', content: 'Goodbye world' }],
      },
      currentContent: 'Hello',
      currentBlocks: [{ type: 'text', content: 'Hello' }],
    })

    expect(result).toEqual({
      afterCursor: '0',
      content: '',
      contentBlocks: [],
      preserveExistingState: false,
      source: 'reset',
    })
  })

  it('resets current state for cursor zero replay', () => {
    const currentBlock: ContentBlock = { type: 'text', content: 'Hello' }

    const result = selectReconnectReplayState({
      afterCursor: '0',
      cachedLiveAssistant: null,
      currentContent: 'Hello',
      currentBlocks: [currentBlock],
    })

    expect(result).toEqual({
      afterCursor: '0',
      content: '',
      contentBlocks: [],
      preserveExistingState: false,
      source: 'reset',
    })
  })
})

describe('getReplayCompletedWorkflowToolCallIds', () => {
  it('suppresses only workflow tool starts that already have results in the replay batch', () => {
    const result = getReplayCompletedWorkflowToolCallIds([
      toolBatchEvent(1, 'workflow-active', 'run_workflow', MothershipStreamV1ToolPhase.call),
      toolBatchEvent(2, 'search-complete', 'tool_search', MothershipStreamV1ToolPhase.result),
      toolBatchEvent(3, 'workflow-complete', 'run_workflow', MothershipStreamV1ToolPhase.result),
    ])

    expect(result).toEqual(new Set(['workflow-complete']))
  })
})

describe('applyTextStreamChunk', () => {
  it('appends assistant text chunks for normal streaming deltas', () => {
    const result = applyTextStreamChunk({
      existingBlockContent: '当前画布',
      runningText: '当前画布',
      chunk: '包含 4 个内容节点。',
      textMode: 'append',
      needsBoundaryNewline: false,
    })

    expect(result).toEqual({
      blockContent: '当前画布包含 4 个内容节点。',
      runningText: '当前画布包含 4 个内容节点。',
    })
  })

  it('replaces assistant text with the full local-agent snapshot instead of appending or truncating', () => {
    const fullText =
      '当前画布内容节点如下：\n- Text 1（文本）：春季发布会主视觉脚本\n- Video 1（视频）：镜头推进，5 秒，1080p\n连接关系：\n- Text 1（文本） -> Video 1（视频）'

    const result = applyTextStreamChunk({
      existingBlockContent: '各位团队成员，作为总导演，我已对当前项目画布中的内容',
      runningText: '各位团队成员，作为总导演，我已对当前项目画布中的内容',
      chunk: fullText,
      textMode: 'replace',
      needsBoundaryNewline: false,
    })

    expect(result).toEqual({
      blockContent: fullText,
      runningText: fullText,
    })
    expect(result.runningText).not.toContain('作为总导演')
  })
})

describe('Local Canvas Agent chat request payload', () => {
  it('preserves fixed content-canvas send options for inline Confirm and Revise tokens', () => {
    const fixedSendOptions = {
      workflowCopilotMode: 'content_canvas_v1' as const,
      confirmationMode: 'manual' as const,
      thinkingLevel: 'extra' as const,
      autoSelectionContexts: [
        {
          kind: 'blocks' as const,
          blockIds: ['video-1'],
          label: 'Current canvas selection (1)',
        },
      ],
    }

    const merged = mergeChatSendOptions(fixedSendOptions)
    const body = buildMothershipChatRequestBody({
      message: '__local_canvas_revise__:token-1',
      workspaceId: 'workspace-1',
      userMessageId: 'user-message-1',
      createNewChat: false,
      chatId: 'chat-1',
      workflowId: 'workflow-1',
      sendOptions: merged,
      userTimezone: 'Asia/Shanghai',
    })

    expect(body).toMatchObject({
      message: '__local_canvas_revise__:token-1',
      workspaceId: 'workspace-1',
      chatId: 'chat-1',
      workflowId: 'workflow-1',
      workflowCopilotMode: 'content_canvas_v1',
      confirmationMode: 'manual',
      thinkingLevel: 'extra',
      autoSelectionContexts: [
        {
          kind: 'blocks',
          blockIds: ['video-1'],
          label: 'Current canvas selection (1)',
        },
      ],
      userTimezone: 'Asia/Shanghai',
    })
  })

  it('lets per-send options override fixed confirmation mode without dropping canvas mode', () => {
    const merged = mergeChatSendOptions(
      {
        workflowCopilotMode: 'content_canvas_v1',
        confirmationMode: 'auto',
        thinkingLevel: 'extra',
      },
      {
        confirmationMode: 'manual',
      }
    )

    expect(merged).toEqual({
      workflowCopilotMode: 'content_canvas_v1',
      confirmationMode: 'manual',
      thinkingLevel: 'extra',
    })
  })
})
