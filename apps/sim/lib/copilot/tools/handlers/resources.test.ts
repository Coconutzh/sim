/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getKnowledgeBaseByIdMock,
  getLogByIdMock,
  getTableByIdMock,
  getWorkflowByIdMock,
  getWorkspaceFileMock,
} = vi.hoisted(() => ({
  getKnowledgeBaseByIdMock: vi.fn(),
  getLogByIdMock: vi.fn(),
  getTableByIdMock: vi.fn(),
  getWorkflowByIdMock: vi.fn(),
  getWorkspaceFileMock: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {},
}))

vi.mock('@sim/db/schema', () => ({}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  getWorkspaceFile: getWorkspaceFileMock,
}))

vi.mock('@/lib/workflows/utils', () => ({
  getWorkflowById: getWorkflowByIdMock,
}))

vi.mock('@/lib/table/service', () => ({
  getTableById: getTableByIdMock,
}))

vi.mock('@/lib/knowledge/service', () => ({
  getKnowledgeBaseById: getKnowledgeBaseByIdMock,
}))

vi.mock('@/lib/logs/service', () => ({
  getLogById: getLogByIdMock,
}))

import { executeOpenResource } from './resources'

describe('executeOpenResource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens workspace files with canonical non-UUID file ids', async () => {
    getWorkspaceFileMock.mockResolvedValue({
      id: 'wf_qL_cfff-FskMsXtOdm599',
      name: 'MAC_Brand_Guidelines_May_2021 (1).docx',
    })

    const result = await executeOpenResource(
      {
        resources: [{ type: 'file', id: 'wf_qL_cfff-FskMsXtOdm599' }],
      },
      { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'workspace-1' }
    )

    expect(getWorkspaceFileMock).toHaveBeenCalledWith('workspace-1', 'wf_qL_cfff-FskMsXtOdm599')
    expect(result).toMatchObject({
      success: true,
      output: { opened: 1, errors: [] },
      resources: [
        {
          type: 'file',
          id: 'wf_qL_cfff-FskMsXtOdm599',
          title: 'MAC_Brand_Guidelines_May_2021 (1).docx',
        },
      ],
    })
  })

  it('uses canvas wording when opening a file without canvas context', async () => {
    const result = await executeOpenResource(
      {
        resources: [{ type: 'file', id: 'wf_qL_cfff-FskMsXtOdm599' }],
      },
      { userId: 'user-1', workflowId: 'workflow-1' }
    )

    expect(result).toMatchObject({
      success: false,
      output: { opened: 0, errors: ['Opening a canvas file requires canvas context.'] },
    })
  })

  it('uses canvas wording when a file is absent from the current canvas', async () => {
    getWorkspaceFileMock.mockResolvedValue(null)

    const result = await executeOpenResource(
      {
        resources: [{ type: 'file', id: 'wf_missing' }],
      },
      { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'workspace-1' }
    )

    expect(result).toMatchObject({
      success: false,
      output: { opened: 0, errors: ['No canvas file with id "wf_missing".'] },
    })
  })

  it('uses canvas wording when resources belong to another canvas', async () => {
    getWorkflowByIdMock.mockResolvedValue({
      id: 'workflow-1',
      name: 'Foreign workflow',
      workspaceId: 'workspace-2',
    })
    getTableByIdMock.mockResolvedValue({
      id: 'table-1',
      name: 'Foreign table',
      workspaceId: 'workspace-2',
    })
    getKnowledgeBaseByIdMock.mockResolvedValue({
      id: 'knowledge-1',
      name: 'Foreign knowledge',
      workspaceId: 'workspace-2',
    })
    getLogByIdMock.mockResolvedValue({
      id: 'log-1',
      workflowName: 'Foreign workflow',
      workspaceId: 'workspace-2',
      startedAt: new Date('2026-05-25T00:00:00.000Z'),
    })

    const result = await executeOpenResource(
      {
        resources: [
          { type: 'workflow', id: 'workflow-1' },
          { type: 'table', id: 'table-1' },
          { type: 'knowledgebase', id: 'knowledge-1' },
          { type: 'log', id: 'log-1' },
        ],
      },
      { userId: 'user-1', workflowId: 'workflow-1', workspaceId: 'workspace-1' }
    )

    expect(result).toMatchObject({
      success: false,
      output: {
        opened: 0,
        errors: [
          'Workflow not found in the current canvas.',
          'Table not found in the current canvas.',
          'Knowledge base not found in the current canvas.',
          'Log not found in the current canvas.',
        ],
      },
    })
  })
})
