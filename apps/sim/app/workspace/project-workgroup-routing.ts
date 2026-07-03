export interface ProjectWorkgroupRoutingSummary {
  discipline?: {
    agentCode?: string | null
    code?: string | null
  } | null
  id: string
  organizationId?: string | null
  role?: string | null
}

export function isDirectorLikeProjectWorkgroup(workgroup: ProjectWorkgroupRoutingSummary) {
  const agentCode = workgroup.discipline?.agentCode
  const disciplineCode = workgroup.discipline?.code
  return (
    agentCode === 'chief_director' ||
    agentCode === 'show_director' ||
    disciplineCode === 'chief_director' ||
    disciplineCode === 'show_director' ||
    disciplineCode === 'pmo'
  )
}

export function getProjectWorkgroupPreferenceRank(
  workgroup: ProjectWorkgroupRoutingSummary,
  defaultWorkgroupId?: string | null
) {
  return [
    isDirectorLikeProjectWorkgroup(workgroup) ? 4 : 0,
    workgroup.id === defaultWorkgroupId ? 2 : 0,
    workgroup.role === 'admin' ? 1 : 0,
  ] as const
}

export function shouldReplaceProjectPrimaryWorkgroup({
  candidate,
  current,
  defaultWorkgroupId,
}: {
  candidate: ProjectWorkgroupRoutingSummary
  current: ProjectWorkgroupRoutingSummary
  defaultWorkgroupId?: string | null
}) {
  const candidateRank = getProjectWorkgroupPreferenceRank(candidate, defaultWorkgroupId)
  const currentRank = getProjectWorkgroupPreferenceRank(current, defaultWorkgroupId)

  for (let index = 0; index < candidateRank.length; index += 1) {
    if (candidateRank[index] !== currentRank[index]) {
      return candidateRank[index] > currentRank[index]
    }
  }

  return false
}

export function selectPreferredProjectWorkgroup<TWorkgroup extends ProjectWorkgroupRoutingSummary>({
  defaultWorkgroupId,
  organizationId,
  workgroups,
}: {
  defaultWorkgroupId?: string | null
  organizationId?: string | null
  workgroups: TWorkgroup[]
}) {
  const scopedWorkgroups = organizationId
    ? workgroups.filter((workgroup) => workgroup.organizationId === organizationId)
    : workgroups
  let selected = scopedWorkgroups[0]

  for (const workgroup of scopedWorkgroups.slice(1)) {
    if (
      selected &&
      shouldReplaceProjectPrimaryWorkgroup({
        candidate: workgroup,
        current: selected,
        defaultWorkgroupId,
      })
    ) {
      selected = workgroup
    }
  }

  return selected
}
