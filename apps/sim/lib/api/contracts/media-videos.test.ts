import { describe, expect, it } from 'vitest'
import {
  captureWorkspaceVideoFrameBodySchema,
  enhanceWorkspaceVideoBodySchema,
} from '@/lib/api/contracts/media-videos'

const sourceFile = {
  id: 'wf_source',
  name: 'source.mp4',
  url: '/api/files/serve/workspace/ws-1/source.mp4?context=workspace',
  key: 'workspace/ws-1/source.mp4',
  size: 1000,
  type: 'video/mp4',
  context: 'workspace',
}

describe('media video contracts', () => {
  it.each(['current', 'first', 'last'] as const)(
    'accepts valid %s frame capture parameters',
    (mode) => {
      const result = captureWorkspaceVideoFrameBodySchema.safeParse({
        workspaceId: 'ws-1',
        sourceFile,
        timeSeconds: mode === 'last' ? 4.95 : 0,
        mode,
      })

      expect(result.success).toBe(true)
    }
  )

  it('rejects negative frame capture times', () => {
    const result = captureWorkspaceVideoFrameBodySchema.safeParse({
      workspaceId: 'ws-1',
      sourceFile,
      timeSeconds: -0.01,
      mode: 'current',
    })

    expect(result.success).toBe(false)
  })

  it('rejects unsupported frame capture modes', () => {
    const result = captureWorkspaceVideoFrameBodySchema.safeParse({
      workspaceId: 'ws-1',
      sourceFile,
      timeSeconds: 0,
      mode: 'middle',
    })

    expect(result.success).toBe(false)
  })

  it('accepts valid video enhancement parameters', () => {
    const result = enhanceWorkspaceVideoBodySchema.safeParse({
      workspaceId: 'ws-1',
      sourceFile,
      resolution: '4k',
      frameRate: '60fps',
      slowMotion: '2x',
      coverTimeSeconds: 0,
    })

    expect(result.success).toBe(true)
  })

  it('rejects unsupported video enhancement resolutions', () => {
    const result = enhanceWorkspaceVideoBodySchema.safeParse({
      workspaceId: 'ws-1',
      sourceFile,
      resolution: '720p',
      frameRate: '60fps',
      slowMotion: '2x',
    })

    expect(result.success).toBe(false)
  })

  it('rejects unsupported video enhancement frame rates', () => {
    const result = enhanceWorkspaceVideoBodySchema.safeParse({
      workspaceId: 'ws-1',
      sourceFile,
      resolution: '1080p',
      frameRate: '120fps',
      slowMotion: 'source',
    })

    expect(result.success).toBe(false)
  })

  it('rejects unsupported video enhancement slow motion values', () => {
    const result = enhanceWorkspaceVideoBodySchema.safeParse({
      workspaceId: 'ws-1',
      sourceFile,
      resolution: '1080p',
      frameRate: 'source',
      slowMotion: '4x',
    })

    expect(result.success).toBe(false)
  })
})
