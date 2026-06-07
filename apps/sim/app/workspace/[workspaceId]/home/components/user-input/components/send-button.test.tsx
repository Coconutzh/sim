// @vitest-environment jsdom

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { SendButton } from './send-button'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

describe('SendButton', () => {
  it('exposes a stable selector for sending messages', () => {
    const onSubmit = vi.fn()
    const { container, root } = renderIntoDocument(
      <SendButton isSending={false} canSubmit onSubmit={onSubmit} onStopGeneration={vi.fn()} />
    )

    const button = container.querySelector('[data-testid="chat-send-message"]')
    expect(button).toHaveAttribute('aria-label', 'Send message')

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSubmit).toHaveBeenCalledOnce()

    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('exposes a stable selector for stopping generation', () => {
    const onStopGeneration = vi.fn()
    const { container, root } = renderIntoDocument(
      <SendButton
        isSending
        canSubmit={false}
        onSubmit={vi.fn()}
        onStopGeneration={onStopGeneration}
      />
    )

    const button = container.querySelector('[data-testid="chat-stop-generation"]')
    expect(button).toHaveAttribute('aria-label', 'Stop generation')

    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onStopGeneration).toHaveBeenCalledOnce()

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
