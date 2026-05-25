/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { executeMaterializeFile } from './materialize-file'

describe('executeMaterializeFile', () => {
  it('returns canvas context wording when chat exists but workspaceId is missing', async () => {
    const result = await executeMaterializeFile(
      { fileName: 'draft.json' },
      { userId: 'user-1', workflowId: 'wf-1', chatId: 'chat-1' }
    )

    expect(result).toEqual({
      success: false,
      error: 'No canvas context available for materialize_file',
    })
  })
})
