/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { workflowStateSchema } from '@/lib/api/contracts/workflows'
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
          credentialId: { type: 'credential', label: 'Configured credential' },
          config: {
            apiKey: { type: 'redacted', label: 'Redacted value' },
            nested: {
              accessToken: { type: 'redacted', label: 'Redacted value' },
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
        imageFile: { type: 'file', label: 'Redacted file' },
        files: { type: 'file', label: 'Redacted file' },
        profile: { name: 'Stage designer' },
      },
    })
  })

  it('preserves copied workspace files while continuing to redact credentials', () => {
    const file = {
      id: 'file-1',
      name: 'draft.png',
      url: '/api/files/serve/workspace%2Fsource%2Fdraft.png?context=workspace',
      size: 42,
      type: 'image/png',
      key: 'workspace/target/draft.png',
      context: 'workspace',
    }

    expect(
      sanitizeWorkflowSnapshot(
        {
          subBlocks: {
            file: { id: 'file', type: 'file', value: file },
            credential: { id: 'credential', type: 'credential', value: 'credential-1' },
          },
        },
        { preserveWorkspaceFiles: true }
      )
    ).toEqual({
      subBlocks: {
        file: { id: 'file', type: 'file', value: file },
        credential: {
          id: 'credential',
          type: 'credential',
          value: { type: 'credential', label: 'Configured credential' },
        },
      },
    })
  })

  it('keeps redacted workflow subBlocks compatible with workflowStateSchema', () => {
    const snapshot = {
      blocks: {
        content: {
          id: 'content',
          type: 'content',
          name: 'Image 1',
          position: { x: 10, y: 20 },
          subBlocks: {
            file: {
              id: 'file',
              type: 'file',
              value: {
                id: 'file-1',
                name: 'draft.png',
                url: 'https://files.example/private',
                size: 42,
                type: 'image/png',
                key: 'private/file-1',
              },
            },
            credential: {
              id: 'credential',
              type: 'credential',
              value: 'cred_private',
            },
          },
          outputs: {},
          enabled: true,
        },
      },
      edges: [],
      loops: {},
      parallels: {},
    }

    const sanitized = sanitizeWorkflowSnapshot(snapshot)

    expect(sanitized).toMatchObject({
      blocks: {
        content: {
          subBlocks: {
            file: {
              id: 'file',
              type: 'file',
              value: { type: 'file', label: 'Redacted file' },
            },
            credential: {
              id: 'credential',
              type: 'credential',
              value: { type: 'credential', label: 'Configured credential' },
            },
          },
        },
      },
    })
    expect(workflowStateSchema.safeParse(sanitized).success).toBe(true)
  })
})
