import type { Logger } from '@sim/logger'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { ProductionTaskServiceError } from '@/lib/production-tasks/service'

export async function getProductionTaskSessionUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user?.id ?? null
}

export function productionTaskErrorResponse(
  logger: Logger,
  message: string,
  error: unknown
): NextResponse {
  if (error instanceof ProductionTaskServiceError) {
    logger.warn(message, { error: error.message, status: error.status })
    return NextResponse.json({ error: error.message }, { status: error.status })
  }

  logger.error(message, error)
  return NextResponse.json({ error: 'Unable to process production task request' }, { status: 500 })
}
