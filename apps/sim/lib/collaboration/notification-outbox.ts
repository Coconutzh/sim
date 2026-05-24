import type { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { z } from 'zod'
import {
  enqueueOutboxEvent,
  type OutboxHandler,
  type OutboxHandlerRegistry,
} from '@/lib/core/outbox/service'
import { secureFetchWithValidation } from '@/lib/core/security/input-validation.server'
import { sendEmail } from '@/lib/messaging/email/mailer'

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
  emailRecipients: z.array(z.string().trim().email()).min(1).max(20).optional(),
  webhookUrl: z.string().url().nullable().optional(),
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderPublicationDigestHtml(parsed: PublicationNotificationOutboxPayload): string {
  return [
    '<div>',
    `<h1>${escapeHtml(parsed.title)}</h1>`,
    `<p>${escapeHtml(parsed.detail)}</p>`,
    '<pre>',
    escapeHtml(parsed.body),
    '</pre>',
    '</div>',
  ].join('')
}

const publicationReviewDigestHandler: OutboxHandler<unknown> = async (payload, context) => {
  const parsed = publicationNotificationPayloadSchema.parse(payload)

  if (parsed.channel === 'email') {
    if (!parsed.emailRecipients || parsed.emailRecipients.length === 0) {
      throw new Error('Email delivery requires emailRecipients')
    }

    const result = await sendEmail({
      to: parsed.emailRecipients,
      subject: `Publication review digest: ${parsed.projectName}`,
      text: parsed.body,
      html: renderPublicationDigestHtml(parsed),
      emailType: 'transactional',
    })

    if (!result.success) {
      throw new Error(`Email delivery failed: ${result.message}`)
    }

    logger.info('Delivered publication review digest email', {
      eventId: context.eventId,
      organizationId: parsed.organizationId,
      recipientCount: parsed.emailRecipients.length,
      notificationCount: parsed.notificationCount,
    })
    return
  }

  if (parsed.channel === 'webhook') {
    if (!parsed.webhookUrl) {
      throw new Error('Webhook delivery requires webhookUrl')
    }

    const response = await secureFetchWithValidation(
      parsed.webhookUrl,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sim-event': parsed.event,
          'x-sim-outbox-event-id': context.eventId,
        },
        body: JSON.stringify({
          eventId: context.eventId,
          id: parsed.id,
          event: parsed.event,
          organizationId: parsed.organizationId,
          projectName: parsed.projectName,
          title: parsed.title,
          detail: parsed.detail,
          notificationCount: parsed.notificationCount,
          dangerCount: parsed.dangerCount,
          warningCount: parsed.warningCount,
          publicationIds: parsed.publicationIds,
          notifications: parsed.notifications,
          enqueuedAt: parsed.enqueuedAt,
        }),
        timeout: 10_000,
        maxResponseBytes: 16 * 1024,
      },
      'webhookUrl'
    )
    if (!response.ok) {
      const responseBody = await response.text().catch(() => '')
      const suffix = responseBody.trim() ? `: ${responseBody.slice(0, 300)}` : ''
      throw new Error(`Webhook delivery failed with status ${response.status}${suffix}`)
    }

    logger.info('Delivered publication review digest webhook', {
      eventId: context.eventId,
      organizationId: parsed.organizationId,
      notificationCount: parsed.notificationCount,
      status: response.status,
    })
    return
  }

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
