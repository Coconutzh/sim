import { db } from '@sim/db'
import { platformProviderApiKey } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { desc, eq, sql } from 'drizzle-orm'
import { decryptSecret } from '@/lib/core/security/encryption'

const logger = createLogger('PlatformProviderKeys')

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '*'.repeat(8)
  if (key.length <= 12) return `${key.slice(0, 4)}...${key.slice(-4)}`
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

export interface PlatformProviderKeyResult {
  apiKey: string
  keyId: string
  source: 'platform-provider-key'
}

export interface PlatformProviderKeyCandidate extends PlatformProviderKeyResult {
  priority: number
  isDefault: boolean
}

/** Returns active keys in primary-to-backup order for provider failover. */
export async function getPlatformProviderApiKeys(
  providerId: string
): Promise<PlatformProviderKeyCandidate[]> {
  try {
    const rows = await db
      .select({
        id: platformProviderApiKey.id,
        encryptedApiKey: platformProviderApiKey.encryptedApiKey,
        priority: platformProviderApiKey.priority,
        isDefault: platformProviderApiKey.isDefault,
      })
      .from(platformProviderApiKey)
      .where(
        sql`${platformProviderApiKey.providerId} = ${providerId} AND ${platformProviderApiKey.status} = 'active'`
      )
      .orderBy(desc(platformProviderApiKey.isDefault), desc(platformProviderApiKey.priority))
    return Promise.all(
      rows.map(async (row) => ({
        apiKey: (await decryptSecret(row.encryptedApiKey)).decrypted,
        keyId: row.id,
        source: 'platform-provider-key' as const,
        priority: row.priority,
        isDefault: row.isDefault,
      }))
    )
  } catch (error) {
    logger.error('Failed to resolve platform provider keys', { providerId, error })
    return []
  }
}

export async function getPlatformProviderApiKey(
  providerId: string
): Promise<PlatformProviderKeyResult | null> {
  try {
    const [row] = await getPlatformProviderApiKeys(providerId)
    if (!row) return null

    db.update(platformProviderApiKey)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(platformProviderApiKey.id, row.keyId))
      .catch((error) => {
        logger.warn('Failed to update platform provider key lastUsedAt', {
          keyId: row.keyId,
          providerId,
          error,
        })
      })

    return { apiKey: row.apiKey, keyId: row.keyId, source: 'platform-provider-key' }
  } catch (error) {
    logger.error('Failed to resolve platform provider key', { providerId, error })
    return null
  }
}
