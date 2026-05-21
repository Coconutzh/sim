import { createLogger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { listDisciplinesContract } from '@/lib/api/contracts/collaboration'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listDisciplines } from '@/lib/collaboration/service'

const logger = createLogger('DisciplinesAPI')

export const GET = withRouteHandler(async (request) => {
  const parsed = await parseRequest(listDisciplinesContract, request, {})
  if (!parsed.success) return parsed.response
  try {
    const rows = await listDisciplines()
    return NextResponse.json({
      disciplines: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        agentCode: row.agentCode,
        sortOrder: row.sortOrder,
      })),
    })
  } catch (error) {
    logger.error('Failed to list disciplines', error)
    return NextResponse.json({ error: 'Failed to list disciplines' }, { status: 500 })
  }
})
