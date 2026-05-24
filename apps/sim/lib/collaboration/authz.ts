import { db } from '@sim/db'
import {
  member,
  personalCanvasWorkspace,
  workflowPublicationScope,
  workflowPublicationVersion,
  workgroup,
  workgroupMember,
} from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'

/** Checks whether the user owns the personal canvas workspace. */
export async function canReadPersonalCanvas(userId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: personalCanvasWorkspace.id })
    .from(personalCanvasWorkspace)
    .where(
      and(
        eq(personalCanvasWorkspace.userId, userId),
        eq(personalCanvasWorkspace.workspaceId, workspaceId)
      )
    )
    .limit(1)

  return Boolean(row)
}

/** Checks whether the user can mutate the personal canvas workspace. */
export async function canWritePersonalCanvas(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  return canReadPersonalCanvas(userId, workspaceId)
}

/** Checks whether the user belongs to the team canvas workgroup. */
export async function canReadTeamCanvas(userId: string, workgroupId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workgroupMember.id })
    .from(workgroupMember)
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .where(
      and(
        eq(workgroupMember.userId, userId),
        eq(workgroupMember.workgroupId, workgroupId),
        isNull(workgroup.archivedAt)
      )
    )
    .limit(1)

  return Boolean(row)
}

/** Checks whether the user can mutate the team canvas. */
export async function canWriteTeamCanvas(userId: string, workgroupId: string): Promise<boolean> {
  return canReadTeamCanvas(userId, workgroupId)
}

/** Checks whether the user can publish the team's canvas into showcase state. */
export async function canPublishTeamCanvas(userId: string, workgroupId: string): Promise<boolean> {
  const [team] = await db
    .select({ organizationId: workgroup.organizationId })
    .from(workgroup)
    .where(and(eq(workgroup.id, workgroupId), isNull(workgroup.archivedAt)))
    .limit(1)

  if (!team) return false

  const [membership] = await db
    .select({ role: workgroupMember.role })
    .from(workgroupMember)
    .where(and(eq(workgroupMember.userId, userId), eq(workgroupMember.workgroupId, workgroupId)))
    .limit(1)

  if (membership?.role === 'admin') return true

  const [organizationMember] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, team.organizationId)))
    .limit(1)

  return organizationMember?.role === 'owner' || organizationMember?.role === 'admin'
}

/** Checks whether the user can read a showcase publication version. */
export async function canReadPublication(
  userId: string,
  publicationVersionId: string
): Promise<boolean> {
  const [publication] = await db
    .select({
      organizationId: workflowPublicationVersion.organizationId,
      sourceWorkgroupId: workflowPublicationVersion.sourceWorkgroupId,
      visibility: workflowPublicationVersion.visibility,
      publishedWorkflowId: workflowPublicationVersion.publishedWorkflowId,
      status: workflowPublicationVersion.status,
    })
    .from(workflowPublicationVersion)
    .where(eq(workflowPublicationVersion.id, publicationVersionId))
    .limit(1)

  if (!publication || publication.status === 'retracted') return false

  const [organizationMembership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, publication.organizationId)))
    .limit(1)

  if (organizationMembership?.role === 'owner' || organizationMembership?.role === 'admin') {
    return true
  }

  const [sourceMembership] = await db
    .select({ id: workgroupMember.id })
    .from(workgroupMember)
    .innerJoin(workgroup, eq(workgroupMember.workgroupId, workgroup.id))
    .where(
      and(
        eq(workgroupMember.userId, userId),
        eq(workgroupMember.workgroupId, publication.sourceWorkgroupId),
        isNull(workgroup.archivedAt)
      )
    )
    .limit(1)

  if (sourceMembership) return true

  if (publication.visibility === 'organization') {
    return Boolean(organizationMembership)
  }

  if (!publication.publishedWorkflowId) return false

  const [scopedMembership] = await db
    .select({ id: workflowPublicationScope.id })
    .from(workflowPublicationScope)
    .innerJoin(
      workgroupMember,
      eq(workflowPublicationScope.viewerWorkgroupId, workgroupMember.workgroupId)
    )
    .innerJoin(workgroup, eq(workflowPublicationScope.viewerWorkgroupId, workgroup.id))
    .where(
      and(
        eq(workflowPublicationScope.workflowId, publication.publishedWorkflowId),
        eq(workgroupMember.userId, userId),
        isNull(workgroup.archivedAt)
      )
    )
    .limit(1)

  return Boolean(scopedMembership)
}
