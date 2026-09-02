interface ProductionTaskCreatorMembership {
  agentCode: string | null
  disciplineCode: string | null
}

const PRODUCTION_TASK_CREATOR_CODES = new Set(['chief_director', 'show_director', 'pmo'])

export function canCreateProductionTask(
  memberships: readonly ProductionTaskCreatorMembership[]
): boolean {
  return memberships.some(
    (membership) =>
      (membership.agentCode !== null && PRODUCTION_TASK_CREATOR_CODES.has(membership.agentCode)) ||
      (membership.disciplineCode !== null &&
        PRODUCTION_TASK_CREATOR_CODES.has(membership.disciplineCode))
  )
}
