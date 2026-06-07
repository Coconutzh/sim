// @vitest-environment jsdom

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { Options } from './options'

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

describe('Options', () => {
  it('renders stable selectors for chat action options', () => {
    const onSelect = vi.fn()
    const { container, root } = renderIntoDocument(
      <Options
        items={[
          { id: 'confirm', label: 'Confirm', value: 'confirm:token-1' },
          { id: 'revise', label: 'Revise' },
        ]}
        onSelect={onSelect}
      />
    )

    const confirm = container.querySelector('[data-testid="chat-option-confirm"]')
    const revise = container.querySelector('[data-testid="chat-option-revise"]')
    expect(confirm).toHaveAttribute('aria-label', 'Chat option: Confirm')
    expect(revise).toHaveAttribute('aria-label', 'Chat option: Revise')

    act(() => {
      confirm?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      revise?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelect).toHaveBeenNthCalledWith(1, 'confirm:token-1')
    expect(onSelect).toHaveBeenNthCalledWith(2, 'revise')

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
