import { db } from '@sim/db'
import { personalCanvasWorkspace, workgroup } from '@sim/db/schema'
import { inArray } from 'drizzle-orm'

export type WorkspaceCanvasScope = 'personal' | 'team' | null

interface WorkspaceCanvasMetadataInput {
  id: string
  workgroupId?: string | null
  [key: string]: unknown
}

interface PersonalCanvasWorkspaceLookup {
  workspaceId: string
  workgroupId: string
}

interface WorkgroupLookup {
  id: string
  disciplineId: string | null
}

export interface WorkspaceCanvasMetadata {
  canvasScope: WorkspaceCanvasScope
  workgroupId: string | null
  disciplineId: string | null
  isInternalWorkspace: boolean
}

interface WorkspaceCanvasLookup {
  personalWorkspaces: PersonalCanvasWorkspaceLookup[]
  workgroups: WorkgroupLookup[]
}

/** Adds collaboration canvas compatibility fields to legacy workspace API rows. */
export function mergeWorkspaceCanvasMetadata<T extends WorkspaceCanvasMetadataInput>(
  workspaces: T[],
  lookup: WorkspaceCanvasLookup
): Array<T & WorkspaceCanvasMetadata> {
  const personalByWorkspaceId = new Map(
    lookup.personalWorkspaces.map((row) => [row.workspaceId, row])
  )
  const workgroupById = new Map(lookup.workgroups.map((row) => [row.id, row]))

  return workspaces.map((workspace) => {
    const personalCanvas = personalByWorkspaceId.get(workspace.id)
    if (personalCanvas) {
      return {
        ...workspace,
        canvasScope: 'personal',
        workgroupId: personalCanvas.workgroupId,
        disciplineId: workgroupById.get(personalCanvas.workgroupId)?.disciplineId ?? null,
        isInternalWorkspace: true,
      }
    }

    if (workspace.workgroupId) {
      return {
        ...workspace,
        canvasScope: 'team',
        workgroupId: workspace.workgroupId,
        disciplineId: workgroupById.get(workspace.workgroupId)?.disciplineId ?? null,
        isInternalWorkspace: true,
      }
    }

    return {
      ...workspace,
      workgroupId: workspace.workgroupId ?? null,
      canvasScope: null,
      disciplineId: null,
      isInternalWorkspace: false,
    }
  })
}

/** Loads and attaches collaboration canvas metadata for workspace API compatibility. */
export async function annotateWorkspaceCanvasMetadata<T extends WorkspaceCanvasMetadataInput>(
  workspaces: T[]
): Promise<Array<T & WorkspaceCanvasMetadata>> {
  if (workspaces.length === 0) {
    return []
  }

  const workspaceIds = workspaces.map((workspace) => workspace.id)
  const personalWorkspaces = await db
    .select({
      workspaceId: personalCanvasWorkspace.workspaceId,
      workgroupId: personalCanvasWorkspace.workgroupId,
    })
    .from(personalCanvasWorkspace)
    .where(inArray(personalCanvasWorkspace.workspaceId, workspaceIds))

  const workgroupIds = [
    ...new Set([
      ...workspaces.flatMap((workspace) => (workspace.workgroupId ? [workspace.workgroupId] : [])),
      ...personalWorkspaces.map((row) => row.workgroupId),
    ]),
  ]

  const workgroups =
    workgroupIds.length > 0
      ? await db
          .select({
            id: workgroup.id,
            disciplineId: workgroup.disciplineId,
          })
          .from(workgroup)
          .where(inArray(workgroup.id, workgroupIds))
      : []

  return mergeWorkspaceCanvasMetadata(workspaces, { personalWorkspaces, workgroups })
}
