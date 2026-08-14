// @vitest-environment jsdom

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatSendOptions } from '@/app/workspace/[workspaceId]/home/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { mockRefreshWorkflowState, mockUseChat, mockRequestJson } = vi.hoisted(() => ({
  mockRefreshWorkflowState: vi.fn(),
  mockUseChat: vi.fn(),
  mockRequestJson: vi.fn(),
}))

let mockIsSending = false

let capturedUseChatOptions:
  | {
      onToolResult?: (toolName: string, success: boolean, output: unknown) => void
      onStreamEnd?: (chatId: string) => void
      onTitleUpdate?: () => void
      fixedSendOptions?: ChatSendOptions
    }
  | undefined

vi.mock('posthog-js/react', () => ({
  usePostHog: () => ({ capture: vi.fn() }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
}))

vi.mock('@/components/emcn', () => ({
  Button: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverItem: ({ children, ...props }: React.ComponentProps<'button'>) => (
    <button type='button' {...props}>
      {children}
    </button>
  ),
  PopoverScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}))

vi.mock('@/lib/copilot/skill-action-registry', () => ({
  getCopilotSkillActionCards: () => [],
}))

vi.mock('@/lib/posthog/client', () => ({
  captureEvent: vi.fn(),
}))

vi.mock('@/lib/product/content-node-presets', () => ({
  getContentNodePreset: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/components', () => ({
  ConversationListItem: () => <div data-testid='conversation-list-item' />,
}))

vi.mock('@/app/workspace/[workspaceId]/home/components/mothership-chat/mothership-chat', () => ({
  MothershipChat: () => <div data-testid='mothership-chat' />,
}))

vi.mock('@/app/workspace/[workspaceId]/home/hooks', () => ({
  getWorkflowCopilotUseChatOptions: (options: unknown) => options,
  useChat: mockUseChat,
}))

vi.mock('@/hooks/queries/collaboration', () => ({
  useCopilotAgentProfile: () => ({ data: null }),
}))

vi.mock('@/hooks/queries/copilot-chat-selection', () => ({
  useCopilotChatSelection: () => ({
    chatId: undefined,
    setChatId: vi.fn(),
  }),
}))

vi.mock('@/hooks/queries/copilot-chats', () => ({
  copilotChatsKeys: {
    list: (workflowId: string | null | undefined) => ['copilot-chats', workflowId],
  },
  useCopilotChats: () => ({ data: [] }),
}))

vi.mock('@/hooks/queries/copilot-skill-cards', () => ({
  useCopilotSkillCards: () => ({ data: [] }),
}))

vi.mock('@/stores/copilot/content-canvas-selection/store', () => ({
  useContentCanvasSelectionStore: (selector: (state: unknown) => unknown) =>
    selector({ selectionByWorkflow: {} }),
}))

vi.mock('@/stores/workflow-diff/store', () => ({
  useWorkflowDiffStore: {
    getState: () => ({
      setProposedChanges: vi.fn(),
    }),
  },
}))

vi.mock('@/stores/workflow-diff/utils', () => ({
  captureBaselineSnapshot: () => null,
}))

vi.mock('@/stores/workflows/registry/store', () => ({
  useWorkflowRegistry: {
    getState: () => ({
      activeWorkflowId: 'workflow-1',
      refreshWorkflowState: mockRefreshWorkflowState,
    }),
  },
}))

vi.mock('@/stores/workflows/subblock/store', () => ({
  EMPTY_SUBBLOCK_VALUES: {},
  useSubBlockStore: (selector: (state: unknown) => unknown) =>
    selector({ workflowValues: { 'workflow-1': {} } }),
}))

vi.mock('@/stores/workflows/workflow/store', () => ({
  useWorkflowStore: (selector: (state: unknown) => unknown) => selector({ blocks: {} }),
}))

import { CopilotTab } from './copilot-tab'

function renderCopilotTab(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(
      <CopilotTab
        workspaceId='workspace-1'
        activeWorkflowId='workflow-1'
        isActive
        pendingMessage={null}
        onPendingMessageConsumed={vi.fn()}
      />
    )
  })

  return { container, root }
}

describe('CopilotTab local canvas live refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedUseChatOptions = undefined
    mockIsSending = false
    mockRefreshWorkflowState.mockResolvedValue(undefined)
    mockUseChat.mockImplementation((_workspaceId, _chatId, options) => {
      capturedUseChatOptions = options
      return {
        messages: [],
        isSending: mockIsSending,
        isReconnecting: false,
        sendMessage: vi.fn(),
        stopGeneration: vi.fn(),
        resolvedChatId: undefined,
        messageQueue: [],
        removeFromQueue: vi.fn(),
        sendNow: vi.fn(),
        editQueuedMessage: vi.fn(),
        getCurrentRequestId: vi.fn(),
      }
    })
  })

  it('reloads workflow state after successful local canvas mutation tools', () => {
    const { container, root } = renderCopilotTab()

    act(() => {
      capturedUseChatOptions?.onToolResult?.('canvas.apply_patch', true, {})
    })

    expect(mockRefreshWorkflowState).toHaveBeenCalledWith('workflow-1', {
      reason: 'tool-result',
    })

    act(() => {
      capturedUseChatOptions?.onToolResult?.('canvas.generate_node_output', true, {})
    })

    expect(mockRefreshWorkflowState).toHaveBeenCalledTimes(2)

    act(() => root.unmount())
    container.remove()
  })

  it('does not reload workflow state for failed or unrelated tool results', () => {
    const { container, root } = renderCopilotTab()

    act(() => {
      capturedUseChatOptions?.onToolResult?.('canvas.apply_patch', false, {})
      capturedUseChatOptions?.onToolResult?.('search_docs', true, {})
    })

    expect(mockRefreshWorkflowState).not.toHaveBeenCalled()

    act(() => root.unmount())
    container.remove()
  })

  it('reloads workflow state when the stream ends', () => {
    const { container, root } = renderCopilotTab()

    act(() => {
      capturedUseChatOptions?.onStreamEnd?.('chat-1')
    })

    expect(mockRefreshWorkflowState).toHaveBeenCalledWith('workflow-1', {
      reason: 'stream-end',
    })

    act(() => root.unmount())
    container.remove()
  })

  it('does not duplicate the stream-end refresh when sending settles', () => {
    mockIsSending = true
    const { container, root } = renderCopilotTab()

    act(() => {
      capturedUseChatOptions?.onStreamEnd?.('chat-1')
    })

    mockIsSending = false
    act(() => {
      root.render(
        <CopilotTab
          workspaceId='workspace-1'
          activeWorkflowId='workflow-1'
          isActive
          pendingMessage={null}
          onPendingMessageConsumed={vi.fn()}
        />
      )
    })

    expect(mockRefreshWorkflowState).toHaveBeenCalledTimes(1)
    expect(mockRefreshWorkflowState).toHaveBeenCalledWith('workflow-1', {
      reason: 'stream-end',
    })

    act(() => root.unmount())
    container.remove()
  })
})
