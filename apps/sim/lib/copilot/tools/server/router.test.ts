/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { routeExecution } from '@/lib/copilot/tools/server/router'

describe('server tool router permissions', () => {
  it('fails closed for write tools when workspace permission is missing', async () => {
    await expect(
      routeExecution(
        'create_file',
        { fileName: 'draft.txt' },
        { userId: 'user-1', workspaceId: 'workspace-1' }
      )
    ).rejects.toThrow(
      "Permission denied: create_file requires write access. You have 'none' permission."
    )
  })

  it('checks write permissions before unwrapping nested tool args', async () => {
    await expect(
      routeExecution(
        'knowledge_base',
        { args: { operation: 'create', name: 'Production Notes' } },
        { userId: 'user-1', workspaceId: 'workspace-1', userPermission: 'read' }
      )
    ).rejects.toThrow(
      "Permission denied: 'create' on knowledge_base requires write access. You have 'read' permission."
    )
  })
})
