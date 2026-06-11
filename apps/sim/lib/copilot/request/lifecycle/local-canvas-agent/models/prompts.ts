import {
  buildLocalAgentPromptCacheContextParts,
  getOrCreateLocalAgentPromptCacheEntry,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/prompt-cache'
import type {
  LocalAgentContext,
  LocalAgentRole,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const USER_FACING_GUARD = [
  'The resolved agent profile, discipline, and skills are internal capability context only.',
  'Never introduce yourself as the profile, an agent persona, chief director, director, or any team role unless the user explicitly asks for that voice.',
  'Never start with phrases like "I am", "as an agent", "as the director", or team-broadcast announcements.',
  'Never address the user as a team or group unless the user explicitly asks for a team-broadcast style.',
  'Do not expose raw JSON, workflowId, workspaceId, database IDs, internal fields, or tool payloads unless the user explicitly asks for IDs.',
].join('\n')
const ROLE_SYSTEM_PROMPT_VERSION = '2026-06-11-v1'

function buildCapabilityContext(context: LocalAgentContext): string {
  const skills = context.skills
    .map((skill) => `- ${skill.name}: ${skill.description}`)
    .slice(0, 8)
    .join('\n')
  return [
    `Agent code: ${context.agent.code}`,
    `Discipline code: ${context.discipline.code}`,
    skills ? `Enabled skills:\n${skills}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildLocalAgentRoleSystemPrompt(params: {
  context: LocalAgentContext
  role: LocalAgentRole
  roleInstruction: string
  includeProfileInstructions?: boolean
}): string {
  return getOrCreateLocalAgentPromptCacheEntry({
    kind: 'role-system-prompt',
    role: params.role,
    version: ROLE_SYSTEM_PROMPT_VERSION,
    parts: {
      context: buildLocalAgentPromptCacheContextParts(params.context),
      roleInstruction: params.roleInstruction,
      includeProfileInstructions: params.includeProfileInstructions === true,
    },
    build: () =>
      [
        params.includeProfileInstructions ? params.context.agent.systemPrompt : '',
        params.roleInstruction,
        `Runtime role: ${params.role}`,
        buildCapabilityContext(params.context),
        USER_FACING_GUARD,
      ]
        .filter((part) => part.trim())
        .join('\n\n'),
    measure: (value) => value.length,
  }).value
}
