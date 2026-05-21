/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryClient } = vi.hoisted(() => ({
  queryClient: {
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: {},
  useMutation: vi.fn((options) => options),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => queryClient),
}))

import { collaborationKeys, useSetActiveWorkgroup } from '@/hooks/queries/collaboration'

describe('collaboration query invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('targets active-workgroup dependent query families after switching teams', async () => {
    const mutation = useSetActiveWorkgroup() as {
      onSettled: () => Promise<unknown>
    }

    await mutation.onSettled()

    expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(4)
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: collaborationKeys.myWorkgroups(),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: collaborationKeys.workgroupDetails(),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: collaborationKeys.publicationLists(),
    })
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: collaborationKeys.agentProfiles(),
    })
    expect(queryClient.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: collaborationKeys.all,
    })
  })
})
