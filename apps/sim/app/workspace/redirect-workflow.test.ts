/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getWorkflowRedirectPath } from '@/app/workspace/redirect-workflow'

describe('getWorkflowRedirectPath', () => {
  it('routes workspace-scoped workflows to their owning workspace editor', () => {
    expect(
      getWorkflowRedirectPath({
        workflowId: 'workflow-1',
        fallbackWorkspaceId: 'workspace-fallback',
        workflow: {
          workspaceId: 'workspace-owner',
          state: { blocks: {}, edges: [], loops: {}, parallels: {} },
        },
      })
    ).toBe('/workspace/workspace-owner/w/workflow-1')
  })

  it('routes published summaries into the current workspace published shell', () => {
    expect(
      getWorkflowRedirectPath({
        workflowId: 'workflow-2',
        fallbackWorkspaceId: 'workspace-fallback',
        workflow: {
          workspaceId: null,
          state: {
            blocks: {},
            edges: [],
            loops: {},
            parallels: {},
            metadata: { accessScope: 'published_summary' },
          },
        },
      })
    ).toBe('/workspace/workspace-fallback/published/workflow-2')
  })

  it('falls back to the workspace home route when no safe workflow shell is available', () => {
    expect(
      getWorkflowRedirectPath({
        workflowId: 'workflow-3',
        fallbackWorkspaceId: 'workspace-fallback',
        workflow: {
          workspaceId: null,
          state: { blocks: {}, edges: [], loops: {}, parallels: {} },
        },
      })
    ).toBe('/workspace/workspace-fallback/home')
  })
})
