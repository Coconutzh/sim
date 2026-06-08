import {
  getLocalAgentToolDescriptor,
  LOCAL_AGENT_TOOL_DESCRIPTORS,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/tool-descriptor'
import type {
  LocalAgentContext,
  LocalAgentToolName,
  LocalCanvasToolName,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export function selectAvailableLocalAgentTools(context: LocalAgentContext): LocalAgentToolName[] {
  return LOCAL_AGENT_TOOL_DESCRIPTORS.filter((descriptor) => descriptor.isEnabled(context)).map(
    (descriptor) => descriptor.name
  )
}

export function selectAvailableCanvasTools(context: LocalAgentContext): LocalCanvasToolName[] {
  return selectAvailableLocalAgentTools(context).filter((tool): tool is LocalCanvasToolName =>
    tool.startsWith('canvas.')
  )
}

export function isCanvasToolAvailable(
  context: LocalAgentContext,
  toolName: LocalAgentToolName
): boolean {
  return Boolean(getLocalAgentToolDescriptor(toolName)?.isEnabled(context))
}
