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
})
