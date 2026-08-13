import { db, platformModelServiceConfig } from '@sim/db'
import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { and, eq } from 'drizzle-orm'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { hermesRuntimeConfigContract } from '@/lib/api/contracts/internal/hermes-runtime-config'
import { parseRequest } from '@/lib/api/server'
import { getPlatformProviderApiKey } from '@/lib/api-key/platform'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { comparePlatformProviders } from '@/lib/platform-models/catalog'

const logger = createLogger('HermesRuntimeConfigAPI')

function getServiceToken(request: NextRequest): string | null {
  const directToken = request.headers.get('x-sim-service-token')
  if (directToken) return directToken

  const authorization = request.headers.get('authorization')
  return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null
}

function isAuthorized(request: NextRequest): boolean {
  const suppliedToken = getServiceToken(request)
  return Boolean(
    env.HERMES_SERVICE_TOKEN &&
      suppliedToken &&
      safeCompare(suppliedToken, env.HERMES_SERVICE_TOKEN)
  )
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  if (!isAuthorized(request)) {
    logger.warn('Rejected unauthorized Hermes runtime configuration request', {
      hasServiceToken: Boolean(getServiceToken(request)),
    })
    return NextResponse.json({ error: 'Hermes service authentication failed' }, { status: 401 })
  }

  const parsed = await parseRequest(hermesRuntimeConfigContract, request, {})
  if (!parsed.success) return parsed.response

  const { capability, consumer, family } = parsed.data.query
  let service: typeof platformModelServiceConfig.$inferSelect | undefined
  try {
    const services = await db
      .select()
      .from(platformModelServiceConfig)
      .where(
        and(
          eq(platformModelServiceConfig.consumer, consumer),
          eq(platformModelServiceConfig.capability, capability),
          eq(platformModelServiceConfig.family, family),
          eq(platformModelServiceConfig.status, 'active')
        )
      )
    service = services.sort((left, right) =>
      comparePlatformProviders(left.providerId, right.providerId)
    )[0]
  } catch (error) {
    logger.error('Unable to load managed Hermes runtime service', {
      consumer,
      capability,
      family,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ config: null }, { status: 503 })
  }

  if (!service) return NextResponse.json({ config: null })

  const key = await getPlatformProviderApiKey(service.providerId)
  if (!key) {
    logger.warn('Hermes runtime service has no active provider key', {
      consumer,
      capability,
      family,
      providerId: service.providerId,
    })
    return NextResponse.json({ config: null })
  }

  return NextResponse.json({
    config: {
      providerId: service.providerId,
      serviceKind: service.serviceKind,
      baseUrl: service.baseUrl ?? null,
      apiKey: key.apiKey,
      enabledModelIds: service.enabledModelIds as string[],
      defaultModelId: service.defaultModelId ?? null,
      configVersion: service.configVersion,
    },
  })
})
