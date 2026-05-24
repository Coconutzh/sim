import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import type { CleanupJobType, ResolvedCleanupScope } from '@/lib/billing/cleanup-dispatcher'

export const CLEANUP_EXECUTION_AUDIT_EVENT = 'cleanup.execution_completed'

interface CleanupAuditStats {
  rowsDeleted?: number
  rowsFailed?: number
  filesTotal?: number
  filesDeleted?: number
  filesFailed?: number
  snapshotsCleaned?: number
  durationSeconds: number
}

export function recordEnterpriseCleanupAudit(
  jobType: CleanupJobType,
  scope: ResolvedCleanupScope,
  stats: CleanupAuditStats
): void {
  if (!scope.organizationId) return

  const rowsDeleted = stats.rowsDeleted ?? 0
  const filesDeleted = stats.filesDeleted ?? 0
  const rowsFailed = stats.rowsFailed ?? 0
  const filesFailed = stats.filesFailed ?? 0

  recordAudit({
    actorId: 'system:cleanup',
    actorName: 'System cleanup',
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: scope.organizationId,
    resourceName: scope.organizationName ?? scope.organizationId,
    description: `${jobType} completed for ${scope.workspaceIds.length} workspace(s): ${rowsDeleted} row(s) and ${filesDeleted} file(s) deleted`,
    metadata: {
      organizationId: scope.organizationId,
      cleanupEvent: CLEANUP_EXECUTION_AUDIT_EVENT,
      jobType,
      label: scope.label,
      retentionHours: scope.retentionHours,
      workspaceIds: scope.workspaceIds,
      workspaceCount: scope.workspaceIds.length,
      rowsDeleted,
      rowsFailed,
      filesTotal: stats.filesTotal ?? 0,
      filesDeleted,
      filesFailed,
      snapshotsCleaned: stats.snapshotsCleaned ?? 0,
      durationSeconds: stats.durationSeconds,
    },
  })
}
