import { createLogger } from '@sim/logger'
import { safeCompare } from '@sim/security/compare'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  type HermesSkillProposalErrorCode,
  type HermesSkillProposalRunResponse,
  hermesSkillProposalRunContract,
} from '@/lib/api/contracts/internal/hermes-skill-proposals'
import { parseRequest } from '@/lib/api/server'
import { env } from '@/lib/core/config/env'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { runHermesSkillProposalOperation } from '@/lib/hermes/skill-proposals'
import { recordHermesToolCallAudit } from '@/lib/hermes/tool-call-audit'

const logger = createLogger('HermesSkillProposalAPI')
const TOOL_NAME = 'sim_skill_proposal_run'

function getServiceToken(request: NextRequest): string | null {
  const directToken = request.headers.get('x-sim-service-token')
  if (directToken) return directToken

  const authHeader = request.headers.get('authorization')
  const bearerPrefix = 'Bearer '
  if (authHeader?.startsWith(bearerPrefix)) return authHeader.slice(bearerPrefix.length)
  return null
}

function verifyHermesServiceRequest(request: NextRequest): boolean {
  const expectedToken = env.HERMES_SERVICE_TOKEN
  const suppliedToken = getServiceToken(request)

  if (!expectedToken || !suppliedToken) return false
  return safeCompare(suppliedToken, expectedToken)
}

function authErrorResponse(params: {
  auditId: string
  traceId?: string
}): NextResponse<HermesSkillProposalRunResponse> {
  return NextResponse.json(
    {
      success: false,
      answer: '',
      auditId: params.auditId,
      traceId: params.traceId,
      errorCode: 'UNAUTHENTICATED_SERVICE',
      error: 'Hermes service authentication failed',
    },
    { status: 401 }
  )
}

function errorCodeForError(error: Error): HermesSkillProposalErrorCode {
  if (/does not belong|access|required/i.test(error.message)) return 'USER_PERMISSION_DENIED'
  if (/organization/i.test(error.message)) return 'ORGANIZATION_NOT_FOUND'
  if (/skill not found/i.test(error.message)) return 'SKILL_NOT_FOUND'
  if (/proposal not found/i.test(error.message)) return 'PROPOSAL_NOT_FOUND'
  if (/proposal|workspace|workgroup|agent/i.test(error.message)) return 'INVALID_PROPOSAL'
  return 'INTERNAL_ERROR'
}

function statusForErrorCode(errorCode: HermesSkillProposalErrorCode): number {
  if (errorCode === 'UNAUTHENTICATED_SERVICE') return 401
  if (errorCode === 'USER_PERMISSION_DENIED') return 403
  if (
    errorCode === 'ORGANIZATION_NOT_FOUND' ||
    errorCode === 'SKILL_NOT_FOUND' ||
    errorCode === 'PROPOSAL_NOT_FOUND'
  ) {
    return 404
  }
  if (errorCode === 'INVALID_PROPOSAL') return 400
  return 500
}

export const POST = withRouteHandler(async (request: NextRequest) => {
  const auditId = generateId()
  const startedAt = Date.now()
  const headerTraceId = request.headers.get('x-trace-id') ?? undefined

  if (!verifyHermesServiceRequest(request)) {
    logger.warn('Rejected unauthorized Hermes skill proposal request', {
      auditId,
      traceId: headerTraceId,
      hasServiceToken: Boolean(getServiceToken(request)),
      configured: Boolean(env.HERMES_SERVICE_TOKEN),
    })
    await recordHermesToolCallAudit({
      auditId,
      traceId: headerTraceId,
      toolName: TOOL_NAME,
      status: 'unauthenticated',
      inputSummary: {
        hasServiceToken: Boolean(getServiceToken(request)),
        configured: Boolean(env.HERMES_SERVICE_TOKEN),
      },
      outputSummary: { success: false },
      durationMs: Date.now() - startedAt,
      errorCode: 'UNAUTHENTICATED_SERVICE',
      error: 'Hermes service authentication failed',
    })
    return authErrorResponse({ auditId, traceId: headerTraceId })
  }

  const parsed = await parseRequest(hermesSkillProposalRunContract, request, {})
  if (!parsed.success) {
    await recordHermesToolCallAudit({
      auditId,
      traceId: headerTraceId,
      toolName: TOOL_NAME,
      status: 'error',
      inputSummary: { validation: 'failed' },
      outputSummary: { success: false },
      durationMs: Date.now() - startedAt,
      errorCode: 'INVALID_REQUEST',
      error: 'Hermes skill proposal request validation failed',
    })
    return parsed.response
  }

  const body = parsed.data.body
  const traceId = body.traceId ?? headerTraceId

  try {
    const result = await runHermesSkillProposalOperation(body)
    const response = {
      success: true,
      operation: result.operation,
      answer: result.answer,
      auditId,
      traceId,
      ...(result.skills ? { skills: result.skills } : {}),
      ...(result.skill ? { skill: result.skill } : {}),
      ...(result.proposal ? { proposal: result.proposal } : {}),
      ...(result.comparison ? { comparison: result.comparison } : {}),
    } satisfies HermesSkillProposalRunResponse

    logger.info('Handled Hermes skill proposal request', {
      auditId,
      traceId,
      hermesRunId: body.hermesRunId,
      userId: body.userId,
      organizationId: body.organizationId,
      operation: body.operation,
    })

    await recordHermesToolCallAudit({
      auditId,
      traceId,
      hermesRunId: body.hermesRunId,
      userId: body.userId,
      organizationId: body.organizationId,
      toolName: TOOL_NAME,
      operation: body.operation,
      status: 'success',
      inputSummary: {
        operation: body.operation,
        hasTargetSkillId: 'targetSkillId' in body,
        hasProposalId: 'proposalId' in body,
      },
      outputSummary: {
        success: true,
        answerLength: response.answer.length,
        proposalId: response.proposal?.id,
        skillId: response.skill?.id,
        skillCount: response.skills?.length,
      },
      risk: 'risk' in body ? body.risk : undefined,
      durationMs: Date.now() - startedAt,
    })

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    const err = toError(error)
    const errorCode = errorCodeForError(err)
    const response = {
      success: false,
      operation: body.operation,
      answer: '',
      auditId,
      traceId,
      errorCode,
      error: err.message,
    } satisfies HermesSkillProposalRunResponse

    logger.warn('Hermes skill proposal request failed', {
      auditId,
      traceId,
      hermesRunId: body.hermesRunId,
      userId: body.userId,
      organizationId: body.organizationId,
      operation: body.operation,
      errorCode,
      error: err.message,
    })

    await recordHermesToolCallAudit({
      auditId,
      traceId,
      hermesRunId: body.hermesRunId,
      userId: body.userId,
      organizationId: body.organizationId,
      toolName: TOOL_NAME,
      operation: body.operation,
      status: 'error',
      inputSummary: {
        operation: body.operation,
        hasTargetSkillId: 'targetSkillId' in body,
        hasProposalId: 'proposalId' in body,
      },
      outputSummary: { success: false, errorCode },
      risk: 'risk' in body ? body.risk : undefined,
      durationMs: Date.now() - startedAt,
      errorCode,
      error: err.message,
    })

    return NextResponse.json(response, { status: statusForErrorCode(errorCode) })
  }
})
