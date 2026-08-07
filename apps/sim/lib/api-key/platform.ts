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

export async function getPlatformProviderApiKey(
  providerId: string
): Promise<PlatformProviderKeyResult | null> {
  try {
    const [row] = await db
      .select({
        id: platformProviderApiKey.id,
        encryptedApiKey: platformProviderApiKey.encryptedApiKey,
      })
      .from(platformProviderApiKey)
      .where(
        sql`${platformProviderApiKey.providerId} = ${providerId} AND ${platformProviderApiKey.status} = 'active'`
      )
      .orderBy(desc(platformProviderApiKey.isDefault), desc(platformProviderApiKey.priority))
      .limit(1)

    if (!row) return null

    const { decrypted } = await decryptSecret(row.encryptedApiKey)

    db.update(platformProviderApiKey)
      .set({ lastUsedAt: new Date(), updatedAt: new Date() })
      .where(eq(platformProviderApiKey.id, row.id))
      .catch((error) => {
        logger.warn('Failed to update platform provider key lastUsedAt', {
          keyId: row.id,
          providerId,
          error,
        })
      })

    return { apiKey: decrypted, keyId: row.id, source: 'platform-provider-key' }
  } catch (error) {
    logger.error('Failed to resolve platform provider key', { providerId, error })
    return null
  }
}
