/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { canHydrateWorkflowInWorkspace, getWorkflowWorkspaceScopeError } from './workspace-scope'

describe('workflow registry workspace scope', () => {
  it('only allows hydration when the workflow belongs to the active workspace', () => {
    expect(canHydrateWorkflowInWorkspace('ws-1', 'ws-1')).toBe(true)
    expect(canHydrateWorkflowInWorkspace('ws-2', 'ws-1')).toBe(false)
    expect(canHydrateWorkflowInWorkspace(null, 'ws-1')).toBe(false)
  })

  it('explains when a workflow has no editable workspace scope', () => {
    expect(getWorkflowWorkspaceScopeError('wf-1', null, 'ws-1')).toBe(
      'Workflow wf-1 is not editable in workspace ws-1'
    )
  })

  it('explains when a workflow belongs to another workspace', () => {
    expect(getWorkflowWorkspaceScopeError('wf-1', 'ws-2', 'ws-1')).toBe(
      'Workflow wf-1 belongs to workspace ws-2, not ws-1'
    )
  })
})
