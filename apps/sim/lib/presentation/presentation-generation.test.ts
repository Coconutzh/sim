/**
 * @vitest-environment node
 */
import type { BlockState } from '@sim/workflow-types/workflow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCallHermesResponse, mockDbUpdate, mockLoadWorkflowFromNormalizedTables } = vi.hoisted(
  () => ({
    mockCallHermesResponse: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockLoadWorkflowFromNormalizedTables: vi.fn(),
  })
)

function createUpdateChain() {
  const chain: {
    set: ReturnType<typeof vi.fn>
    where: ReturnType<typeof vi.fn>
  } = {
    set: vi.fn(),
    where: vi.fn(),
  }
  chain.set.mockReturnValue(chain)
  chain.where.mockResolvedValue([])
  return chain
}

vi.mock('@sim/db', () => ({
  db: {
    update: mockDbUpdate,
  },
  workflow: {
    id: 'workflow.id',
  },
  workflowBlocks: {
    id: 'workflow_blocks.id',
    workflowId: 'workflow_blocks.workflow_id',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions: unknown[]) => ({ conditions })),
  eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: { INTERNAL_API_SECRET: 'internal-secret' },
  getEnv: () => undefined,
  isTruthy: () => false,
  isFalsy: () => true,
  envNumber: (_name: string, fallback: number) => fallback,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  ensureAbsoluteUrl: (value: string) => `http://localhost:3000${value}`,
  getSocketServerUrl: () => 'http://localhost:3002',
}))

vi.mock('@/lib/hermes/client', () => ({
  callHermesResponse: mockCallHermesResponse,
}))

vi.mock('@/lib/hermes/sim-agent', () => ({
  buildHermesSessionId: () => 'sim:chat:presentation:ppt-node-1',
  buildHermesSessionKey: () => 'sim:org:org-1:user:user-1',
}))

vi.mock('@/lib/workflows/persistence/utils', () => ({
  loadWorkflowFromNormalizedTables: mockLoadWorkflowFromNormalizedTables,
}))

import {
  extractHermesPresentationFailure,
  generatePresentationForCanvasNode,
  rebuildPresentationAsEditable,
} from '@/lib/presentation/presentation-generation'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

function block(overrides: Partial<BlockState>): BlockState {
  return {
    id: overrides.id ?? 'node-1',
    type: overrides.type ?? 'content',
    name: overrides.name ?? 'Node',
    position: { x: 0, y: 0 },
    subBlocks: {},
    outputs: {},
    enabled: true,
    horizontalHandles: true,
    isWide: false,
    data: {},
    ...overrides,
  } as unknown as BlockState
}

function successfulHermesRaw() {
  return {
    output: [
      {
        type: 'function_call_output',
        output: JSON.stringify({
          success: true,
          auditId: 'audit-1',
          traceId: 'trace-1',
          pptxFile: {
            id: 'pptx-file-1',
            name: 'deck.pptx',
            key: 'workspace/workspace-1/private/deck.pptx',
            type: PPTX_MIME,
            size: 100,
          },
          manifestFile: {
            id: 'manifest-file-1',
            name: 'deck-manifest.json',
            key: 'workspace/workspace-1/private/deck-manifest.json',
            type: 'application/json',
            size: 100,
          },
          manifest: {
            title: 'AI 热点洞察',
            source: 'codex-ppt-skill',
            slideCount: 3,
            selectedStyle: '电子墨水杂志风',
            imageBackend: 'codex-ppt/scripts/image_gen.py',
            imageProvider: 'evolink',
            imageModel: 'gpt-image-2',
            imageBaseUrl: 'https://api.evolink.ai/v1',
            targetNodeId: 'ppt-node-1',
            createdAt: '2026-06-22T00:00:00.000Z',
          },
        }),
      },
    ],
  }
}

function successfulEditableHermesRaw() {
  return {
    output: [
      {
        type: 'function_call_output',
        output: JSON.stringify({
          success: true,
          auditId: 'editable-audit-1',
          pptxFile: {
            id: 'editable-pptx-file-1',
            name: 'deck-editable.pptx',
            key: 'workspace/workspace-1/private/deck-editable.pptx',
            type: PPTX_MIME,
            size: 120,
          },
          manifestFile: {
            id: 'editable-manifest-file-1',
            name: 'deck-editable-manifest.json',
            key: 'workspace/workspace-1/private/deck-editable-manifest.json',
            type: 'application/json',
            size: 100,
          },
          manifest: {
            title: 'Editable deck',
            source: 'image-to-editable-ppt',
            backendType: 'editable',
            editable: true,
            createdAt: '2026-08-11T00:00:00.000Z',
          },
        }),
      },
    ],
  }
}

describe('generatePresentationForCanvasNode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true }))
    )
    mockDbUpdate.mockImplementation(() => createUpdateChain())
    mockCallHermesResponse.mockResolvedValue({
      id: 'resp-1',
      content: 'PPT generated.',
      raw: successfulHermesRaw(),
    })
  })

  it('tells Hermes to render referenced primary text as visible slide copy', async () => {
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue({
      blocks: {
        'ppt-node-1': block({
          id: 'ppt-node-1',
          name: '生成 PPT',
          data: { contentVariant: 'presentation' },
          subBlocks: {
            contentVariant: { id: 'contentVariant', value: 'presentation' },
            presentationPrompt: {
              id: 'presentationPrompt',
              value: '请参考这个文案，把这个文案要写的内容浓缩成3页ppt，然后生成ppt',
            },
            presentationSlideCountMode: { id: 'presentationSlideCountMode', value: 'auto' },
            contentReferences: {
              id: 'contentReferences',
              value: [
                {
                  sourceBlockId: 'copy-node-1',
                  sourceVariant: 'text',
                  role: 'text_context',
                },
              ],
            },
          },
        }),
        'copy-node-1': block({
          id: 'copy-node-1',
          name: 'PPT最终文案',
          data: { contentVariant: 'text' },
          subBlocks: {
            contentVariant: { id: 'contentVariant', value: 'text' },
            contentHtml: {
              id: 'contentHtml',
              value:
                '<h1>2026年6月热点洞察</h1><p>AI 人才争夺战升级，影视出海加速，AI 生活助手普及。</p>',
            },
          },
        }),
      },
    })

    await generatePresentationForCanvasNode({
      userId: 'user-1',
      organizationId: 'org-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      nodeId: 'ppt-node-1',
      traceId: 'trace-1',
    })

    const hermesInput = mockCallHermesResponse.mock.calls[0]?.[0]?.input
    expect(hermesInput).toEqual(expect.any(String))
    expect(hermesInput).toContain('PRIMARY CONTENT TEXT POLICY')
    expect(hermesInput).toContain('VISIBLE TEXT TO RENDER EXACTLY')
    expect(hermesInput).toContain('presentationRole=primary_content')
    expect(hermesInput).toContain('2026年6月热点洞察')
    expect(hermesInput).toContain('No actual readable text required')
    expect(hermesInput).toContain('unless the user explicitly asks')
  })
})

describe('rebuildPresentationAsEditable', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true }))
    )
    mockDbUpdate.mockImplementation(() => createUpdateChain())
    mockLoadWorkflowFromNormalizedTables.mockResolvedValue({
      blocks: {
        'ppt-node-1': block({
          id: 'ppt-node-1',
          data: { contentVariant: 'presentation' },
          subBlocks: {
            contentVariant: { id: 'contentVariant', value: 'presentation' },
            presentationArtifact: {
              id: 'presentationArtifact',
              value: {
                auditId: 'audit-1',
                pptxFile: {
                  id: 'pptx-file-1',
                  name: 'deck.pptx',
                  key: 'workspace/workspace-1/private/deck.pptx',
                  type: PPTX_MIME,
                  size: 100,
                },
                manifestFile: {
                  id: 'manifest-file-1',
                  name: 'deck-manifest.json',
                  key: 'workspace/workspace-1/private/deck-manifest.json',
                  type: 'application/json',
                  size: 100,
                },
                manifest: {
                  title: 'Original deck',
                  source: 'codex-ppt-skill',
                  createdAt: '2026-08-11T00:00:00.000Z',
                },
              },
            },
          },
        }),
      },
    })
    mockCallHermesResponse.mockResolvedValue({
      id: 'resp-editable-1',
      content: 'Editable PPT generated.',
      raw: successfulEditableHermesRaw(),
    })
  })

  it('gives Hermes a service-authenticated internal source URL', async () => {
    await rebuildPresentationAsEditable({
      actorUserId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      nodeId: 'ppt-node-1',
      taskId: 'task-1',
    })

    const hermesInput = mockCallHermesResponse.mock.calls[0]?.[0]?.input as string
    const sourceLine = hermesInput
      .split('\n')
      .find((line) => line.startsWith('ORIGINAL_PPTX_URL: '))
    expect(sourceLine).toBeTruthy()

    const sourceUrl = new URL(sourceLine!.slice('ORIGINAL_PPTX_URL: '.length))
    expect(sourceUrl.pathname).toBe('/api/internal/hermes/presentation-artifacts/source')
    expect(sourceUrl.searchParams.get('userId')).toBe('user-1')
    expect(sourceUrl.searchParams.get('workspaceId')).toBe('workspace-1')
    expect(sourceUrl.searchParams.get('workflowId')).toBe('workflow-1')
    expect(sourceUrl.searchParams.get('nodeId')).toBe('ppt-node-1')
    expect(sourceUrl.pathname).not.toContain('/api/files/serve/')

    const instructions = mockCallHermesResponse.mock.calls[0]?.[0]?.instructions as string
    expect(instructions).toContain('operation=page_prompt')
    expect(instructions).toContain(
      'runtime binds dispatch and record to the internal worker identity'
    )
    expect(instructions).toContain('do not invent agentId or promptFile')
    expect(instructions).toContain(
      'page_prompt internally creates and waits for the delegated page worker'
    )
    expect(instructions).toContain(
      'never call operation=dispatch, operation=record, or delegate_task'
    )
    expect(instructions).toContain('Do not call delegate_task for local mode')
    expect(instructions).toContain('call operation=next again')
  })

  it('surfaces the structured editable runtime failure instead of a missing upload error', async () => {
    mockCallHermesResponse.mockResolvedValueOnce({
      id: 'resp-editable-failed',
      content: 'The page failed.',
      raw: {
        output: [
          {
            type: 'function_call_output',
            output: JSON.stringify({
              success: false,
              errorCode: 'IMAGE_BACKEND_UNAVAILABLE',
              error: 'Evolink image task failed: invalid parameters',
            }),
          },
          {
            type: 'message',
            content: [{ type: 'output_text', text: 'The page failed.' }],
          },
        ],
      },
    })

    await expect(
      rebuildPresentationAsEditable({
        actorUserId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        nodeId: 'ppt-node-1',
        taskId: 'task-1',
      })
    ).rejects.toThrow('IMAGE_BACKEND_UNAVAILABLE: Evolink image task failed: invalid parameters')
  })
})

describe('extractHermesPresentationFailure', () => {
  it('uses the last structured failed function output', () => {
    expect(
      extractHermesPresentationFailure({
        output: [
          {
            type: 'function_call_output',
            output: JSON.stringify({ success: false, error: 'first failure' }),
          },
          {
            type: 'function_call_output',
            output: JSON.stringify({
              success: false,
              errorCode: 'IMAGE_BACKEND_UNAVAILABLE',
              error: 'provider failed',
            }),
          },
        ],
      })
    ).toBe('IMAGE_BACKEND_UNAVAILABLE: provider failed')
  })
})
