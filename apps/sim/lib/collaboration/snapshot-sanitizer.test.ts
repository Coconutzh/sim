/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { sanitizeWorkflowSnapshot } from '@/lib/collaboration/snapshot-sanitizer'

describe('sanitizeWorkflowSnapshot', () => {
  it('redacts credentials, tokens, and secrets recursively', () => {
    const snapshot = {
      blocks: {
        blockA: {
          type: 'api',
          credentialId: 'credential-1',
          config: {
            apiKey: 'sk-live',
            nested: { accessToken: 'token-value', safeLabel: 'public' },
          },
        },
      },
    }

    expect(sanitizeWorkflowSnapshot(snapshot)).toEqual({
      blocks: {
        blockA: {
          type: 'api',
          credentialId: { type: 'credential', label: '已配置凭证' },
          config: {
            apiKey: { type: 'redacted', label: '已隐藏' },
            nested: {
              accessToken: { type: 'redacted', label: '已隐藏' },
              safeLabel: 'public',
            },
          },
        },
      },
    })
  })

  it('drops debug and log-only fields from published snapshots', () => {
    const snapshot = {
      blocks: [{ id: 'block-1', debugOutput: { value: 'private' }, executionLog: 'hidden' }],
      edges: [],
    }

    expect(sanitizeWorkflowSnapshot(snapshot)).toEqual({
      blocks: [{ id: 'block-1' }],
      edges: [],
    })
  })

  it('redacts file-like fields without treating profile as a file field', () => {
    const snapshot = {
      block: {
        imageFile: {
          id: 'file-1',
          name: 'draft.png',
          url: 'https://files.example/private',
          size: 42,
          type: 'image/png',
          key: 'private/file-1',
        },
        files: [
          {
            id: 'file-2',
            name: 'asset.mov',
            url: 'https://files.example/movie',
            size: 120,
            type: 'video/quicktime',
            key: 'private/file-2',
          },
        ],
        profile: { name: 'Stage designer' },
      },
    }

    expect(sanitizeWorkflowSnapshot(snapshot)).toEqual({
      block: {
        imageFile: { type: 'file', label: '已隐藏文件' },
        files: { type: 'file', label: '已隐藏文件' },
        profile: { name: 'Stage designer' },
      },
    })
  })
})
