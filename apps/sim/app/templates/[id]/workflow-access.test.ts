/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  canOpenWorkflowInWorkspace,
  getWorkflowProbeWorkspaceId,
  hasWorkflowWorkspaceAccess,
} from './workflow-access'

describe('workflow-access', () => {
  it('returns null when the workflow probe payload has no workspace id', () => {
    expect(getWorkflowProbeWorkspaceId({ data: { workspaceId: null } })).toBeNull()
    expect(getWorkflowProbeWorkspaceId({ data: {} })).toBeNull()
    expect(getWorkflowProbeWorkspaceId(null)).toBeNull()
  })

  it('treats a missing workspace id as no editable workspace access', () => {
    expect(hasWorkflowWorkspaceAccess({ data: { workspaceId: null } })).toBe(false)
  })

  it('only opens the workflow directly when the probe matches the current workspace', () => {
    const payload = { data: { workspaceId: 'ws-1' } }

    expect(hasWorkflowWorkspaceAccess(payload)).toBe(true)
    expect(canOpenWorkflowInWorkspace(payload, 'ws-1')).toBe(true)
    expect(canOpenWorkflowInWorkspace(payload, 'ws-2')).toBe(false)
  })
})
