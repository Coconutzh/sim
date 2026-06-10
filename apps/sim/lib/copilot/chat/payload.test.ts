/**
 * @vitest-environment node
 */
import { featureFlagsMock, workflowsUtilsMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateUserToolSchema, mockGetHighestPrioritySubscription, mockTrackChatUpload } =
  vi.hoisted(() => ({
    mockCreateUserToolSchema: vi.fn(() => ({ type: 'object', properties: {} })),
    mockGetHighestPrioritySubscription: vi.fn(),
    mockTrackChatUpload: vi.fn(),
  }))

vi.mock('@/lib/billing/core/subscription', () => ({
  getHighestPrioritySubscription: mockGetHighestPrioritySubscription,
}))

vi.mock('@/lib/billing/plan-helpers', () => ({
  isPaid: vi.fn(
    (plan: string | null) => plan === 'pro' || plan === 'team' || plan === 'enterprise'
  ),
}))

vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)

vi.mock('@/lib/mcp/utils', () => ({
  createMcpToolId: vi.fn(),
}))

vi.mock('@/lib/workflows/utils', () => workflowsUtilsMock)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  trackChatUpload: mockTrackChatUpload,
}))

vi.mock('@/tools/registry', () => ({
  tools: {
    gmail_send: {
      id: 'gmail_send',
      name: 'Gmail Send',
      description: 'Send emails using Gmail',
    },
    brandfetch_search: {
      id: 'brandfetch_search',
      name: 'Brandfetch Search',
      description: 'Search for brands by company name',
    },
    // Catalog marks run_workflow as client-routed / clientExecutable; registry ToolConfig has no routing fields.
    run_workflow: {
      id: 'run_workflow',
      name: 'Run Workflow',
      description: 'Run a workflow from the client',
    },
  },
}))

vi.mock('@/tools/catalog', () => ({
  toolCatalog: {
    gmail_send: {
      id: 'gmail_send',
      name: 'Gmail Send',
      description: 'Send emails using Gmail',
    },
    brandfetch_search: {
      id: 'brandfetch_search',
      name: 'Brandfetch Search',
      description: 'Search for brands by company name',
    },
    run_workflow: {
      id: 'run_workflow',
      name: 'Run Workflow',
      description: 'Run a workflow from the client',
    },
  },
}))

vi.mock('@/tools/utils', () => ({
  getLatestVersionTools: vi.fn((input) => input),
  stripVersionSuffix: vi.fn((toolId: string) => toolId),
}))

vi.mock('@/tools/params', () => ({
  createUserToolSchema: mockCreateUserToolSchema,
}))

import { buildCopilotRequestPayload, buildIntegrationToolSchemas } from './payload'

describe('buildIntegrationToolSchemas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateUserToolSchema.mockReturnValue({ type: 'object', properties: {} })
  })

  it('appends the email footer prompt for free users', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue(null)

    const toolSchemas = await buildIntegrationToolSchemas('user-free')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')

    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledWith('user-free')
    expect(gmailTool?.description).toContain('sent with sim ai')
  })

  it('does not append the email footer prompt for paid users', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })

    const toolSchemas = await buildIntegrationToolSchemas('user-paid')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')

    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledWith('user-paid')
    expect(gmailTool?.description).toBe('Send emails using Gmail')
  })

  it('still builds integration tools when subscription lookup fails', async () => {
    mockGetHighestPrioritySubscription.mockRejectedValue(new Error('db unavailable'))

    const toolSchemas = await buildIntegrationToolSchemas('user-error')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')
    const brandfetchTool = toolSchemas.find((tool) => tool.name === 'brandfetch_search')

    expect(mockGetHighestPrioritySubscription).toHaveBeenCalledWith('user-error')
    expect(gmailTool?.description).toBe('Send emails using Gmail')
    expect(brandfetchTool?.description).toBe('Search for brands by company name')
  })

  it('emits executeLocally for dynamic client tools only', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })

    const toolSchemas = await buildIntegrationToolSchemas('user-client')
    const gmailTool = toolSchemas.find((tool) => tool.name === 'gmail_send')
    const runTool = toolSchemas.find((tool) => tool.name === 'run_workflow')

    expect(gmailTool?.executeLocally).toBe(false)
    expect(runTool?.executeLocally).toBe(true)
  })

  it('uses copilot-facing file schemas for integration tools', async () => {
    mockGetHighestPrioritySubscription.mockResolvedValue({ plan: 'pro', status: 'active' })

    await buildIntegrationToolSchemas('user-copilot')

    expect(mockCreateUserToolSchema).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'gmail_send' }),
      { surface: 'copilot' }
    )
    expect(mockCreateUserToolSchema).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'brandfetch_search' }),
      { surface: 'copilot' }
    )
  })
})

describe('buildCopilotRequestPayload file attachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps workspace file attachments and adds readable file context without chat-scoping them', async () => {
    const payload = await buildCopilotRequestPayload(
      {
        message: 'Summarize this',
        workspaceId: 'ws-1',
        userId: 'user-1',
        userMessageId: 'msg-1',
        mode: 'chat',
        model: 'model-1',
        chatId: 'chat-1',
        fileAttachments: [
          {
            id: 'attachment-1',
            workspaceFileId: 'wf_123',
            key: 'workspace/ws-1/brief.pdf',
            filename: 'brief.pdf',
            media_type: 'application/pdf',
            size: 1234,
            path: '/api/files/serve/workspace%2Fws-1%2Fbrief.pdf?context=workspace',
            storageContext: 'workspace',
          },
        ],
      },
      { selectedModel: 'model-1' }
    )

    expect(mockTrackChatUpload).not.toHaveBeenCalled()
    expect(payload.fileAttachments).toEqual([
      expect.objectContaining({
        workspaceFileId: 'wf_123',
        key: 'workspace/ws-1/brief.pdf',
        filename: 'brief.pdf',
      }),
    ])
    expect(payload.context).toEqual([
      expect.objectContaining({
        type: 'workspace_file_attachment',
        content: expect.stringContaining('read("files/by-id/wf_123")'),
      }),
    ])
  })
})
