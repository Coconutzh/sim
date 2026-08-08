import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { copySelectionContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { CopySelectionError, copyWorkflowSelection } from '@/lib/workflows/copy-selection-service'

const logger = createLogger('CopySelectionAPI')

export const POST = withRouteHandler(async (request, context) => {
  const session = await getSession()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = await parseRequest(copySelectionContract, request, context)
  if (!parsed.success) return parsed.response

  try {
    const result = await copyWorkflowSelection({
      actorUserId: session.user.id,
      sourceWorkflowId: parsed.data.params.id,
      body: parsed.data.body,
    })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof CopySelectionError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error('Failed to copy selection', error)
    return NextResponse.json({ error: 'Failed to copy selection' }, { status: 500 })
  }
})
