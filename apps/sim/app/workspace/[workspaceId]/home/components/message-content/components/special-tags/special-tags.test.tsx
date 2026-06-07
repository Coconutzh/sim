// @vitest-environment jsdom

import type React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { SpecialTags } from './special-tags'

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

describe('SpecialTags', () => {
  it('renders stable selectors for inline Confirm and Revise options', () => {
    const onOptionSelect = vi.fn()
    const confirmKey = '__local_canvas_confirm__:token-1'
    const reviseKey = '__local_canvas_revise__:token-1'
    const { container, root } = renderIntoDocument(
      <SpecialTags
        segment={{
          type: 'options',
          data: {
            [confirmKey]: { title: 'Confirm', description: '' },
            [reviseKey]: { title: 'Revise', description: '' },
          },
        }}
        onOptionSelect={onOptionSelect}
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

    expect(onOptionSelect).toHaveBeenNthCalledWith(1, confirmKey)
    expect(onOptionSelect).toHaveBeenNthCalledWith(2, reviseKey)

    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
