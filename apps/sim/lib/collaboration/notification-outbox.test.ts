/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueueOutboxEvent, mockLoggerInfo } = vi.hoisted(() => ({
  mockEnqueueOutboxEvent: vi.fn(async () => 'outbox-event-1'),
  mockLoggerInfo: vi.fn(),
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: mockLoggerInfo, warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: mockEnqueueOutboxEvent,
}))

import {
  COLLABORATION_NOTIFICATION_OUTBOX_EVENTS,
  collaborationNotificationOutboxHandlers,
  enqueuePublicationNotificationDelivery,
  type PublicationNotificationOutboxPayload,
} from '@/lib/collaboration/notification-outbox'

const payload: PublicationNotificationOutboxPayload = {
  id: 'publication-review-email-digest',
  organizationId: 'org-1',
  actorUserId: 'admin-1',
  channel: 'email',
  event: 'publication.review_notifications.digest',
  projectName: 'Opening Night',
  title: 'Email digest draft',
  detail: 'Copy a reviewer-ready digest for an email delivery channel.',
  body: 'Digest body',
  notificationCount: 2,
  dangerCount: 1,
  warningCount: 1,
  publicationIds: ['publication-1'],
  notifications: [
    {
      id: 'publication-1:review_state',
      type: 'review_state',
      severity: 'danger',
      publicationId: 'publication-1',
      publicationTitle: 'Lighting current',
      publicationWorkgroupName: 'Lighting',
      reviewerUserId: null,
      actionLabel: 'Start review',
    },
  ],
  enqueuedAt: '2026-05-25T00:00:00.000Z',
}

describe('collaboration notification outbox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists publication notification delivery payloads in the outbox', async () => {
    const executor = { insert: vi.fn() }

    await expect(enqueuePublicationNotificationDelivery(executor, payload)).resolves.toBe(
      'outbox-event-1'
    )

    expect(mockEnqueueOutboxEvent).toHaveBeenCalledWith(
      executor,
      COLLABORATION_NOTIFICATION_OUTBOX_EVENTS.PUBLICATION_REVIEW_DIGEST,
      payload,
      { maxAttempts: 5 }
    )
  })

  it('validates and completes publication notification delivery records', async () => {
    const handler =
      collaborationNotificationOutboxHandlers[
        COLLABORATION_NOTIFICATION_OUTBOX_EVENTS.PUBLICATION_REVIEW_DIGEST
      ]

    await expect(
      handler(payload, {
        eventId: 'outbox-event-1',
        eventType: COLLABORATION_NOTIFICATION_OUTBOX_EVENTS.PUBLICATION_REVIEW_DIGEST,
        attempts: 0,
      })
    ).resolves.toBeUndefined()

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      'Completed publication review digest outbox delivery record',
      expect.objectContaining({
        eventId: 'outbox-event-1',
        organizationId: 'org-1',
        channel: 'email',
        notificationCount: 2,
      })
    )
  })
})
