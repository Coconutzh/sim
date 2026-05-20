import type { Edge } from 'reactflow'
import { validateWorkflowSchedules } from '@/lib/workflows/schedules/validation'
import type { BlockState, Loop, Parallel } from '@/stores/workflows/workflow/types'

export interface PreDeployCheckResult {
  passed: boolean
  error?: string
}

export interface PreDeployContext {
  blocks: Record<string, BlockState>
  edges: Edge[]
  loops: Record<string, Loop>
  parallels: Record<string, Parallel>
  workflowId: string
}

type PreDeployCheck = (context: PreDeployContext) => Promise<PreDeployCheckResult>

/**
 * Validates schedule block configuration
 */
const scheduleValidationCheck: PreDeployCheck = async ({ blocks }) => {
  const result = validateWorkflowSchedules(blocks)
  return {
    passed: result.isValid,
    error: result.error ? `Invalid schedule configuration: ${result.error}` : undefined,
  }
}

/**
 * Validates required fields using the serializer's validation
 */
const requiredFieldsCheck: PreDeployCheck = async ({ blocks, edges, loops, parallels }) => {
  try {
    const { LightweightSerializer } = await import('@/serializer/lightweight')
    const serializer = new LightweightSerializer()
    serializer.serializeWorkflow(blocks, edges, loops, parallels, true)
    return { passed: true }
  } catch (error) {
    return {
      passed: false,
      error: error instanceof Error ? error.message : 'Workflow validation failed',
    }
  }
}

/**
 * All pre-deploy checks in execution order
 * Add new checks here as needed
 */
const preDeployChecks: PreDeployCheck[] = [scheduleValidationCheck, requiredFieldsCheck]

/**
 * Runs all pre-deploy checks and returns the first failure or success
 */
export async function runPreDeployChecks(context: PreDeployContext): Promise<PreDeployCheckResult> {
  for (const check of preDeployChecks) {
    const result = await check(context)
    if (!result.passed) {
      return result
    }
  }
  return { passed: true }
}
