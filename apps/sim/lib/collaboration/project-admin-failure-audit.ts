export type ProjectAdminFailureScope =
  | 'team'
  | 'agent'
  | 'publication'
  | 'member'
  | 'activity'
  | 'notification'

export interface ProjectAdminFailureAuditEntry {
  id: string
  scope: ProjectAdminFailureScope
  operation: string
  target: string
  message: string
  occurredAt: string
}

export interface ProjectAdminFailureAuditSummary {
  total: number
  latest: ProjectAdminFailureAuditEntry | null
  scopeCounts: Record<ProjectAdminFailureScope, number>
}

const EMPTY_SCOPE_COUNTS: Record<ProjectAdminFailureScope, number> = {
  team: 0,
  agent: 0,
  publication: 0,
  member: 0,
  activity: 0,
  notification: 0,
}

export function buildProjectAdminFailureAuditEntry(params: {
  id: string
  scope: ProjectAdminFailureScope
  operation: string
  target: string
  message: string
  occurredAt?: string
}): ProjectAdminFailureAuditEntry {
  return {
    id: params.id,
    scope: params.scope,
    operation: params.operation.trim() || 'Unknown operation',
    target: params.target.trim() || 'Unknown target',
    message: params.message.trim() || 'Unknown error',
    occurredAt: params.occurredAt ?? new Date().toISOString(),
  }
}

export function buildProjectAdminFailureAuditSummary(
  entries: ProjectAdminFailureAuditEntry[]
): ProjectAdminFailureAuditSummary {
  const scopeCounts = { ...EMPTY_SCOPE_COUNTS }
  for (const entry of entries) {
    scopeCounts[entry.scope] += 1
  }

  return {
    total: entries.length,
    latest: entries[0] ?? null,
    scopeCounts,
  }
}
