import type { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import {
  enqueueOutboxEvent,
  type OutboxHandler,
  type OutboxHandlerRegistry,
} from '@/lib/core/outbox/service'

const logger = createLogger('CollaborationNotificationOutbox')

export const COLLABORATION_NOTIFICATION_OUTBOX_EVENTS = {
  PUBLICATION_REVIEW_DIGEST: 'collaboration.publication-review-digest',
} as const

const publicationNotificationChannelSchema = z.enum(['in_app', 'email', 'webhook'])

const publicationNotificationPayloadSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  actorUserId: z.string().min(1),
  channel: publicationNotificationChannelSchema,
  event: z.literal('publication.review_notifications.digest'),
  projectName: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  body: z.string(),
  notificationCount: z.number().int().min(0),
  dangerCount: z.number().int().min(0),
  warningCount: z.number().int().min(0),
  publicationIds: z.array(z.string().min(1)),
  notifications: z.array(
    z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      severity: z.enum(['warning', 'danger']),
      publicationId: z.string().min(1),
      publicationTitle: z.string().min(1),
      publicationWorkgroupName: z.string().min(1),
      reviewerUserId: z.string().nullable(),
      actionLabel: z.string().min(1),
    })
  ),
  enqueuedAt: z.string().min(1),
})

export type PublicationNotificationOutboxPayload = z.output<
  typeof publicationNotificationPayloadSchema
>

export async function enqueuePublicationNotificationDelivery(
  executor: Pick<typeof db, 'insert'>,
  payload: PublicationNotificationOutboxPayload
): Promise<string> {
  return enqueueOutboxEvent(
    executor,
    COLLABORATION_NOTIFICATION_OUTBOX_EVENTS.PUBLICATION_REVIEW_DIGEST,
    payload,
    { maxAttempts: 5 }
  )
}

const publicationReviewDigestHandler: OutboxHandler<unknown> = async (payload, context) => {
  const parsed = publicationNotificationPayloadSchema.parse(payload)

  logger.info('Completed publication review digest outbox delivery record', {
    eventId: context.eventId,
    organizationId: parsed.organizationId,
    channel: parsed.channel,
    notificationCount: parsed.notificationCount,
    dangerCount: parsed.dangerCount,
    warningCount: parsed.warningCount,
  })
}

export const collaborationNotificationOutboxHandlers: OutboxHandlerRegistry = {
  [COLLABORATION_NOTIFICATION_OUTBOX_EVENTS.PUBLICATION_REVIEW_DIGEST]:
    publicationReviewDigestHandler,
}
