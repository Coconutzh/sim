/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  mapPublishedWorkflowCatalogItem,
  type PublishedWorkflowView,
} from '@/hooks/queries/workflows'

describe('mapPublishedWorkflowCatalogItem', () => {
  it('converts published workflow catalog timestamps into Date objects', () => {
    const mapped: PublishedWorkflowView = mapPublishedWorkflowCatalogItem({
      id: 'published-1',
      name: 'Shared workflow',
      description: null,
      color: '#3972F6',
      track: 'published',
      visibility: 'organization',
      publishedAt: '2026-05-21T00:00:00.000Z',
      workspaceName: 'Team Alpha',
    })

    expect(mapped.description).toBeUndefined()
    expect(mapped.publishedAt).toBeInstanceOf(Date)
    expect(mapped.publishedAt?.toISOString()).toBe('2026-05-21T00:00:00.000Z')
  })
})
