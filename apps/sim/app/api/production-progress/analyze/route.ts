import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { analyzeProductionProgressContract } from '@/lib/api/contracts/production-progress-analysis'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { analyzeProductionProgress } from '@/lib/production-progress/analyzer'
import { productionTaskErrorResponse } from '@/app/api/production-tasks/_utils'

const logger = createLogger('ProductionProgressAnalysisAPI')

export const POST = withRouteHandler(async (request) => {
  const session = await getSession()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = await parseRequest(analyzeProductionProgressContract, request, {})
  if (!parsed.success) return parsed.response

  try {
    const analysis = await analyzeProductionProgress({
      userId,
      projects: parsed.data.body.projects,
      question: parsed.data.body.question,
      history: parsed.data.body.history,
      focusTaskId: parsed.data.body.focusTaskId,
      signal: request.signal,
    })
    return NextResponse.json({ analysis })
  } catch (error) {
    return productionTaskErrorResponse(logger, 'Failed to analyze production progress', error)
  }
})
