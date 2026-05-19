import { describe, expect, it } from 'vitest'
import {
  getCanvasNodeDragHandle,
  getCanvasNodeType,
  isContentBlockType,
  isPureCanvasBlockType,
} from '@/lib/workflows/blocks/pure-canvas-blocks'

describe('pure-canvas-blocks', () => {
  it('recognizes note and content blocks as pure canvas blocks', () => {
    expect(isPureCanvasBlockType('note')).toBe(true)
    expect(isPureCanvasBlockType('content')).toBe(true)
    expect(isPureCanvasBlockType('agent')).toBe(false)
  })

  it('recognizes content blocks explicitly', () => {
    expect(isContentBlockType('content')).toBe(true)
    expect(isContentBlockType('note')).toBe(false)
  })

  it('routes note and content blocks to dedicated node renderers', () => {
    expect(getCanvasNodeType('note')).toBe('noteBlock')
    expect(getCanvasNodeType('content')).toBe('contentBlock')
    expect(getCanvasNodeType('agent')).toBe('workflowBlock')
  })

  it('returns the correct drag handle selector for each canvas node kind', () => {
    expect(getCanvasNodeDragHandle('note')).toBe('.note-drag-handle')
    expect(getCanvasNodeDragHandle('content')).toBe('.content-drag-handle')
    expect(getCanvasNodeDragHandle('agent')).toBe('.workflow-drag-handle')
  })
})
