/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalAgentContext } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const {
  mockExecuteMaterializeFile,
  mockAnalyzeAttachmentVision,
  mockGenerateWorkspaceContext,
  mockGetOrMaterializeVFS,
  mockListProductionTasks,
  mockReadFileContent,
  mockSubmitProductionTask,
  mockUpdateProductionTask,
} = vi.hoisted(() => ({
  mockExecuteMaterializeFile: vi.fn(),
  mockAnalyzeAttachmentVision: vi.fn(),
  mockGenerateWorkspaceContext: vi.fn(),
  mockGetOrMaterializeVFS: vi.fn(),
  mockListProductionTasks: vi.fn(),
  mockReadFileContent: vi.fn(),
  mockSubmitProductionTask: vi.fn(),
  mockUpdateProductionTask: vi.fn(),
}))

vi.mock('@/lib/copilot/chat/workspace-context', () => ({
  generateWorkspaceContext: mockGenerateWorkspaceContext,
}))

vi.mock('@/lib/copilot/request/lifecycle/local-canvas-agent/attachment-vision', () => ({
  analyzeAttachmentVision: mockAnalyzeAttachmentVision,
}))

vi.mock('@/lib/copilot/tools/handlers/materialize-file', () => ({
  executeMaterializeFile: mockExecuteMaterializeFile,
}))

vi.mock('@/lib/copilot/vfs', () => ({
  getOrMaterializeVFS: mockGetOrMaterializeVFS,
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
        content: [
          'Brief content for the spring launch visual direction.',
          'storageKey=uploads/private/brief.pdf',
          'url=https://storage.example.test/private/brief.pdf',
          'path=/api/files/serve/uploads/private/brief.pdf?context=workspace',
          '-----BEGIN PRIVATE KEY-----',
          'secret',
          '-----END PRIVATE KEY-----',
        ].join('\n'),
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
    mockAnalyzeAttachmentVision.mockResolvedValue({
      contexts: [],
      limitations: [],
      analyzedFileCount: 0,
      analyzedImageCount: 0,
    })
    mockReadFileContent.mockResolvedValue({
      content: 'Parsed workspace file content from the PDF.',
      totalLines: 1,
    })
    mockGetOrMaterializeVFS.mockResolvedValue({ readFileContent: mockReadFileContent })
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
    expect(JSON.stringify(result.output)).not.toContain('uploads/private')
    expect(JSON.stringify(result.output)).not.toContain('https://storage.example.test')
    expect(JSON.stringify(result.output)).not.toContain('/api/files/serve')
    expect(JSON.stringify(result.output)).not.toContain('BEGIN PRIVATE KEY')
    expect(JSON.stringify(result.output)).toContain('[redacted]')
  })

  it('matches attached file context when the query contains the file name in a sentence', async () => {
    const result = await executeContextTool(buildContext(), {
      name: 'read_file',
      input: { query: 'Read the attached file brief.pdf and report only safe metadata.' },
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
    expect(JSON.stringify(result.output)).not.toContain('BEGIN PRIVATE KEY')
  })

  it('falls back to VFS parsing for workspace file attachments without preloaded context', async () => {
    const context = buildContext()
    context.attachedContexts = []
    context.attachments = [
      {
        id: 'workspace-file-1',
        key: 'workspace/workspace-1/brief.pdf',
        name: 'brief.pdf',
        type: 'application/pdf',
        storageContext: 'workspace',
      },
    ]

    const result = await executeContextTool(context, {
      name: 'read_file',
      input: { fileName: 'brief.pdf' },
    })

    expect(result.success).toBe(true)
    expect(result.summary).toBe('Read 1 attached file context(s)')
    expect(mockGetOrMaterializeVFS).toHaveBeenCalledWith('workspace-1', 'user-1')
    expect(mockReadFileContent).toHaveBeenCalledWith('files/by-id/workspace-file-1')
    expect(result.output).toEqual(
      expect.objectContaining({
        contexts: [
          expect.objectContaining({
            tag: '@brief.pdf',
            content: expect.stringContaining('Parsed workspace file content'),
          }),
        ],
      })
    )
  })

  it('adds visual analysis context when read_file matches a visual workspace attachment', async () => {
    const context = buildContext()
    context.attachedContexts = []
    context.attachments = [
      {
        id: 'workspace-file-1',
        key: 'workspace/workspace-1/hero.png',
        name: 'hero.png',
        type: 'image/png',
        storageContext: 'workspace',
      },
    ]
    mockAnalyzeAttachmentVision.mockResolvedValue({
      contexts: [
        {
          type: 'file_vision',
          tag: '@hero.png',
          content: '画面中有蓝色主视觉和标题文字。',
        },
      ],
      limitations: [],
      analyzedFileCount: 1,
      analyzedImageCount: 1,
    })

    const result = await executeContextTool(context, {
      name: 'read_file',
      input: { fileName: 'hero.png' },
    })

    expect(result.success).toBe(true)
    expect(result.summary).toBe('Read 2 attached file context(s), including visual analysis')
    expect(mockAnalyzeAttachmentVision).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ workspaceId: 'workspace-1' }),
        fileName: 'hero.png',
      })
    )
    expect(result.output).toEqual(
      expect.objectContaining({
        contexts: expect.arrayContaining([
          expect.objectContaining({
            type: 'file_vision',
            tag: '@hero.png',
            content: expect.stringContaining('蓝色主视觉'),
          }),
        ]),
      })
    )
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
