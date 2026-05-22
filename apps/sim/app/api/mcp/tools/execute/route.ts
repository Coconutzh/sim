import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { executeMcpToolContract } from '@/lib/api/contracts/mcp'
import { parseRequest } from '@/lib/api/server'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { getExecutionTimeout } from '@/lib/core/execution-limits'
import type { SubscriptionPlan } from '@/lib/core/rate-limiter/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { SIM_VIA_HEADER } from '@/lib/execution/call-chain'
import { withMcpAuth } from '@/lib/mcp/middleware'
import { mcpService } from '@/lib/mcp/service'
import type { McpTool, McpToolCall, McpToolResult, McpToolSchemaProperty } from '@/lib/mcp/types'
import { categorizeError, createMcpErrorResponse, createMcpSuccessResponse } from '@/lib/mcp/utils'
import {
  assertPermissionsAllowed,
  McpToolsNotAllowedError,
} from '@/ee/access-control/utils/permission-check'

const logger = createLogger('McpToolExecutionAPI')

export const dynamic = 'force-dynamic'

interface ToolExecutionResult {
  success: boolean
  output?: McpToolResult
  error?: string
}

function getSchemaTypes(prop: McpToolSchemaProperty): string[] {
  if (Array.isArray(prop.type)) {
    return prop.type.filter((type): type is string => typeof type === 'string')
  }
  return typeof prop.type === 'string' ? [prop.type] : []
}

function matchesSchemaType(value: unknown, schemaType: string): boolean {
  if (schemaType === 'array') return Array.isArray(value)
  if (schemaType === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (schemaType === 'object')
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  if (schemaType === 'null') return value === null
  return typeof value === schemaType
}

function formatExpectedTypes(types: string[]): string {
  return types.length === 1 ? types[0] : `one of: ${types.join(', ')}`
}

/**
 * POST - Execute a tool on an MCP server
 */
export const POST = withRouteHandler(
  withMcpAuth('read')(async (request: NextRequest, { userId, workspaceId, requestId }) => {
    try {
      const parsed = await parseRequest(
        executeMcpToolContract,
        request,
        {},
        {
          validationErrorResponse: (error) =>
            createMcpErrorResponse(error, 'Invalid request format', 400),
          invalidJsonResponse: () =>
            createMcpErrorResponse(new Error('Invalid JSON body'), 'Invalid request format', 400),
        }
      )
      if (!parsed.success) return parsed.response
      const { body } = parsed.data

      logger.info(`[${requestId}] MCP tool execution request received`, {
        hasAuthHeader: !!request.headers.get('authorization'),
        bodyKeys: Object.keys(body),
        serverId: body.serverId,
        toolName: body.toolName,
        hasWorkflowId: !!body.workflowId,
        workflowId: body.workflowId,
        userId: userId,
      })

      const { serverId, toolName, arguments: rawArgs } = body
      const args = rawArgs || {}

      try {
        await assertPermissionsAllowed({
          userId,
          workspaceId,
          toolKind: 'mcp',
        })
      } catch (err) {
        if (err instanceof McpToolsNotAllowedError) {
          return createMcpErrorResponse(err, err.message, 403)
        }
        throw err
      }

      logger.info(
        `[${requestId}] Executing tool ${toolName} on server ${serverId} for user ${userId} in workspace ${workspaceId}`
      )

      let tool: McpTool | null = null
      try {
        const tools = await mcpService.discoverServerTools(userId, serverId, workspaceId)
        tool = tools.find((t) => t.name === toolName) ?? null

        if (!tool) {
          logger.warn(`[${requestId}] Tool ${toolName} not found on server ${serverId}`, {
            availableTools: tools.map((t) => t.name),
          })
          return createMcpErrorResponse(
            new Error('Tool not found'),
            'Tool not found on the specified server',
            404
          )
        }

        if (tool.inputSchema?.properties) {
          for (const [paramName, paramSchema] of Object.entries(tool.inputSchema.properties)) {
            const schemaTypes = getSchemaTypes(paramSchema)
            const value = args[paramName]

            if (value === undefined || value === null) {
              continue
            }

            if (
              (schemaTypes.includes('number') || schemaTypes.includes('integer')) &&
              typeof value === 'string'
            ) {
              const numValue = schemaTypes.includes('integer')
                ? Number.parseInt(value)
                : Number.parseFloat(value)
              if (!Number.isNaN(numValue)) {
                args[paramName] = numValue
              }
            } else if (schemaTypes.includes('boolean') && typeof value === 'string') {
              if (value.toLowerCase() === 'true') {
                args[paramName] = true
              } else if (value.toLowerCase() === 'false') {
                args[paramName] = false
              }
            } else if (schemaTypes.includes('array') && typeof value === 'string') {
              const stringValue = value.trim()
              if (stringValue) {
                try {
                  const parsed = JSON.parse(stringValue)
                  if (Array.isArray(parsed)) {
                    args[paramName] = parsed
                  } else {
                    args[paramName] = [parsed]
                  }
                } catch {
                  if (stringValue.includes(',')) {
                    args[paramName] = stringValue
                      .split(',')
                      .map((item) => item.trim())
                      .filter((item) => item)
                  } else {
                    args[paramName] = [stringValue]
                  }
                }
              } else {
                args[paramName] = []
              }
            }
          }
        }
      } catch (error) {
        logger.warn(
          `[${requestId}] Failed to discover tools for validation, proceeding without schema`,
          error
        )
      }

      if (tool) {
        const validationError = validateToolArguments(tool, args)
        if (validationError) {
          logger.warn(`[${requestId}] Tool validation failed: ${validationError}`)
          return createMcpErrorResponse(
            new Error(`Invalid arguments for tool ${toolName}: ${validationError}`),
            'Invalid tool arguments',
            400
          )
        }
      }

      const toolCall: McpToolCall = {
        name: toolName,
        arguments: args,
      }

      const userSubscription = await getHighestPrioritySubscription(userId)
      const executionTimeout = getExecutionTimeout(
        userSubscription?.plan as SubscriptionPlan | undefined,
        'sync'
      )

      const simViaHeader = request.headers.get(SIM_VIA_HEADER)
      const extraHeaders: Record<string, string> = {}
      if (simViaHeader) {
        extraHeaders[SIM_VIA_HEADER] = simViaHeader
      }

      const result = await Promise.race([
        mcpService.executeTool(userId, serverId, toolCall, workspaceId, extraHeaders),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Tool execution timeout')), executionTimeout)
        ),
      ])

      const transformedResult = transformToolResult(result)

      if (result.isError) {
        logger.warn(`[${requestId}] Tool execution returned error for ${toolName} on ${serverId}`)
        return createMcpErrorResponse(
          transformedResult,
          transformedResult.error || 'Tool execution failed',
          400
        )
      }
      logger.info(`[${requestId}] Successfully executed tool ${toolName} on server ${serverId}`)

      try {
        const { PlatformEvents } = await import('@/lib/core/telemetry')
        PlatformEvents.mcpToolExecuted({
          serverId,
          toolName,
          status: 'success',
          workspaceId,
        })
      } catch {
        // Telemetry failure is non-critical
      }

      return createMcpSuccessResponse(transformedResult)
    } catch (error) {
      logger.error(`[${requestId}] Error executing MCP tool:`, error)

      const { message, status } = categorizeError(error)
      return createMcpErrorResponse(new Error(message), message, status)
    }
  })
)

function validateToolArguments(tool: McpTool, args: Record<string, unknown>): string | null {
  if (!tool.inputSchema) {
    return null
  }

  const schema = tool.inputSchema

  if (schema.required && Array.isArray(schema.required)) {
    for (const requiredProp of schema.required) {
      if (!(requiredProp in (args || {}))) {
        return `Missing required property: ${requiredProp}`
      }
    }
  }

  if (schema.properties && args) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propValue = args[propName]
      if (propValue !== undefined) {
        const expectedTypes = getSchemaTypes(propSchema)
        if (expectedTypes.length === 0) continue

        const isValidType = expectedTypes.some((schemaType) =>
          matchesSchemaType(propValue, schemaType)
        )
        if (!isValidType) {
          return `Property ${propName} must be ${formatExpectedTypes(expectedTypes)}`
        }
      }
    }
  }

  return null
}

function transformToolResult(result: McpToolResult): ToolExecutionResult {
  if (result.isError) {
    const firstContent = Array.isArray(result.content) ? result.content[0] : undefined
    const errorText =
      firstContent && typeof firstContent === 'object' && typeof firstContent.text === 'string'
        ? firstContent.text
        : undefined

    return {
      success: false,
      error: errorText && errorText.trim().length > 0 ? errorText : 'Tool execution failed',
    }
  }

  return {
    success: true,
    output: result,
  }
}
