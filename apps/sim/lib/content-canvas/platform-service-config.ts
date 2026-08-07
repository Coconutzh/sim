import { db, platformModelServiceConfig } from '@sim/db'
import { and, desc, eq } from 'drizzle-orm'
import { getPlatformProviderApiKey } from '@/lib/api-key/platform'
import type { ContentCapability, ContentModelFamily, ContentServiceKind } from '@/lib/content-canvas/model-catalog'

export interface PlatformContentServiceConfig {
  kind: ContentServiceKind
  baseUrl?: string
  apiKey: string
  modelId: string
  providerId: string
}

/** Resolves the administrator-managed service before legacy environment fallback. */
export async function getPlatformContentServiceConfig(params: {
  capability: ContentCapability
  family: ContentModelFamily
  modelId: string
}): Promise<PlatformContentServiceConfig | null> {
  const [service] = await db
    .select()
    .from(platformModelServiceConfig)
    .where(
      and(
        eq(platformModelServiceConfig.consumer, 'sim-canvas'),
        eq(platformModelServiceConfig.capability, params.capability),
        eq(platformModelServiceConfig.family, params.family),
        eq(platformModelServiceConfig.status, 'active')
      )
    )
    .orderBy(desc(platformModelServiceConfig.priority))
    .limit(1)
  if (!service || !Array.isArray(service.enabledModelIds) || !service.enabledModelIds.includes(params.modelId)) {
    return null
  }
  const key = await getPlatformProviderApiKey(service.providerId)
  if (!key) return null
  return {
    kind: service.serviceKind as ContentServiceKind,
    baseUrl: service.baseUrl ?? undefined,
    apiKey: key.apiKey,
    modelId: params.modelId,
    providerId: service.providerId,
  }
}
