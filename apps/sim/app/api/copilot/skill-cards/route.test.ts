/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockCopilotSkillCardServiceError,
  mockCreateCopilotSkillCard,
  mockDeleteCopilotSkillCard,
  mockGetSession,
  mockListOrganizationCopilotSkillCards,
  mockListRuntimeCopilotSkillCards,
  mockUpdateCopilotSkillCard,
} = vi.hoisted(() => {
  class MockCopilotSkillCardServiceError extends Error {
    constructor(
      message: string,
      public readonly status: number
    ) {
      super(message)
      this.name = 'CopilotSkillCardServiceError'
    }
  }

  return {
    MockCopilotSkillCardServiceError,
    mockCreateCopilotSkillCard: vi.fn(),
    mockDeleteCopilotSkillCard: vi.fn(),
    mockGetSession: vi.fn(),
    mockListOrganizationCopilotSkillCards: vi.fn(),
    mockListRuntimeCopilotSkillCards: vi.fn(),
    mockUpdateCopilotSkillCard: vi.fn(),
  }
})

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
  getSession: mockGetSession,
}))

vi.mock('@/lib/copilot/skill-card-service', () => ({
  CopilotSkillCardServiceError: MockCopilotSkillCardServiceError,
  createCopilotSkillCard: mockCreateCopilotSkillCard,
  deleteCopilotSkillCard: mockDeleteCopilotSkillCard,
  listOrganizationCopilotSkillCards: mockListOrganizationCopilotSkillCards,
  listRuntimeCopilotSkillCards: mockListRuntimeCopilotSkillCards,
  updateCopilotSkillCard: mockUpdateCopilotSkillCard,
}))

import { GET as GET_ORGANIZATION, POST } from '../../organizations/[id]/copilot-skill-cards/route'
import { DELETE, PATCH } from './[cardId]/route'
import { GET as GET_RUNTIME } from './route'

const card = {
  id: 'card-1',
  organizationId: 'org-1',
  agentCode: 'chief_director',
  workgroupId: null,
  workgroup: null,
  title: '拆分任务',
  description: '把导演需求拆成可执行任务',
  prompt: '请拆分任务',
  actionKind: 'prompt',
  taskDraft: null,
  enabled: true,
  sortOrder: 0,
  createdAt: '2026-06-04T06:00:00.000Z',
  updatedAt: '2026-06-04T06:00:00.000Z',
}

describe('copilot skill card routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockListRuntimeCopilotSkillCards.mockResolvedValue([card])
    mockListOrganizationCopilotSkillCards.mockResolvedValue([card])
    mockCreateCopilotSkillCard.mockResolvedValue(card)
    mockUpdateCopilotSkillCard.mockResolvedValue({ ...card, title: '设置 DDL' })
    mockDeleteCopilotSkillCard.mockResolvedValue(undefined)
  })

  it('authenticates before parsing runtime query params', async () => {
    mockGetSession.mockResolvedValueOnce(null)

    const response = await GET_RUNTIME(
      createMockRequest('GET', undefined, {}, 'http://localhost:3000/api/copilot/skill-cards')
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockListRuntimeCopilotSkillCards).not.toHaveBeenCalled()
  })

  it('lists runtime skill cards for a workspace', async () => {
    const response = await GET_RUNTIME(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/copilot/skill-cards?workspaceId=ws-1'
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ cards: [card] })
    expect(mockListRuntimeCopilotSkillCards).toHaveBeenCalledWith({
      userId: 'user-1',
      workspaceId: 'ws-1',
    })
  })

  it('lists organization skill cards with filters', async () => {
    const response = await GET_ORGANIZATION(
      createMockRequest(
        'GET',
        undefined,
        {},
        'http://localhost:3000/api/organizations/org-1/copilot-skill-cards?agentCode=lighting_sound&workgroupId=wg-1'
      ),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    expect(mockListOrganizationCopilotSkillCards).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'org-1',
      agentCode: 'lighting_sound',
      workgroupId: 'wg-1',
    })
  })

  it('creates an organization skill card with contract defaults', async () => {
    const response = await POST(
      createMockRequest('POST', {
        agentCode: 'chief_director',
        title: '设置 DDL',
        description: '快速创建带期限的生产任务',
        prompt: '请设置 DDL',
      }),
      { params: Promise.resolve({ id: 'org-1' }) }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ card })
    expect(mockCreateCopilotSkillCard).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'org-1',
      input: {
        agentCode: 'chief_director',
        workgroupId: undefined,
        title: '设置 DDL',
        description: '快速创建带期限的生产任务',
        prompt: '请设置 DDL',
        actionKind: 'prompt',
        taskDraft: undefined,
        enabled: true,
        sortOrder: 0,
      },
    })
  })

  it('passes skill card management permission errors through', async () => {
    mockUpdateCopilotSkillCard.mockRejectedValueOnce(
      new MockCopilotSkillCardServiceError('Copilot skill card management access required', 403)
    )

    const response = await PATCH(createMockRequest('PATCH', { title: '更新卡片' }), {
      params: Promise.resolve({ cardId: 'card-1' }),
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Copilot skill card management access required',
    })
  })

  it('deletes a skill card through the service', async () => {
    const response = await DELETE(createMockRequest('DELETE'), {
      params: Promise.resolve({ cardId: 'card-1' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true })
    expect(mockDeleteCopilotSkillCard).toHaveBeenCalledWith({
      userId: 'user-1',
      cardId: 'card-1',
    })
  })
})
