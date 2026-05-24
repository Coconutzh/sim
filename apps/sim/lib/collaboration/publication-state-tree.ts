import type { PublicationSummary } from '@/lib/api/contracts/collaboration'

const DEFAULT_STALE_DAYS = 14

export type PublicationGovernanceAlertSeverity = 'info' | 'warning' | 'danger'

export interface PublicationGovernanceAlert {
  code:
    | 'multiple_current_versions'
    | 'no_current_version'
    | 'stale_current_version'
    | 'unapproved_current_version'
    | 'critical_risk_current_version'
  severity: PublicationGovernanceAlertSeverity
  message: string
}

export interface PublicationStateNode {
  id: string
  title: string
  versionNumber: number
  parentVersionId: string | null
  status: PublicationSummary['status']
  visibility: PublicationSummary['visibility']
  reviewState: PublicationSummary['reviewState']
  riskLevel: PublicationSummary['riskLevel']
  dependsOnPublicationIds: string[]
  dependencyVersionNumbers: number[]
  publishedAt: string
  targetWorkgroupCount: number
}

export interface PublicationStateGroup {
  id: string
  sourceDiscipline: PublicationSummary['sourceDiscipline']
  sourceWorkgroup: PublicationSummary['sourceWorkgroup']
  agentCode: PublicationSummary['agentCode']
  current: PublicationStateNode | null
  history: PublicationStateNode[]
  versions: PublicationStateNode[]
  statusCounts: Record<PublicationSummary['status'], number>
  governanceAlerts: PublicationGovernanceAlert[]
}

export interface PublicationStateGroupOptions {
  now?: Date
  staleDays?: number
}

function toStateNode(publication: PublicationSummary): PublicationStateNode {
  return {
    id: publication.id,
    title: publication.title,
    versionNumber: publication.versionNumber,
    parentVersionId: publication.parentVersionId,
    status: publication.status,
    visibility: publication.visibility,
    reviewState: publication.reviewState,
    riskLevel: publication.riskLevel,
    dependsOnPublicationIds: publication.dependsOnPublicationIds,
    dependencyVersionNumbers: [],
    publishedAt: publication.publishedAt,
    targetWorkgroupCount: publication.targetWorkgroupIds?.length ?? 0,
  }
}

function comparePublicationNodes(left: PublicationStateNode, right: PublicationStateNode): number {
  if (left.versionNumber !== right.versionNumber) {
    return right.versionNumber - left.versionNumber
  }
  return Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
}

function emptyStatusCounts(): Record<PublicationSummary['status'], number> {
  return {
    draft: 0,
    published: 0,
    superseded: 0,
    archived: 0,
    retracted: 0,
  }
}

function formatGovernanceReviewState(reviewState: PublicationSummary['reviewState']): string {
  switch (reviewState) {
    case 'pending':
      return 'pending review'
    case 'in_review':
      return 'in review'
    case 'changes_requested':
      return 'changes requested'
    case 'rejected':
      return 'rejected'
    case 'approved':
      return 'approved'
    default:
      return 'unreviewed'
  }
}

function buildGovernanceAlerts(params: {
  versions: PublicationStateNode[]
  current: PublicationStateNode | null
  now: Date
  staleDays: number
}): PublicationGovernanceAlert[] {
  const alerts: PublicationGovernanceAlert[] = []
  const currentVersions = params.versions.filter((version) => version.status === 'published')

  if (currentVersions.length > 1) {
    alerts.push({
      code: 'multiple_current_versions',
      severity: 'danger',
      message: `${currentVersions.length} current versions need review`,
    })
  }

  if (currentVersions.length === 0) {
    alerts.push({
      code: 'no_current_version',
      severity: 'warning',
      message: 'No current published version is visible',
    })
  }

  if (params.current?.status === 'published') {
    const ageMs = params.now.getTime() - Date.parse(params.current.publishedAt)
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000))
    if (ageDays > params.staleDays) {
      alerts.push({
        code: 'stale_current_version',
        severity: 'warning',
        message: `Current version is ${ageDays} days old`,
      })
    }

    if (params.current.reviewState !== 'approved') {
      alerts.push({
        code: 'unapproved_current_version',
        severity: 'warning',
        message: `Current version is ${formatGovernanceReviewState(params.current.reviewState)}`,
      })
    }

    if (params.current.riskLevel === 'critical') {
      alerts.push({
        code: 'critical_risk_current_version',
        severity: 'danger',
        message: 'Current version is marked critical risk',
      })
    }
  }

  return alerts
}

export function buildPublicationStateGroups(
  publications: PublicationSummary[],
  options: PublicationStateGroupOptions = {}
): PublicationStateGroup[] {
  const groups = new Map<string, PublicationStateGroup>()
  const now = options.now ?? new Date()
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS

  for (const publication of publications) {
    const groupId = [
      publication.sourceDiscipline.code,
      publication.sourceWorkgroup.id,
      publication.agentCode,
    ].join(':')
    const group =
      groups.get(groupId) ??
      ({
        id: groupId,
        sourceDiscipline: publication.sourceDiscipline,
        sourceWorkgroup: publication.sourceWorkgroup,
        agentCode: publication.agentCode,
        current: null,
        history: [],
        versions: [],
        statusCounts: emptyStatusCounts(),
        governanceAlerts: [],
      } satisfies PublicationStateGroup)

    const node = toStateNode(publication)
    group.versions.push(node)
    group.statusCounts[node.status] += 1
    groups.set(groupId, group)
  }

  return Array.from(groups.values())
    .map((group) => {
      const versions = [...group.versions].sort(comparePublicationNodes)
      const versionById = new Map(versions.map((version) => [version.id, version.versionNumber]))
      const linkedVersions = versions.map((version) => ({
        ...version,
        dependencyVersionNumbers: version.dependsOnPublicationIds
          .map((publicationId) => versionById.get(publicationId))
          .filter((versionNumber): versionNumber is number => typeof versionNumber === 'number'),
      }))
      const current =
        linkedVersions.find((version) => version.status === 'published') ??
        linkedVersions[0] ??
        null
      return {
        ...group,
        current,
        history: current
          ? linkedVersions.filter((version) => version.id !== current.id)
          : linkedVersions,
        versions: linkedVersions,
        governanceAlerts: buildGovernanceAlerts({
          versions: linkedVersions,
          current,
          now,
          staleDays,
        }),
      }
    })
    .sort((left, right) => {
      const disciplineCompare = left.sourceDiscipline.name.localeCompare(
        right.sourceDiscipline.name
      )
      if (disciplineCompare !== 0) return disciplineCompare
      return left.sourceWorkgroup.name.localeCompare(right.sourceWorkgroup.name)
    })
}
