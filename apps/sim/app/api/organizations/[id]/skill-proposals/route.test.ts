/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetSession,
  mockListSkillProposalsForReview,
  mockPublishSkillProposal,
  mockReviewSkillProposal,
  mockRollbackSkillRevision,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockListSkillProposalsForReview: vi.fn(),
  mockPublishSkillProposal: vi.fn(),
  mockReviewSkillProposal: vi.fn(),
  mockRollbackSkillRevision: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/lib/hermes/skill-proposals', () => ({
  listSkillProposalsForReview: mockListSkillProposalsForReview,
  publishSkillProposal: mockPublishSkillProposal,
  reviewSkillProposal: mockReviewSkillProposal,
  rollbackSkillRevision: mockRollbackSkillRevision,
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
  runWithRequestContext: (_context: unknown, callback: () => unknown) => callback(),
}))

import { POST as publishProposal } from '@/app/api/organizations/[id]/skill-proposals/[proposalId]/publish/route'
import { POST as reviewProposal } from '@/app/api/organizations/[id]/skill-proposals/[proposalId]/review/route'
import { GET as listProposals } from '@/app/api/organizations/[id]/skill-proposals/route'
import { POST as rollbackSkill } from '@/app/api/organizations/[id]/skills/[skillId]/rollback/route'

const proposal = {
  id: 'proposal-1',
  organizationId: 'org-1',
  workspaceId: 'workspace-1',
  workgroupId: 'workgroup-1',
  agentCode: 'chief_director',
  sourceUserId: 'user-1',
  sourceHermesRunId: 'hermes-run-1',
  targetSkillId: null,
  publishedSkillId: null,
  type: 'create',
  title: 'Skill proposal',
  description: 'Proposal description',
  proposedContent: 'Use this skill.',
  proposedDiff: 'diff',
  evidenceRefs: ['chat:1'],
  risk: 'medium',
  status: 'pending_review',
  reviewerId: null,
  reviewNote: null,
  reviewedAt: null,
  createdAt: '2026-06-13T00:00:00.000Z',
  updatedAt: '2026-06-13T00:00:00.000Z',
} as const

const revision = {
  id: 'revision-1',
  skillId: 'skill-1',
  version: 1,
  content: 'Use this skill.',
  diff: 'diff',
  authorType: 'admin',
  authorId: 'admin-1',
  sourceProposalId: 'proposal-1',
  rollbackTargetRevisionId: null,
  createdAt: '2026-06-13T00:00:00.000Z',
} as const

const skill = {
  id: 'skill-1',
  name: 'Skill proposal',
  description: 'Proposal description',
  content: 'Use this skill.',
  agentCode: 'chief_director',
  workgroupId: 'workgroup-1',
  workgroupName: 'Team',
  teamWorkspaceId: 'workspace-1',
  enabledByDefault: true,
} as const

function context(params: Record<string, string>) {
  return { params: Promise.resolve(params) }
}

function request(path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('SIM Hermes skill proposal governance routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'admin-1' } })
    mockListSkillProposalsForReview.mockResolvedValue([proposal])
    mockReviewSkillProposal.mockResolvedValue({ ...proposal, status: 'approved' })
    mockPublishSkillProposal.mockResolvedValue({
      proposal: { ...proposal, status: 'published', publishedSkillId: 'skill-1' },
      skill,
      revision,
    })
    mockRollbackSkillRevision.mockResolvedValue({
      skill,
      revision: {
        ...revision,
        id: 'revision-2',
        version: 2,
        rollbackTargetRevisionId: 'revision-1',
      },
    })
  })

  it('lists review proposals through SIM admin session auth', async () => {
    const response = await listProposals(
      request('/api/organizations/org-1/skill-proposals?status=pending_review'),
      context({ id: 'org-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.proposals[0].id).toBe('proposal-1')
    expect(mockListSkillProposalsForReview).toHaveBeenCalledWith({
      userId: 'admin-1',
      organizationId: 'org-1',
      status: 'pending_review',
      limit: 50,
    })
  })

  it('reviews a proposal without exposing review to Hermes service tokens', async () => {
    const response = await reviewProposal(
      request('/api/organizations/org-1/skill-proposals/proposal-1/review', {
        action: 'approve',
        reviewNote: 'Looks good',
      }),
      context({ id: 'org-1', proposalId: 'proposal-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.proposal.status).toBe('approved')
    expect(mockReviewSkillProposal).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      organizationId: 'org-1',
      proposalId: 'proposal-1',
      action: 'approve',
      reviewNote: 'Looks good',
    })
  })

  it('publishes an approved proposal through the SIM skill binding path', async () => {
    const response = await publishProposal(
      request('/api/organizations/org-1/skill-proposals/proposal-1/publish', {
        enableBinding: true,
      }),
      context({ id: 'org-1', proposalId: 'proposal-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.proposal.publishedSkillId).toBe('skill-1')
    expect(payload.skill.enabledByDefault).toBe(true)
    expect(payload.revision.version).toBe(1)
    expect(mockPublishSkillProposal).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      organizationId: 'org-1',
      proposalId: 'proposal-1',
      enableBinding: true,
    })
  })

  it('rolls a published skill back to a recorded revision', async () => {
    const response = await rollbackSkill(
      request('/api/organizations/org-1/skills/skill-1/rollback', {
        version: 1,
        reason: 'bad production result',
      }),
      context({ id: 'org-1', skillId: 'skill-1' })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.revision.rollbackTargetRevisionId).toBe('revision-1')
    expect(mockRollbackSkillRevision).toHaveBeenCalledWith({
      actorUserId: 'admin-1',
      organizationId: 'org-1',
      skillId: 'skill-1',
      version: 1,
      reason: 'bad production result',
    })
  })

  it('rejects unauthenticated governance requests before service calls', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await publishProposal(
      request('/api/organizations/org-1/skill-proposals/proposal-1/publish', {
        enableBinding: true,
      }),
      context({ id: 'org-1', proposalId: 'proposal-1' })
    )

    expect(response.status).toBe(401)
    expect(mockPublishSkillProposal).not.toHaveBeenCalled()
  })
})
