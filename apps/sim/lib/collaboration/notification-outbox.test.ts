/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueueOutboxEvent, mockLoggerInfo, mockSecureFetchWithValidation } = vi.hoisted(
  () => ({
    mockEnqueueOutboxEvent: vi.fn(async () => 'outbox-event-1'),
    mockLoggerInfo: vi.fn(),
    mockSecureFetchWithValidation: vi.fn(async () => ({
      ok: true,
      status: 202,
      text: async () => '',
    })),
  })
)

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ info: mockLoggerInfo, warn: vi.fn(), error: vi.fn() }),
}))
vi.mock('@/lib/core/outbox/service', () => ({
  enqueueOutboxEvent: mockEnqueueOutboxEvent,
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithValidation: mockSecureFetchWithValidation,
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

  it('posts webhook publication notification deliveries through SSRF-safe fetch', async () => {
    const handler =
      collaborationNotificationOutboxHandlers[
        COLLABORATION_NOTIFICATION_OUTBOX_EVENTS.PUBLICATION_REVIEW_DIGEST
      ]
    const webhookPayload = {
      ...payload,
      channel: 'webhook' as const,
      webhookUrl: 'https://hooks.example.com/publication-review',
    }

    await expect(
      handler(webhookPayload, {
        eventId: 'outbox-event-2',
        eventType: COLLABORATION_NOTIFICATION_OUTBOX_EVENTS.PUBLICATION_REVIEW_DIGEST,
        attempts: 0,
      })
    ).resolves.toBeUndefined()

    expect(mockSecureFetchWithValidation).toHaveBeenCalledWith(
      'https://hooks.example.com/publication-review',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-sim-event': 'publication.review_notifications.digest',
          'x-sim-outbox-event-id': 'outbox-event-2',
        }),
      }),
      'webhookUrl'
    )
    const requestBody = JSON.parse(mockSecureFetchWithValidation.mock.calls[0][1].body)
    expect(requestBody).toMatchObject({
      eventId: 'outbox-event-2',
      organizationId: 'org-1',
      notificationCount: 2,
      publicationIds: ['publication-1'],
    })
  })
})
