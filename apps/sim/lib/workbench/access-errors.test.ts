/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { ApiClientError } from '@/lib/api/client/errors'
import { getWorkbenchAccessIssue } from '@/lib/workbench/access-errors'

describe('getWorkbenchAccessIssue', () => {
  it('turns forbidden API errors into a permission explanation', () => {
    const issue = getWorkbenchAccessIssue(
      new ApiClientError({
        status: 403,
        message: 'Access denied',
        body: { error: 'Access denied' },
      })
    )

    expect(issue).toMatchObject({
      title: '你没有权限访问这个画布',
      message: 'Access denied',
      actionHref: '/workbench',
    })
  })

  it('turns not found API errors into an active workgroup explanation', () => {
    const issue = getWorkbenchAccessIssue(
      new ApiClientError({
        status: 404,
        message: 'Workspace not found',
        body: { error: 'Workspace not found' },
      })
    )

    expect(issue).toMatchObject({
      title: '当前团队或画布不可用',
      actionHref: '/workbench',
    })
  })
})
