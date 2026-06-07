/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const {
  mockExecuteMaterializeFile,
  mockGenerateWorkspaceContext,
  mockListProductionTasks,
  mockSubmitProductionTask,
  mockUpdateProductionTask,
} = vi.hoisted(() => ({
  mockExecuteMaterializeFile: vi.fn(),
  mockGenerateWorkspaceContext: vi.fn(),
  mockListProductionTasks: vi.fn(),
  mockSubmitProductionTask: vi.fn(),
  mockUpdateProductionTask: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceContext: mockGenerateWorkspaceContext,
}))

vi.mock('@/lib/copilot/tools/handlers/materialize-file', () => ({
  executeMaterializeFile: mockExecuteMaterializeFile,
}))

vi.mock('@/lib/production-tasks/service', () => ({
  listProductionTasks: mockListProductionTasks,
  submitProductionTask: mockSubmitProductionTask,
  updateProductionTask: mockUpdateProductionTask,
}))

import { executeContextTool } from '@/lib/copilot/request/lifecycle/local-canvas-agent/context-tools'

function buildContext(): LocalAgentContext {
  return {
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    message: '读取上下文',
    sessionScope: 'personal',
    agent: { code: 'local_canvas_agent', name: 'Canvas Agent', description: '', systemPrompt: '' },
    discipline: { id: '', code: 'canvas_runtime', name: 'Canvas Runtime' },
    workgroup: { id: '', name: 'Workspace', organizationId: '', teamWorkspaceId: null },
    permissions: { canRead: true, canWrite: true, canPublish: false },
    selectedNodeIds: [],
    attachments: [
      {
        id: 'file-1',
        key: 'uploads/brief.pdf',
        name: 'brief.pdf',
        type: 'application/pdf',
        url: '/files/brief.pdf',
      },
    ],
    attachedContexts: [
      {
        type: 'file',
        tag: '@brief.pdf',
        content: 'Brief content for the spring launch visual direction.',
      },
      {
        type: 'knowledge',
        tag: '@Brand Guide',
        content: '品牌规范要求年轻、明亮、舞台灯光感。',
      },
      {
        type: 'docs',
        tag: '@Docs',
        content: 'Canvas node generation documentation.',
      },
    ],
    conversationHistory: [],
    skills: [],
    model: { model: 'test-model', mode: 'structured' },
    confirmationMode: 'auto',
    thinkingLevel: 'standard',
    requestPayload: {},
    execContext: {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
    },
    streamContext: {} as LocalAgentContext['streamContext'],
    options: {},
  }
}

describe('local canvas context tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateWorkspaceContext.mockResolvedValue('workspace has workflow and files')
    mockListProductionTasks.mockResolvedValue([
      {
        id: 'task-1',
        title: '补齐视频节点',
        status: 'todo',
        dueAt: null,
        sourceWorkflowId: 'workflow-1',
        resultWorkflowId: null,
        assigneeWorkgroup: { name: '视频组' },
        sourceWorkgroup: { name: '导演组' },
      },
    ])
    mockExecuteMaterializeFile.mockResolvedValue({
      success: true,
      output: { succeeded: ['brief.pdf'], failed: [] },
      resources: [{ type: 'file', id: 'file-1', title: 'brief.pdf' }],
    })
    mockUpdateProductionTask.mockResolvedValue({
      id: 'task-1',
      title: '补齐视频节点',
      status: 'in_progress',
      dueAt: null,
      resultWorkflowId: null,
      resultNodeId: null,
    })
    mockSubmitProductionTask.mockResolvedValue({
      id: 'task-1',
      title: '补齐视频节点',
      status: 'submitted',
      resultWorkflowId: 'workflow-1',
      resultNodeId: 'text-1',
      submittedAt: '2026-06-06T00:00:00.000Z',
    })
  })

  it('reads attached file context and redacts storage metadata', async () => {
    const result = await executeContextTool(buildContext(), {
      name: 'read_file',
      input: { fileName: 'brief.pdf' },
    })

    expect(result.success).toBe(true)
    expect(result.summary).toBe('Read 1 attached file context(s)')
    expect(result.output).toEqual(
      expect.objectContaining({
        files: [expect.objectContaining({ name: 'brief.pdf', type: 'application/pdf' })],
        contexts: [expect.objectContaining({ content: expect.stringContaining('spring launch') })],
      })
    )
    expect(JSON.stringify(result.output)).not.toContain('uploads/brief.pdf')
    expect(JSON.stringify(result.output)).not.toContain('/files/brief.pdf')
  })

  it('queries attached knowledge and docs context', async () => {
    await expect(
      executeContextTool(buildContext(), {
        name: 'query_knowledge',
        input: { query: '舞台灯光' },
      })
    ).resolves.toMatchObject({
      success: true,
      output: { results: [expect.objectContaining({ tag: '@Brand Guide' })] },
    })

    await expect(
      executeContextTool(buildContext(), {
        name: 'search_docs',
        input: { query: 'generation' },
      })
    ).resolves.toMatchObject({
      success: true,
      output: { results: [expect.objectContaining({ tag: '@Docs' })] },
    })
  })

  it('reads workspace context and production tasks through existing services', async () => {
    await expect(
      executeContextTool(buildContext(), { name: 'search_workspace', input: {} })
    ).resolves.toMatchObject({
      success: true,
      output: { content: 'workspace has workflow and files' },
    })

    await expect(
      executeContextTool(buildContext(), { name: 'read_tasks', input: {} })
    ).resolves.toMatchObject({
      success: true,
      output: {
        tasks: [
          expect.objectContaining({
            id: 'task-1',
            title: '补齐视频节点',
            assigneeWorkgroup: '视频组',
          }),
        ],
      },
    })

    expect(mockGenerateWorkspaceContext).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mockListProductionTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        scope: 'auto',
      })
    )
  })

  it('materializes attached files and updates or submits production tasks through existing services', async () => {
    await expect(
      executeContextTool(buildContext(), {
        name: 'materialize_file',
        input: { fileName: 'brief.pdf', operation: 'save' },
      })
    ).resolves.toMatchObject({
      success: true,
      output: { resources: [expect.objectContaining({ title: 'brief.pdf' })] },
    })

    await expect(
      executeContextTool(buildContext(), {
        name: 'update_task_result',
        input: { taskId: 'task-1', status: 'in_progress' },
      })
    ).resolves.toMatchObject({
      success: true,
      output: { task: expect.objectContaining({ id: 'task-1', status: 'in_progress' }) },
    })

    await expect(
      executeContextTool(
        { ...buildContext(), selectedNodeIds: ['text-1'] },
        {
          name: 'submit_task_result',
          input: { taskId: 'task-1', submissionNote: '提交当前节点' },
        }
      )
    ).resolves.toMatchObject({
      success: true,
      output: { task: expect.objectContaining({ id: 'task-1', status: 'submitted' }) },
    })

    expect(mockExecuteMaterializeFile).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'brief.pdf', operation: 'save' }),
      expect.objectContaining({ userId: 'user-1', workspaceId: 'workspace-1', chatId: undefined })
    )
    expect(mockUpdateProductionTask).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', taskId: 'task-1', status: 'in_progress' })
    )
    expect(mockSubmitProductionTask).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        taskId: 'task-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        nodeId: 'text-1',
      })
    )
  })
})
