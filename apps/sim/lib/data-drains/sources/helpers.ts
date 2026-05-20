import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'

/**
 * Returns the IDs of all workspaces belonging to the organization. Used by
 * sources whose underlying tables are workspace-scoped rather than org-scoped.
 */
export async function getOrganizationWorkspaceIds(organizationId: string): Promise<string[]> {
  const rows = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        eq(workspace.workspaceMode, 'organization'),
        isNull(workspace.archivedAt)
      )
    )
  return rows.map((row) => row.id)
}
