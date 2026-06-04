/**
 * @vitest-environment jsdom
 */

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { ContentBlock } from '@/app/workspace/[workspaceId]/home/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./components', () => ({
  ChatContent: ({ content }: { content: string }) => <div>{content}</div>,
  ThinkingBlock: ({ content }: { content: string }) => <div>{content}</div>,
  PendingTagIndicator: () => <div>pending</div>,
  CircleStop: () => <div>stop</div>,
  AgentGroup: ({
    agentLabel,
    items,
  }: {
    agentLabel: string
    items: Array<{ type: 'text'; content: string } | { type: 'tool'; data: { displayTitle: string } }>
  }) => (
    <div>
      <div>{agentLabel}</div>
      {items.map((item, index) =>
        item.type === 'text' ? (
          <div key={index}>{item.content}</div>
        ) : (
          <div key={index}>{item.data.displayTitle}</div>
        )
      )}
    </div>
  ),
  Options: ({
    items,
    onSelect,
  }: {
    items: Array<{ id: string; label: string }>
    onSelect?: (id: string) => void
  }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type='button' onClick={() => onSelect?.(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

import { MessageContent } from './message-content'

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

describe('MessageContent integration', () => {
  it('renders a concise TapNow-style action feed for a multi-step content chain', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'action_event',
        actionEvent: {
          name: 'understood_request',
          text: '已理解需求，准备先生成图片，再补文案，最后接成视频。',
          status: 'info',
        },
      },
      {
        type: 'action_event',
        actionEvent: {
          name: 'created_node',
          text: '已新建图片节点',
          status: 'success',
        },
      },
      {
        type: 'action_event',
        actionEvent: {
          name: 'created_node',
          text: '已新建文案节点',
          status: 'success',
        },
      },
      {
        type: 'action_event',
        actionEvent: {
          name: 'connected_nodes',
          text: '已连接图片节点到视频节点',
          status: 'success',
        },
      },
      {
        type: 'action_event',
        actionEvent: {
          name: 'completed_request',
          text: '本次画布请求已完成。',
          status: 'success',
        },
      },
    ]

    const { container, root } = renderIntoDocument(
      <MessageContent
        blocks={blocks}
        fallbackContent=''
        isStreaming={false}
      />
    )

    expect(container.textContent).toContain('已理解需求，准备先生成图片，再补文案，最后接成视频。')
    expect(container.textContent).toContain('已新建图片节点')
    expect(container.textContent).toContain('已新建文案节点')
    expect(container.textContent).toContain('已连接图片节点到视频节点')
    expect(container.textContent).toContain('本次画布请求已完成。')

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('keeps earlier action progress visible when a later step is blocked', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'action_event',
        actionEvent: {
          name: 'created_node',
          text: '已新建图片节点',
          status: 'success',
        },
      },
      {
        type: 'action_event',
        actionEvent: {
          name: 'generated_output',
          text: '已生成图片节点的内容',
          status: 'success',
        },
      },
      {
        type: 'action_event',
        actionEvent: {
          name: 'blocked_step',
          text: '这一步我自动修复后还是无法继续：缺少视频生成目标。',
          status: 'error',
        },
      },
      {
        type: 'text',
        content: '我先保留了前面的结果，你可以继续让我改写这一步。',
        timestamp: Date.now(),
      },
    ]

    const { container, root } = renderIntoDocument(
      <MessageContent
        blocks={blocks}
        fallbackContent=''
        isStreaming={false}
      />
    )

    expect(container.textContent).toContain('已新建图片节点')
    expect(container.textContent).toContain('已生成图片节点的内容')
    expect(container.textContent).toContain('这一步我自动修复后还是无法继续：缺少视频生成目标。')
    expect(container.textContent).toContain('我先保留了前面的结果，你可以继续让我改写这一步。')

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
