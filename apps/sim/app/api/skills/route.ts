import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteSkillContract, listSkillsContract, upsertSkillsContract } from '@/lib/api/contracts'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { deleteSkill, listSkills, upsertSkills } from '@/lib/workflows/skills/operations'
import { checkWorkspaceAccess, getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('SkillsAPI')

/** GET - Fetch all skills for a workspace */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skills access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    const parsed = await parseRequest(
      listSkillsContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid skills query`, { errors: error.issues })
          return validationErrorResponse(error, 'Invalid request data')
        },
      }
    )
    if (!parsed.success) return parsed.response
    const { workspaceId } = parsed.data.query

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
      logger.warn(
        `[${requestId}] User ${userId} attempted to access hidden workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission) {
      logger.warn(`[${requestId}] User ${userId} does not have access to workspace ${workspaceId}`)
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const result = await listSkills({ workspaceId })

    return NextResponse.json({ data: result }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching skills:`, error)
    return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 })
  }
})

/** POST - Create or update skills */
export const POST = withRouteHandler(async (req: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(req, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skills update attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId

    const parsed = await parseRequest(
      upsertSkillsContract,
      req,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid skills data`, { errors: error.issues })
          return validationErrorResponse(error, 'Invalid request data')
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { skills, workspaceId, source } = parsed.data.body

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
      logger.warn(
        `[${requestId}] User ${userId} attempted to update hidden workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Canvas not found' }, { status: 404 })
    }

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission || (userPermission !== 'admin' && userPermission !== 'write')) {
      logger.warn(
        `[${requestId}] User ${userId} does not have write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    try {
      const resultSkills = await upsertSkills({
        skills,
        workspaceId,
        userId,
        requestId,
      })

      for (const skill of resultSkills) {
        recordAudit({
          workspaceId,
          actorId: userId,
          actorName: authResult.userName ?? undefined,
          actorEmail: authResult.userEmail ?? undefined,
          action: AuditAction.SKILL_CREATED,
          resourceType: AuditResourceType.SKILL,
          resourceId: skill.id,
          resourceName: skill.name,
          description: `Created/updated skill "${skill.name}"`,
          metadata: { source },
        })
        captureServerEvent(
          userId,
          'skill_created',
          { skill_id: skill.id, skill_name: skill.name, workspace_id: workspaceId, source },
          { groups: { workspace: workspaceId } }
        )
      }

      return NextResponse.json({ success: true, data: resultSkills })
    } catch (upsertError) {
      if (upsertError instanceof Error && upsertError.message.includes('already exists')) {
        return NextResponse.json({ error: upsertError.message }, { status: 409 })
      }
      throw upsertError
    }
  } catch (error) {
    logger.error(`[${requestId}] Error updating skills`, error)
    return NextResponse.json({ error: 'Failed to update skills' }, { status: 500 })
  }
})

/** DELETE - Delete a skill by ID */
export const DELETE = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success || !authResult.userId) {
      logger.warn(`[${requestId}] Unauthorized skill deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    const parsed = await parseRequest(
      deleteSkillContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid skill deletion query`, { errors: error.issues })
          return validationErrorResponse(error, 'Invalid request data')
        },
      }
    )
    if (!parsed.success) return parsed.response
    const { id: skillId, workspaceId, source } = parsed.data.query

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    if (!workspaceAccess.exists || !workspaceAccess.hasAccess) {
      logger.warn(
        `[${requestId}] User ${userId} attempted to delete skill in hidden workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    const userPermission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
    if (!userPermission || (userPermission !== 'admin' && userPermission !== 'write')) {
      logger.warn(
        `[${requestId}] User ${userId} does not have write permission for workspace ${workspaceId}`
      )
      return NextResponse.json({ error: 'Write permission required' }, { status: 403 })
    }

    const deleted = await deleteSkill({ skillId, workspaceId })
    if (!deleted) {
      logger.warn(`[${requestId}] Skill not found: ${skillId}`)
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }

    recordAudit({
      workspaceId,
      actorId: authResult.userId,
      actorName: authResult.userName ?? undefined,
      actorEmail: authResult.userEmail ?? undefined,
      action: AuditAction.SKILL_DELETED,
      resourceType: AuditResourceType.SKILL,
      resourceId: skillId,
      description: `Deleted skill`,
      metadata: { source },
    })

    captureServerEvent(
      userId,
      'skill_deleted',
      { skill_id: skillId, workspace_id: workspaceId, source },
      { groups: { workspace: workspaceId } }
    )

    logger.info(`[${requestId}] Deleted skill: ${skillId}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting skill:`, error)
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 })
  }
})
