import toolOutputsJson from '@/tools/outputs.generated.json'
import type { ToolConfig } from '@/tools/types'

const TOOL_OUTPUTS = toolOutputsJson as Record<string, ToolConfig['outputs']>

function stripToolVersionSuffix(name: string): string {
  return name.replace(/_v\d+$/, '')
}

function resolveToolOutputId(toolName: string): string {
  if (TOOL_OUTPUTS[toolName]) return toolName

  const baseName = stripToolVersionSuffix(toolName)
  let latestToolId: string | undefined
  let latestVersion = -1

  for (const toolId of Object.keys(TOOL_OUTPUTS)) {
    if (stripToolVersionSuffix(toolId) !== baseName) continue
    const versionMatch = toolId.match(/_v(\d+)$/)
    const version = versionMatch ? Number.parseInt(versionMatch[1], 10) : 1
    if (version > latestVersion) {
      latestVersion = version
      latestToolId = toolId
    }
  }

  return latestToolId ?? toolName
}

export function getToolOutputsFromCatalog(toolId: string): ToolConfig['outputs'] | undefined {
  return TOOL_OUTPUTS[resolveToolOutputId(toolId)]
}

export function hasToolOutputEntry(toolId: string): boolean {
  return Boolean(TOOL_OUTPUTS[resolveToolOutputId(toolId)])
}
