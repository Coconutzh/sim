import { db } from '@sim/db'
import { dataDrainRuns } from '@sim/db/schema'
import { desc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { listDataDrainRunsContract } from '@/lib/api/contracts/data-drains'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authorizeDrainAccess, loadDrain } from '@/lib/data-drains/access'
import { serializeDrainRun } from '@/lib/data-drains/serializers'

const DEFAULT_LIMIT = 25

type RouteContext = { params: Promise<{ id: string; drainId: string }> }

export const GET = withRouteHandler(async (request: NextRequest, context: RouteContext) => {
  const authSession = await getSession()
  if (!authSession?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = await parseRequest(listDataDrainRunsContract, request, context)
  if (!parsed.success) return parsed.response
  const { id: organizationId, drainId } = parsed.data.params

  const access = await authorizeDrainAccess(organizationId, { requireMutating: false })
  if (!access.ok) return access.response

  const drain = await loadDrain(organizationId, drainId)
  if (!drain) {
    return NextResponse.json({ error: 'Data drain not found' }, { status: 404 })
  }

  const limit = parsed.data.query?.limit ?? DEFAULT_LIMIT
  const runs = await db
    .select()
    .from(dataDrainRuns)
    .where(eq(dataDrainRuns.drainId, drainId))
    .orderBy(desc(dataDrainRuns.startedAt))
    .limit(limit)

  return NextResponse.json({ runs: runs.map(serializeDrainRun) })
})
