// @vitest-environment jsdom

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@/app/workspace/[workspaceId]/home/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/hooks/use-auto-scroll', () => ({
  useAutoScroll: () => ({
    ref: vi.fn(),
    scrollToBottom: vi.fn(),
  }),
}))

vi.mock('@/hooks/use-progressive-list', () => ({
  useProgressiveList: <T,>(items: T[]) => ({
    staged: items,
    isStaging: false,
  }),
}))

vi.mock('@/app/workspace/[workspaceId]/components', () => ({
  MessageActions: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/home/components/chat-message-attachments', () => ({
  ChatMessageAttachments: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/home/components/queued-messages', () => ({
  QueuedMessages: () => null,
}))

vi.mock('@/app/workspace/[workspaceId]/home/components/user-input', async () => {
  const ReactModule = await import('react')
  return {
    UserInput: ReactModule.forwardRef(function MockUserInput() {
      return <div data-testid='mock-user-input' />
    }),
  }
})

import { MothershipChat } from './mothership-chat'

function renderIntoDocument(element: React.ReactElement): {
  container: HTMLDivElement
  root: Root
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return { container, root }
}

function renderChat(messages: ChatMessage[], onSubmit = vi.fn()) {
  return {
    onSubmit,
    ...renderIntoDocument(
      <MothershipChat
        messages={messages}
        isSending={false}
        onSubmit={onSubmit}
        onStopGeneration={vi.fn()}
        messageQueue={[]}
        onRemoveQueuedMessage={vi.fn()}
        onSendQueuedMessage={vi.fn()}
        onEditQueuedMessage={vi.fn()}
        layout='copilot-view'
      />
    ),
  }
}

function inlineOptionsMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    content,
  }
}

describe('MothershipChat inline options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits the raw inline Confirm option key from the latest assistant message', () => {
    const confirmKey = '__local_canvas_confirm__:token-1'
    const { container, root, onSubmit } = renderChat([
      inlineOptionsMessage(
        'assistant-1',
        `<options>{"${confirmKey}":{"title":"Confirm","description":""}}</options>`
      ),
    ])

    const confirm = container.querySelector('[data-testid="chat-option-confirm"]')
    expect(confirm).not.toBeNull()

    act(() => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSubmit).toHaveBeenCalledWith(confirmKey)

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('submits the raw inline Revise option key from the latest assistant message', () => {
    const reviseKey = '__local_canvas_revise__:token-1'
    const { container, root, onSubmit } = renderChat([
      inlineOptionsMessage(
        'assistant-1',
        `<options>{"${reviseKey}":{"title":"Revise","description":""}}</options>`
      ),
    ])

    const revise = container.querySelector('[data-testid="chat-option-revise"]')
    expect(revise).not.toBeNull()

    act(() => {
      revise?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSubmit).toHaveBeenCalledWith(reviseKey)

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('keeps inline options in older assistant messages non-interactive', () => {
    const reviseKey = '__local_canvas_revise__:token-1'
    const { container, root, onSubmit } = renderChat([
      inlineOptionsMessage(
        'assistant-1',
        `<options>{"${reviseKey}":{"title":"Revise","description":""}}</options>`
      ),
      inlineOptionsMessage('assistant-2', 'Latest assistant response.'),
    ])

    const revise = container.querySelector('[data-testid="chat-option-revise"]')
    expect(revise).toHaveAttribute('disabled')

    act(() => {
      revise?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSubmit).not.toHaveBeenCalled()

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
