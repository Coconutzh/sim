import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import type { LocalAgentOperationTrace } from '@/lib/copilot/request/lifecycle/local-canvas-agent/observability'
import type {
  LocalAgentContext,
  LocalAgentToolCall,
  LocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const logger = createLogger('LocalCanvasAgentToolMiddleware')

export interface LocalAgentToolMiddlewareContext {
  context: LocalAgentContext
  trace: LocalAgentOperationTrace
}

export interface LocalAgentToolMiddleware {
  beforeExecute?(
    call: LocalAgentToolCall,
    middlewareContext: LocalAgentToolMiddlewareContext
  ): LocalAgentToolCall | Promise<LocalAgentToolCall>
  afterExecute?(
    result: LocalAgentToolResult,
    call: LocalAgentToolCall,
    middlewareContext: LocalAgentToolMiddlewareContext
  ): LocalAgentToolResult | Promise<LocalAgentToolResult>
}

const DEFAULT_MIDDLEWARES: readonly LocalAgentToolMiddleware[] = []

export async function applyLocalAgentToolRequestMiddleware(params: {
  call: LocalAgentToolCall
  middlewareContext: LocalAgentToolMiddlewareContext
  middlewares?: readonly LocalAgentToolMiddleware[]
}): Promise<LocalAgentToolCall> {
  const middlewares = params.middlewares ?? DEFAULT_MIDDLEWARES
  let nextCall = params.call
  for (const middleware of middlewares) {
    if (!middleware.beforeExecute) continue
    try {
      nextCall = await middleware.beforeExecute(nextCall, params.middlewareContext)
    } catch (error) {
      logger.warn('Local canvas agent tool request middleware failed open', {
        chatId: params.middlewareContext.context.chatId,
        workspaceId: params.middlewareContext.context.workspaceId,
        workflowId: params.middlewareContext.context.workflowId,
        toolName: nextCall.name,
        traceId: params.middlewareContext.trace.id,
        error: toError(error).message,
      })
    }
  }
  return nextCall
}

export async function applyLocalAgentToolResultMiddleware(params: {
  call: LocalAgentToolCall
  result: LocalAgentToolResult
  middlewareContext: LocalAgentToolMiddlewareContext
  middlewares?: readonly LocalAgentToolMiddleware[]
}): Promise<LocalAgentToolResult> {
  const middlewares = params.middlewares ?? DEFAULT_MIDDLEWARES
  let nextResult = params.result
  for (const middleware of middlewares) {
    if (!middleware.afterExecute) continue
    try {
      nextResult = await middleware.afterExecute(nextResult, params.call, params.middlewareContext)
    } catch (error) {
      logger.warn('Local canvas agent tool result middleware failed open', {
        chatId: params.middlewareContext.context.chatId,
        workspaceId: params.middlewareContext.context.workspaceId,
        workflowId: params.middlewareContext.context.workflowId,
        toolName: params.call.name,
        traceId: params.middlewareContext.trace.id,
        error: toError(error).message,
      })
    }
  }
  return nextResult
}
