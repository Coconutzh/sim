/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { normalizeImageOutpaintFile } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/use-image-outpaint-session'

describe('normalizeImageOutpaintFile', () => {
  it('derives a storage key from an internal path when file.key is missing', () => {
    expect(
      normalizeImageOutpaintFile({
        id: 'file-1',
        name: 'source.png',
        path: '/api/files/serve/workspace%2Fws-1%2Fsource.png?context=workspace',
        size: 100,
        type: 'image/png',
      })
    ).toMatchObject({
      id: 'file-1',
      name: 'source.png',
      url: '/api/files/serve/workspace%2Fws-1%2Fsource.png?context=workspace',
      key: 'workspace/ws-1/source.png',
    })
  })
})
