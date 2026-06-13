/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRunHermesSkillProposalOperation } = vi.hoisted(() => ({
  mockRunHermesSkillProposalOperation: vi.fn(),
}))

vi.mock('@/lib/core/config/env', () => ({
  env: {
    HERMES_SERVICE_TOKEN: 's'.repeat(32),
  },
}))

vi.mock('@/lib/hermes/skill-proposals', () => ({
  runHermesSkillProposalOperation: mockRunHermesSkillProposalOperation,
}))

import { POST } from '@/app/api/internal/hermes/skill-proposals/run/route'

function buildRequest(params: { body: string; token?: string }): NextRequest {
  return new NextRequest('http://localhost:3000/api/internal/hermes/skill-proposals/run', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(params.token ? { 'x-sim-service-token': params.token } : {}),
    },
    body: params.body,
  })
}

describe('Hermes skill proposal internal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunHermesSkillProposalOperation.mockResolvedValue({
      operation: 'propose_create',
      answer: 'Created proposal',
      proposal: {
        id: 'proposal-1',
        organizationId: 'org-1',
        workspaceId: null,
        workgroupId: null,
        agentCode: null,
        sourceUserId: 'user-1',
        sourceHermesRunId: null,
        targetSkillId: null,
        publishedSkillId: null,
        type: 'create',
        title: 'Skill proposal',
        description: 'Proposal description',
        proposedContent: 'Use this skill.',
        proposedDiff: null,
        evidenceRefs: [],
        risk: 'low',
        status: 'pending_review',
        reviewerId: null,
        reviewNote: null,
        reviewedAt: null,
        createdAt: '2026-06-13T00:00:00.000Z',
        updatedAt: '2026-06-13T00:00:00.000Z',
      },
    })
  })

  it('checks service auth before parsing JSON body', async () => {
    const response = await POST(buildRequest({ body: '{not-json' }))
    const payload = await response.json()

    expect(response.status).toBe(401)
    expect(payload.errorCode).toBe('UNAUTHENTICATED_SERVICE')
    expect(mockRunHermesSkillProposalOperation).not.toHaveBeenCalled()
  })

  it('parses the contract and creates proposal records through the service', async () => {
    const response = await POST(
      buildRequest({
        token: 's'.repeat(32),
        body: JSON.stringify({
          operation: 'propose_create',
          userId: 'user-1',
          organizationId: 'org-1',
          title: 'Skill proposal',
          description: 'Proposal description',
          proposedContent: 'Use this skill.',
          risk: 'low',
        }),
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.success).toBe(true)
    expect(payload.proposal.id).toBe('proposal-1')
    expect(mockRunHermesSkillProposalOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'propose_create',
        userId: 'user-1',
        organizationId: 'org-1',
        status: 'pending_review',
      })
    )
  })

  it('does not expose publish operations through the Hermes internal contract', async () => {
    const response = await POST(
      buildRequest({
        token: 's'.repeat(32),
        body: JSON.stringify({
          operation: 'publish',
          userId: 'user-1',
          organizationId: 'org-1',
          proposalId: 'proposal-1',
        }),
      })
    )

    expect(response.status).toBe(400)
    expect(mockRunHermesSkillProposalOperation).not.toHaveBeenCalled()
  })
})
