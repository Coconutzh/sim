/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildEditWorkflowOperationsFromPatch,
  validateLocalCanvasPatch,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/canvas-patch'
import { buildTokenAwareLocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-manager'
import {
  buildLocalAgentMemoryKey,
  canPersistLocalAgentThreadMemory,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/memory'
import { getCanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters'
import { mergeAgentSkillRows } from '@/lib/copilot/request/lifecycle/local-canvas-agent/skills'
import {
  emitLocalAgentText,
  emitLocalAgentToolCall,
  emitLocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/stream'
import { executeLocalAgentTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-executor-bridge'
import {
  selectAvailableCanvasTools,
  selectAvailableLocalAgentTools,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-registry'
import type {
  CanvasSnapshot,
  LocalAgentContext,
  LocalAgentToolCall,
  LocalCanvasPatch,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import {
  getContentReferenceSourceHandleId,
  getContentReferenceTargetHandleId,
} from '@/lib/workflows/content-reference-edges'

function buildMemoryContext(overrides: {
  userId?: string
  workspaceId?: string
  workflowId?: string
  chatId?: string
  agentCode?: string
}): Pick<LocalAgentContext, 'userId' | 'workspaceId' | 'workflowId' | 'chatId' | 'agent'> {
  return {
    userId: overrides.userId ?? 'user-1',
    workspaceId: overrides.workspaceId ?? 'workspace-1',
    workflowId: overrides.workflowId ?? 'workflow-1',
    chatId: overrides.chatId,
    agent: {
      code: overrides.agentCode ?? 'chief_director',
      name: 'Chief Director',
      description: '',
      systemPrompt: '',
    },
  }
}

function buildLocalContext(overrides: Partial<LocalAgentContext> = {}): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '总结选中的脚本节点',
    sessionScope: 'personal',
    agent: {
      code: 'chief_director',
      name: 'Chief Director',
      description: 'director',
      systemPrompt: 'system prompt',
    },
    discipline: { id: '', code: 'chief_director', name: '总导演' },
    workgroup: {
      id: '',
      name: 'Workspace',
      organizationId: '',
      teamWorkspaceId: null,
    },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: ['text-1'],
    conversationHistory: [
      { role: 'user', content: '第一轮问题' },
      { role: 'assistant', content: '第一轮回答' },
    ],
    skills: [
      {
        id: 'skill-1',
        name: '短视频规范',
        description: '检查短视频内容链',
        content: '脚本、图片、视频、音频需要形成连续链路。',
        enabled: true,
        source: 'agent_template',
      },
    ],
    model: { model: 'test-model', mode: 'structured' },
    confirmationMode: 'auto',
    thinkingLevel: 'standard',
    requestPayload: {},
    execContext: {
      userId: 'user-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
    ...overrides,
  }
}

const emptySnapshot: CanvasSnapshot = {
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  nodes: [],
  edges: [],
}

describe('local canvas agent foundation', () => {
  it('isolates thread memory by user, workspace, workflow, agent, and chat', () => {
    const base = buildLocalAgentMemoryKey(buildMemoryContext({ chatId: 'chat-1' }))
    expect(base).toBe(
      'local-canvas-agent:v2:thread:user-1:workspace-1:workflow-1:chief_director:chat-1'
    )
    expect(
      buildLocalAgentMemoryKey(buildMemoryContext({ userId: 'user-2', chatId: 'chat-1' }))
    ).not.toBe(base)
    expect(
      buildLocalAgentMemoryKey(buildMemoryContext({ agentCode: 'lighting', chatId: 'chat-1' }))
    ).not.toBe(base)
  })

  it('does not persist thread memory when a chat id is not available', () => {
    expect(canPersistLocalAgentThreadMemory(buildMemoryContext({ chatId: 'chat-1' }))).toBe(true)
    expect(canPersistLocalAgentThreadMemory(buildMemoryContext({}))).toBe(false)
  })

  it('keeps reserved node types readable but not writable', () => {
    const documentAdapter = getCanvasNodeAdapter('document')
    expect(documentAdapter.capabilities).toMatchObject({
      canRead: true,
      canWrite: false,
      canGenerate: false,
    })
    expect(
      documentAdapter.validatePatch({
        type: 'create_node',
        kind: 'document',
        title: 'Doc',
      })
    ).toEqual({ valid: false, errors: ['document nodes are read-only'] })
  })

  it('validates update patches against the actual node adapter', () => {
    const snapshot: CanvasSnapshot = {
      ...emptySnapshot,
      nodes: [
        {
          id: 'text-1',
          name: 'Text 1',
          blockType: 'content',
          kind: 'text',
          position: { x: 0, y: 0 },
          values: {},
          raw: {},
        },
      ],
    }

    expect(
      validateLocalCanvasPatch(
        {
          operations: [{ type: 'update_node', nodeId: 'text-1', fields: { file: null } }],
        },
        snapshot
      )
    ).toEqual({ valid: false, errors: ['Field "file" is not writable'] })
  })

  it('converts high-level create and connect patches through content-node operations', () => {
    const patch: LocalCanvasPatch = {
      operations: [
        {
          type: 'create_node',
          clientNodeId: 'script',
          nodeId: 'script-node',
          kind: 'text',
          title: 'Script',
          position: { x: 0, y: 0 },
          fields: { contentHtml: '<p>hello</p>' },
        },
        {
          type: 'create_node',
          clientNodeId: 'image',
          nodeId: 'image-node',
          kind: 'image',
          title: 'Image',
          position: { x: 360, y: 0 },
          fields: { aiPrompt: 'visual' },
        },
        { type: 'connect', sourceNodeId: 'script', targetNodeId: 'image' },
      ],
    }

    const { operations, idMap } = buildEditWorkflowOperationsFromPatch({
      patch,
      snapshot: emptySnapshot,
    })

    expect(idMap.get('script')).toBe('script-node')
    expect(idMap.get('image')).toBe('image-node')
    expect(operations[0]).toMatchObject({
      operation_type: 'add',
      block_id: 'script-node',
      params: { type: 'content', name: 'Script' },
    })
    expect(operations[2]).toMatchObject({
      operation_type: 'edit',
      block_id: 'script-node',
      params: {
        connections: {
          [getContentReferenceSourceHandleId('right')]: {
            block: 'image-node',
            handle: getContentReferenceTargetHandleId('left'),
          },
        },
      },
    })
  })

  it('converts layout patches to position edits without replacing node content or connections', () => {
    const snapshot: CanvasSnapshot = {
      ...emptySnapshot,
      nodes: [
        {
          id: 'text-1',
          name: 'Text 1',
          blockType: 'content',
          kind: 'text',
          position: { x: 500, y: 300 },
          values: { contentHtml: '<p>keep me</p>' },
          raw: {},
        },
        {
          id: 'image-1',
          name: 'Image 1',
          blockType: 'content',
          kind: 'image',
          position: { x: 100, y: 50 },
          values: { aiPrompt: 'keep prompt' },
          raw: {},
        },
      ],
      edges: [{ source: 'text-1', target: 'image-1' }],
    }

    const { operations } = buildEditWorkflowOperationsFromPatch({
      patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] },
      snapshot,
    })

    expect(operations).toHaveLength(2)
    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation_type: 'edit',
          block_id: 'text-1',
          params: { position: expect.any(Object) },
        }),
        expect.objectContaining({
          operation_type: 'edit',
          block_id: 'image-1',
          params: { position: expect.any(Object) },
        }),
      ])
    )
    for (const operation of operations) {
      expect(Object.keys(operation.params ?? {})).toEqual(['position'])
    }
  })

  it('merges organization defaults with team overrides and disabled skills', () => {
    const skills = mergeAgentSkillRows({
      workgroupId: 'workgroup-1',
      rows: [
        {
          id: 'skill-a',
          name: 'Default A',
          description: 'default',
          content: 'default content',
          enabled: true,
          scope: 'agent_template',
          workgroupId: null,
        },
        {
          id: 'skill-a',
          name: 'Team A',
          description: 'team',
          content: 'team content',
          enabled: true,
          scope: 'team_override',
          workgroupId: 'workgroup-1',
        },
        {
          id: 'skill-b',
          name: 'Disabled B',
          description: 'disabled',
          content: 'disabled content',
          enabled: true,
          scope: 'agent_template',
          workgroupId: null,
        },
        {
          id: 'skill-b',
          name: 'Disabled B',
          description: 'disabled',
          content: 'disabled content',
          enabled: false,
          scope: 'team_override',
          workgroupId: 'workgroup-1',
        },
        {
          id: 'skill-c',
          name: 'Other Team',
          description: 'other',
          content: 'other content',
          enabled: true,
          scope: 'team_override',
          workgroupId: 'workgroup-2',
        },
      ],
    })

    expect(skills).toEqual([
      {
        id: 'skill-a',
        name: 'Team A',
        description: 'team',
        content: 'team content',
        enabled: true,
        source: 'team_override',
      },
    ])
  })

  it('builds token-aware context with selected node detail and bounded history', () => {
    const contextText = buildTokenAwareLocalAgentContext({
      context: buildLocalContext({
        memory: {
          version: 1,
          scope: 'personal',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          agentCode: 'chief_director',
          chatId: 'chat-1',
          conversationSummary: '上一轮已经决定先做春季发布会主视觉链路。',
          taskState: {
            goal: '完善短视频内容链',
            completedSteps: ['已读取脚本节点'],
            openQuestions: ['是否需要补配乐节点'],
            lastObservation: 'Text node was inspected',
          },
          canvasSummary: '画布里已有 text -> image 结构。',
          recentObservations: [
            {
              toolName: 'canvas.read_selected_nodes',
              summary: 'Read selected text node',
              success: true,
              timestamp: '2026-06-06T00:00:00.000Z',
            },
          ],
          updatedAt: '2026-06-06T00:00:00.000Z',
        },
      }),
      snapshot: {
        ...emptySnapshot,
        nodes: [
          {
            id: 'text-1',
            name: '脚本',
            blockType: 'content',
            kind: 'text',
            position: { x: 0, y: 0 },
            values: {
              contentHtml: '<p>春季发布会主视觉脚本</p>',
              aiPrompt: '写一段发布会脚本',
            },
            raw: {},
          },
        ],
      },
    })

    expect(contextText).toContain('Selected Node Details')
    expect(contextText).toContain('春季发布会主视觉脚本')
    expect(contextText).toContain('Enabled Skills')
    expect(contextText).toContain('Recent Conversation')
    expect(contextText).toContain('Long-Term Memory')
    expect(contextText).toContain('上一轮已经决定先做春季发布会主视觉链路')
    expect(contextText).toContain('完善短视频内容链')
    expect(contextText).toContain('画布里已有 text -> image 结构')
  })

  it('includes resolved manual contexts in token-aware attached context layer', () => {
    const contextText = buildTokenAwareLocalAgentContext({
      context: buildLocalContext({
        attachments: [
          {
            id: 'upload-1',
            key: 'workspace/uploads/brief.pdf',
            name: 'brief.pdf',
            type: 'application/pdf',
            size: 128,
            url: '/api/files/brief.pdf',
          },
        ],
        attachedContexts: [
          {
            type: 'knowledge',
            tag: '@Brand Guide',
            content: '品牌规范要求：年轻、明亮、舞台灯光感，避免沉闷表达。',
          },
        ],
      }),
      snapshot: emptySnapshot,
    })

    expect(contextText).toContain('Attached Contexts')
    expect(contextText).toContain('brief.pdf')
    expect(contextText).toContain('application/pdf')
    expect(contextText).not.toContain('workspace/uploads/brief.pdf')
    expect(contextText).not.toContain('/api/files/brief.pdf')
    expect(contextText).toContain('knowledge @Brand Guide')
    expect(contextText).toContain('年轻、明亮、舞台灯光感')
  })

  it('does not place raw persona system prompts in token-aware context', () => {
    const contextText = buildTokenAwareLocalAgentContext({
      context: buildLocalContext({
        agent: {
          code: 'chief_director',
          name: '总导演',
          description: '负责协调内容生产能力',
          systemPrompt: '你是总导演 Agent，需要以总导演身份发言。',
        },
      }),
      snapshot: emptySnapshot,
    })

    expect(contextText).toContain('Agent code: chief_director')
    expect(contextText).toContain('Agent profile instructions are internal capability context only')
    expect(contextText).not.toContain('你是总导演 Agent')
    expect(contextText).not.toContain('需要以总导演身份发言')
  })

  it('does not expose canvas tools without read access', () => {
    expect(
      selectAvailableCanvasTools(
        buildLocalContext({
          permissions: {
            canRead: false,
            canWrite: false,
            canPublish: false,
            readonlyReason: 'denied',
          },
        })
      )
    ).toEqual([])
  })

  it('exposes patch proposal as a read-safe tool without exposing mutation tools', () => {
    const tools = selectAvailableCanvasTools(
      buildLocalContext({
        permissions: {
          canRead: true,
          canWrite: false,
          canPublish: false,
          readonlyReason: 'read only',
        },
      })
    )

    expect(tools).toContain('canvas.propose_patch')
    expect(tools).not.toContain('canvas.apply_patch')
    expect(tools).not.toContain('canvas.generate_node_output')
  })

  it('exposes local read tools without requiring canvas write access', () => {
    const tools = selectAvailableLocalAgentTools(
      buildLocalContext({
        permissions: {
          canRead: true,
          canWrite: false,
          canPublish: false,
          readonlyReason: 'read only',
        },
      })
    )

    expect(tools).toEqual(
      expect.arrayContaining([
        'read_file',
        'search_workspace',
        'query_knowledge',
        'search_docs',
        'read_tasks',
      ])
    )
    expect(tools).not.toContain('canvas.apply_patch')
    expect(tools).not.toContain('materialize_file')
    expect(tools).not.toContain('update_task_result')
    expect(tools).not.toContain('submit_task_result')
  })

  it('exposes local context write tools only when the canvas request has write access', () => {
    const tools = selectAvailableLocalAgentTools(
      buildLocalContext({
        permissions: {
          canRead: true,
          canWrite: true,
          canPublish: false,
        },
      })
    )

    expect(tools).toEqual(
      expect.arrayContaining(['materialize_file', 'update_task_result', 'submit_task_result'])
    )
  })

  it('streams unavailable tool failures so the UI can show the blocked action', async () => {
    const onEvent = vi.fn()
    const streamContext = {
      contentBlocks: [],
      toolCalls: new Map(),
    } as unknown as LocalAgentContext['streamContext']
    const context = buildLocalContext({
      permissions: {
        canRead: true,
        canWrite: false,
        canPublish: false,
        readonlyReason: 'read only',
      },
      streamContext,
      options: { onEvent },
    })
    const call: LocalAgentToolCall = {
      name: 'canvas.apply_patch',
      input: { patch: { operations: [{ type: 'layout_nodes', direction: 'horizontal' }] } },
    }

    const result = await executeLocalAgentTool(context, call)

    expect(result.success).toBe(false)
    expect(streamContext.contentBlocks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'tool_call' })])
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool',
        payload: expect.objectContaining({
          toolName: 'canvas.apply_patch',
          phase: 'result',
          success: false,
        }),
      })
    )
  })

  it('validates tool input before execution', async () => {
    const streamContext = {
      contentBlocks: [],
      toolCalls: new Map(),
    } as unknown as LocalAgentContext['streamContext']
    const result = await executeLocalAgentTool(
      buildLocalContext({
        streamContext,
      }),
      {
        name: 'canvas.read_node',
        input: {},
      }
    )

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('nodeId is required'),
    })
  })

  it('emits full assistant text without server-side truncation', async () => {
    const onEvent = vi.fn()
    const context = {
      accumulatedContent: '',
      contentBlocks: [],
    } as unknown as LocalAgentContext['streamContext']
    const longText = `完整回答：${'这是一段用于确认本地流式事件不会截断的内容。'.repeat(80)}`

    await emitLocalAgentText(context, { onEvent }, longText)

    expect(context.accumulatedContent).toBe(longText)
    expect(context.contentBlocks.at(-1)).toMatchObject({ type: 'text', content: longText })
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ text: longText, textMode: 'replace' }),
      })
    )
  })

  it('streams summarized tool results instead of large raw outputs', async () => {
    const onEvent = vi.fn()
    const context = {
      contentBlocks: [],
      toolCalls: new Map(),
    } as unknown as LocalAgentContext['streamContext']
    const toolCallId = await emitLocalAgentToolCall({
      context,
      options: { onEvent },
      toolName: 'canvas.read_selected_nodes',
      title: 'Reading selected nodes',
      input: {},
    })
    const largeText = '完整节点正文'.repeat(500)

    await emitLocalAgentToolResult({
      context,
      options: { onEvent },
      toolCallId,
      success: true,
      summary: 'Read 1 selected node detail(s)',
      output: { textContent: largeText },
    })

    const toolCall = context.toolCalls.get(toolCallId)
    expect(toolCall?.result?.output).toEqual({ summary: 'Read 1 selected node detail(s)' })
    expect(JSON.stringify(toolCall?.result?.output)).not.toContain(largeText)
    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          output: { summary: 'Read 1 selected node detail(s)' },
        }),
      })
    )
  })
})
