import type {
  LocalAgentObservation,
  LocalAgentToolResult,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export function observationFromToolResult(result: LocalAgentToolResult): LocalAgentObservation {
  return {
    toolName: result.name,
    summary: result.summary,
    success: result.success,
    timestamp: new Date().toISOString(),
    output: result.output,
  }
}
