import { db } from '@sim/db'
import { adminConsoleAuditLog } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'

const logger = createLogger('AdminConsoleAudit')

type AuditSnapshot = Record<
  string,
  string | number | boolean | null | Array<string | number | boolean | null>
>

export interface RecordAdminConsoleAuditParams {
  actorUserId: string
  targetType: string
  targetId?: string | null
  action: string
  reason?: string | null
  before?: AuditSnapshot | null
  after?: AuditSnapshot | null
}

export async function recordAdminConsoleAudit(
  params: RecordAdminConsoleAuditParams
): Promise<void> {
  try {
    await db.insert(adminConsoleAuditLog).values({
      id: generateShortId(),
      actorUserId: params.actorUserId,
      targetType: params.targetType,
      targetId: params.targetId ?? null,
      action: params.action,
      reason: params.reason ?? null,
      before: params.before ?? null,
      after: params.after ?? null,
    })
  } catch (error) {
    logger.warn('Failed to record admin console audit event', {
      actorUserId: params.actorUserId,
      targetType: params.targetType,
      targetId: params.targetId,
      action: params.action,
      error,
    })
  }
}
