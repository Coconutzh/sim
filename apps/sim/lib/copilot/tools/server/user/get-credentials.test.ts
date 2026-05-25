/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockAuthorizeWorkflowByWorkspacePermission,
  mockDbSelect,
  mockGetAllOAuthServices,
  mockGetPersonalAndWorkspaceEnv,
  mockRefreshTokenIfNeeded,
} = vi.hoisted(() => ({
  mockAuthorizeWorkflowByWorkspacePermission: vi.fn(),
  mockDbSelect: vi.fn(),
  mockGetAllOAuthServices: vi.fn(),
  mockGetPersonalAndWorkspaceEnv: vi.fn(),
  mockRefreshTokenIfNeeded: vi.fn(),
}))

vi.mock('@sim/db', () => ({
  db: {
    select: mockDbSelect,
  },
}))

vi.mock('@sim/db/schema', () => ({
  account: {
    id: 'account.id',
    userId: 'account.userId',
  },
  user: {
    id: 'user.id',
    email: 'user.email',
  },
}))

vi.mock('@sim/workflow-authz', () => ({
  authorizeWorkflowByWorkspacePermission: mockAuthorizeWorkflowByWorkspacePermission,
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((left, right) => ({ left, right })),
}))

vi.mock('jwt-decode', () => ({
  jwtDecode: vi.fn(() => ({})),
}))

vi.mock('@/lib/environment/utils', () => ({
  getPersonalAndWorkspaceEnv: mockGetPersonalAndWorkspaceEnv,
}))

vi.mock('@/lib/oauth', () => ({
  getAllOAuthServices: mockGetAllOAuthServices,
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  refreshTokenIfNeeded: mockRefreshTokenIfNeeded,
}))

import { getCredentialsServerTool } from './get-credentials'

function mockCredentialQueries() {
  mockDbSelect.mockImplementation((projection?: Record<string, unknown>) => {
    const isUserQuery = Boolean(projection?.email)
    return {
      from: () => ({
        where: () =>
          isUserQuery
            ? {
                limit: vi.fn().mockResolvedValue([{ email: 'artist@example.com' }]),
              }
            : Promise.resolve([
                {
                  id: 'account-1',
                  accountId: 'artist-google',
                  providerId: 'google',
                  idToken: null,
                  accessToken: 'token-1',
                  updatedAt: new Date('2026-05-22T00:00:00.000Z'),
                },
              ]),
      }),
    }
  })
}

describe('getCredentialsServerTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCredentialQueries()
    mockGetAllOAuthServices.mockReturnValue([
      {
        providerId: 'google',
        name: 'Google',
        description: 'Google OAuth',
        baseProvider: 'google',
      },
    ])
    mockGetPersonalAndWorkspaceEnv.mockResolvedValue({
      personalEncrypted: { PERSONAL_API_KEY: 'encrypted-personal' },
      workspaceEncrypted: { TEAM_API_KEY: 'encrypted-team' },
      personalDecrypted: {},
      workspaceDecrypted: {},
      conflicts: [],
      decryptionFailures: [],
    })
    mockRefreshTokenIfNeeded.mockResolvedValue({ accessToken: 'token-1' })
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValue({
      allowed: true,
      status: 200,
      workflow: { workspaceId: 'workspace-1' },
      workspacePermission: 'write',
      accessSource: 'workspace',
    })
  })

  it('loads workspace credentials only for direct workspace workflow access', async () => {
    const result = await getCredentialsServerTool.execute(
      { workflowId: 'workflow-1' },
      { userId: 'user-1' }
    )

    expect(mockAuthorizeWorkflowByWorkspacePermission).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      userId: 'user-1',
      action: 'read',
    })
    expect(mockGetPersonalAndWorkspaceEnv).toHaveBeenCalledWith('user-1', 'workspace-1')
    expect(result.environment.workspaceVariables).toEqual(['TEAM_API_KEY'])
  })

  it('blocks source canvas credentials for cross-team published workflow viewers', async () => {
    mockAuthorizeWorkflowByWorkspacePermission.mockResolvedValueOnce({
      allowed: true,
      status: 200,
      workflow: { workspaceId: 'source-workspace' },
      workspacePermission: 'read',
      accessSource: 'selected_workgroups',
    })

    await expect(
      getCredentialsServerTool.execute({ workflowId: 'published-workflow' }, { userId: 'user-2' })
    ).rejects.toThrow('Published workflow viewers cannot access source canvas credentials')

    expect(mockGetPersonalAndWorkspaceEnv).not.toHaveBeenCalled()
    expect(mockDbSelect).not.toHaveBeenCalled()
  })
})
