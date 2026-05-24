import type { PublicationSummary, WorkgroupAdminSummary } from '@/lib/api/contracts/collaboration'

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

export interface PublicationConflictRepairGuideStep {
  alertCode: PublicationGovernanceAlert['code']
  severity: PublicationGovernanceAlertSeverity
  title: string
  detail: string
  actionLabel: string
  reason: string
}

export interface PublicationApprovalWorkflowStep {
  id: 'assign_reviewer' | 'start_review' | 'resolve_critical_risk' | 'record_decision' | 'approved'
  status: 'complete' | 'ready' | 'blocked'
  title: string
  detail: string
  actionLabel: string | null
}

export interface PublicationDependencyConflictAlert {
  id: string
  code:
    | 'missing_dependency'
    | 'non_current_dependency'
    | 'unapproved_dependency'
    | 'critical_dependency'
  severity: PublicationGovernanceAlertSeverity
  publicationId: string
  publicationTitle: string
  publicationVersionNumber: number
  publicationWorkgroupName: string
  dependencyPublicationId: string | null
  dependencyTitle: string
  dependencyWorkgroupName: string | null
  currentDependencyPublicationId: string | null
  currentDependencyVersionNumber: number | null
  detail: string
  actionLabel: string
}

export interface PublicationDependencyResolutionAction {
  id: string
  alertId: string
  operation: 'open' | 'review' | 'lifecycle'
  type:
    | 'open_current_dependency'
    | 'request_source_update'
    | 'approve_dependency'
    | 'triage_dependency_risk'
    | 'restore_dependency'
  severity: PublicationGovernanceAlertSeverity
  targetRole: 'source' | 'dependency'
  targetPublicationId: string
  targetTitle: string
  actionLabel: string
  detail: string
  reviewState: PublicationSummary['reviewState'] | null
  riskLevel: PublicationSummary['riskLevel'] | null
  lifecycleAction: 'restore' | null
  successMessage: string
}

export interface PublicationReviewNotification {
  id: string
  type:
    | 'reviewer_unassigned'
    | 'reviewer_action_required'
    | 'changes_requested'
    | 'critical_risk'
    | 'dependency_conflict'
  severity: PublicationGovernanceAlertSeverity
  publicationId: string
  publicationTitle: string
  publicationVersionNumber: number
  publicationWorkgroupName: string
  reviewerUserId: string | null
  detail: string
  actionLabel: string
}

export interface PublicationNotificationDeliveryDraft {
  id: string
  channel: 'in_app' | 'email' | 'webhook'
  severity: PublicationGovernanceAlertSeverity
  title: string
  detail: string
  actionLabel: string
  body: string
  payload: {
    event: 'publication.review_notifications.digest'
    projectName: string
    notificationCount: number
    dangerCount: number
    warningCount: number
    notifications: {
      id: string
      type: PublicationReviewNotification['type']
      severity: PublicationGovernanceAlertSeverity
      publicationId: string
      publicationTitle: string
      publicationWorkgroupName: string
      reviewerUserId: string | null
      actionLabel: string
    }[]
  }
}

export interface PublicationTeamNudge {
  id: string
  type: 'never_published' | 'missing_current' | 'stale_current'
  severity: PublicationGovernanceAlertSeverity
  teamId: string
  teamName: string
  teamWorkspaceId: string | null
  disciplineName: string
  agentCode: string
  publicationId: string | null
  versionNumber: number | null
  detail: string
  actionLabel: string
}

export interface PublicationStateGroupOptions {
  now?: Date
  staleDays?: number
}

function getPublicationGroupId(publication: PublicationSummary): string {
  return [
    publication.sourceDiscipline.code,
    publication.sourceWorkgroup.id,
    publication.agentCode,
  ].join(':')
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

function formatVersionNumbers(versions: PublicationStateNode[]): string {
  return versions.map((version) => `v${version.versionNumber}`).join(', ')
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

export function buildPublicationConflictRepairGuide(
  group: PublicationStateGroup | null
): PublicationConflictRepairGuideStep[] {
  if (!group) return []
  const alertByCode = new Map(group.governanceAlerts.map((alert) => [alert.code, alert]))
  const steps: PublicationConflictRepairGuideStep[] = []
  const currentVersions = group.versions.filter((version) => version.status === 'published')

  const multipleCurrentAlert = alertByCode.get('multiple_current_versions')
  if (multipleCurrentAlert) {
    const extraCurrentVersions = currentVersions.filter(
      (version) => version.id !== group.current?.id
    )
    steps.push({
      alertCode: 'multiple_current_versions',
      severity: multipleCurrentAlert.severity,
      title: 'Resolve duplicate current versions first',
      detail: `Keep ${group.current ? `v${group.current.versionNumber}` : 'the newest version'} as the canonical current publication and archive ${formatVersionNumbers(extraCurrentVersions) || 'the extra current versions'}.`,
      actionLabel: 'Archive duplicate current',
      reason:
        'Showcase readers and dependent teams need exactly one current version before review or risk metadata is meaningful.',
    })
  }

  const noCurrentAlert = alertByCode.get('no_current_version')
  if (noCurrentAlert) {
    steps.push({
      alertCode: 'no_current_version',
      severity: noCurrentAlert.severity,
      title: 'Restore a visible version',
      detail: group.current
        ? `Restore v${group.current.versionNumber} so the team has a current showcase baseline.`
        : 'Restore the latest visible non-retracted version so the team has a current showcase baseline.',
      actionLabel: 'Restore latest visible',
      reason:
        'Downstream dependency checks and status-tree governance rely on a current publication node.',
    })
  }

  const unapprovedAlert = alertByCode.get('unapproved_current_version')
  if (unapprovedAlert && group.current) {
    steps.push({
      alertCode: 'unapproved_current_version',
      severity: unapprovedAlert.severity,
      title: 'Close the review gap',
      detail: `Move v${group.current.versionNumber} from ${formatGovernanceReviewState(group.current.reviewState)} to approved after project review is complete.`,
      actionLabel: 'Approve current version',
      reason:
        'Approval should happen after structural conflicts are resolved so the approval reflects the final current version.',
    })
  }

  const staleAlert = alertByCode.get('stale_current_version')
  if (staleAlert && group.current) {
    steps.push({
      alertCode: 'stale_current_version',
      severity: staleAlert.severity,
      title: 'Start a refresh review',
      detail: `Mark v${group.current.versionNumber} as in review and ask the source team to confirm whether a newer team canvas state should be published.`,
      actionLabel: 'Start refresh review',
      reason:
        'Stale current versions are not necessarily wrong, but they need an explicit review trail before project sign-off.',
    })
  }

  const criticalRiskAlert = alertByCode.get('critical_risk_current_version')
  if (criticalRiskAlert && group.current) {
    steps.push({
      alertCode: 'critical_risk_current_version',
      severity: criticalRiskAlert.severity,
      title: 'Triage the critical risk marker',
      detail: `Lower v${group.current.versionNumber} to high only after the critical blocker has an owner, mitigation, or accepted risk decision.`,
      actionLabel: 'Set risk to high',
      reason:
        'Critical risk should not remain on the project current baseline unless it blocks downstream teams.',
    })
  }

  return steps
}

export function buildPublicationApprovalWorkflow(
  publication: PublicationSummary | null
): PublicationApprovalWorkflowStep[] {
  if (!publication) return []
  const hasReviewer = Boolean(publication.reviewer?.userId)
  const reviewStarted = Boolean(
    publication.reviewState &&
      ['in_review', 'approved', 'changes_requested', 'rejected'].includes(publication.reviewState)
  )
  const criticalRiskOpen = publication.riskLevel === 'critical'
  const approved = publication.reviewState === 'approved'

  return [
    {
      id: 'assign_reviewer',
      status: hasReviewer ? 'complete' : 'ready',
      title: 'Assign reviewer',
      detail: hasReviewer
        ? 'A reviewer owns the project decision for this publication.'
        : 'Choose an organization roster member before moving the publication through approval.',
      actionLabel: hasReviewer ? null : 'Assign reviewer',
    },
    {
      id: 'start_review',
      status: reviewStarted ? 'complete' : hasReviewer ? 'ready' : 'blocked',
      title: 'Start review',
      detail: reviewStarted
        ? `Review is ${formatGovernanceReviewState(publication.reviewState)}.`
        : hasReviewer
          ? 'Move the publication into review so the reviewer has an explicit work queue.'
          : 'Reviewer assignment is required before review starts.',
      actionLabel: reviewStarted ? null : 'Start review',
    },
    {
      id: 'resolve_critical_risk',
      status: criticalRiskOpen ? (reviewStarted ? 'ready' : 'blocked') : 'complete',
      title: 'Resolve critical risk',
      detail: criticalRiskOpen
        ? 'Critical risk must be triaged before this version can be approved for the project tree.'
        : 'No critical risk marker blocks approval.',
      actionLabel: criticalRiskOpen ? 'Set risk to high' : null,
    },
    {
      id: approved ? 'approved' : 'record_decision',
      status: approved
        ? 'complete'
        : hasReviewer && reviewStarted && !criticalRiskOpen
          ? 'ready'
          : 'blocked',
      title: approved ? 'Approved' : 'Record decision',
      detail: approved
        ? 'The current publication has a recorded project approval.'
        : hasReviewer && reviewStarted && !criticalRiskOpen
          ? 'Approve, request changes, or reject the reviewed publication.'
          : 'Complete reviewer, review, and critical-risk gates before recording a decision.',
      actionLabel: approved ? null : 'Record decision',
    },
  ]
}

export function buildPublicationDependencyConflictAlerts(
  publications: PublicationSummary[],
  groups: PublicationStateGroup[] = buildPublicationStateGroups(publications)
): PublicationDependencyConflictAlert[] {
  const publicationById = new Map(publications.map((publication) => [publication.id, publication]))
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const alerts: PublicationDependencyConflictAlert[] = []

  for (const publication of publications) {
    if (publication.status !== 'published') continue

    for (const dependencyId of publication.dependsOnPublicationIds) {
      const dependency = publicationById.get(dependencyId)
      if (!dependency) {
        alerts.push({
          id: `${publication.id}:${dependencyId}:missing`,
          code: 'missing_dependency',
          severity: 'danger',
          publicationId: publication.id,
          publicationTitle: publication.title,
          publicationVersionNumber: publication.versionNumber,
          publicationWorkgroupName: publication.sourceWorkgroup.name,
          dependencyPublicationId: null,
          dependencyTitle: dependencyId,
          dependencyWorkgroupName: null,
          currentDependencyPublicationId: null,
          currentDependencyVersionNumber: null,
          detail:
            'Current publication depends on a version that is not visible in the project publication list.',
          actionLabel: 'Resolve missing dependency',
        })
        continue
      }

      if (dependency.sourceWorkgroup.id === publication.sourceWorkgroup.id) continue

      const dependencyGroup = groupById.get(getPublicationGroupId(dependency))
      const currentDependency =
        dependencyGroup?.versions.find((version) => version.status === 'published') ?? null
      const dependencyIsCurrent =
        dependency.status === 'published' && currentDependency?.id === dependency.id

      if (!dependencyIsCurrent) {
        alerts.push({
          id: `${publication.id}:${dependency.id}:non-current`,
          code: 'non_current_dependency',
          severity: dependency.status === 'retracted' ? 'danger' : 'warning',
          publicationId: publication.id,
          publicationTitle: publication.title,
          publicationVersionNumber: publication.versionNumber,
          publicationWorkgroupName: publication.sourceWorkgroup.name,
          dependencyPublicationId: dependency.id,
          dependencyTitle: dependency.title,
          dependencyWorkgroupName: dependency.sourceWorkgroup.name,
          currentDependencyPublicationId: currentDependency?.id ?? null,
          currentDependencyVersionNumber: currentDependency?.versionNumber ?? null,
          detail: currentDependency
            ? `Depends on v${dependency.versionNumber}, but v${currentDependency.versionNumber} is the current ${dependency.sourceWorkgroup.name} baseline.`
            : `Depends on v${dependency.versionNumber}, which is ${dependency.status} and has no current baseline in this state tree.`,
          actionLabel: 'Review dependency baseline',
        })
      }

      if (dependency.reviewState !== 'approved') {
        alerts.push({
          id: `${publication.id}:${dependency.id}:unapproved`,
          code: 'unapproved_dependency',
          severity: 'warning',
          publicationId: publication.id,
          publicationTitle: publication.title,
          publicationVersionNumber: publication.versionNumber,
          publicationWorkgroupName: publication.sourceWorkgroup.name,
          dependencyPublicationId: dependency.id,
          dependencyTitle: dependency.title,
          dependencyWorkgroupName: dependency.sourceWorkgroup.name,
          currentDependencyPublicationId: currentDependency?.id ?? null,
          currentDependencyVersionNumber: currentDependency?.versionNumber ?? null,
          detail: `Dependency v${dependency.versionNumber} is ${formatGovernanceReviewState(dependency.reviewState)}.`,
          actionLabel: 'Review dependency approval',
        })
      }

      if (dependency.riskLevel === 'critical') {
        alerts.push({
          id: `${publication.id}:${dependency.id}:critical-risk`,
          code: 'critical_dependency',
          severity: 'danger',
          publicationId: publication.id,
          publicationTitle: publication.title,
          publicationVersionNumber: publication.versionNumber,
          publicationWorkgroupName: publication.sourceWorkgroup.name,
          dependencyPublicationId: dependency.id,
          dependencyTitle: dependency.title,
          dependencyWorkgroupName: dependency.sourceWorkgroup.name,
          currentDependencyPublicationId: currentDependency?.id ?? null,
          currentDependencyVersionNumber: currentDependency?.versionNumber ?? null,
          detail: `Dependency v${dependency.versionNumber} is marked critical risk.`,
          actionLabel: 'Triage dependency risk',
        })
      }
    }
  }

  const severityOrder = { danger: 0, warning: 1, info: 2 }
  return alerts.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.publicationWorkgroupName.localeCompare(right.publicationWorkgroupName) ||
      left.publicationTitle.localeCompare(right.publicationTitle) ||
      left.code.localeCompare(right.code)
  )
}

export function buildPublicationDependencyResolutionActions(
  alerts: PublicationDependencyConflictAlert[],
  publications: PublicationSummary[]
): PublicationDependencyResolutionAction[] {
  const publicationById = new Map(publications.map((publication) => [publication.id, publication]))
  const actions: PublicationDependencyResolutionAction[] = []
  const sourceUpdateActionIds = new Set<string>()

  for (const alert of alerts) {
    const sourcePublication = publicationById.get(alert.publicationId)
    const dependencyPublication = alert.dependencyPublicationId
      ? publicationById.get(alert.dependencyPublicationId)
      : null
    const currentDependencyPublication = alert.currentDependencyPublicationId
      ? publicationById.get(alert.currentDependencyPublicationId)
      : null

    if (!sourcePublication) continue

    if (
      (alert.code === 'missing_dependency' || alert.code === 'non_current_dependency') &&
      sourcePublication.reviewState !== 'changes_requested' &&
      !sourceUpdateActionIds.has(sourcePublication.id)
    ) {
      sourceUpdateActionIds.add(sourcePublication.id)
      actions.push({
        id: `${alert.id}:request-source-update`,
        alertId: alert.id,
        operation: 'review',
        type: 'request_source_update',
        severity: alert.severity,
        targetRole: 'source',
        targetPublicationId: sourcePublication.id,
        targetTitle: sourcePublication.title,
        actionLabel: 'Request source update',
        detail:
          alert.code === 'missing_dependency'
            ? 'Mark the source publication as changes requested so the source team republishes with a visible dependency.'
            : 'Mark the source publication as changes requested so the source team repoints to the current dependency baseline.',
        reviewState: 'changes_requested',
        riskLevel: sourcePublication.riskLevel,
        lifecycleAction: null,
        successMessage: `Requested dependency update for ${sourcePublication.title}.`,
      })
    }

    if (alert.code === 'non_current_dependency' && currentDependencyPublication) {
      actions.push({
        id: `${alert.id}:open-current-dependency`,
        alertId: alert.id,
        operation: 'open',
        type: 'open_current_dependency',
        severity: 'info',
        targetRole: 'dependency',
        targetPublicationId: currentDependencyPublication.id,
        targetTitle: currentDependencyPublication.title,
        actionLabel: `Open current v${currentDependencyPublication.versionNumber}`,
        detail:
          'Open the current dependency baseline before deciding whether the source should repoint.',
        reviewState: null,
        riskLevel: null,
        lifecycleAction: null,
        successMessage: `Opened current dependency ${currentDependencyPublication.title}.`,
      })
    }

    if (
      alert.code === 'non_current_dependency' &&
      !currentDependencyPublication &&
      dependencyPublication &&
      (dependencyPublication.status === 'archived' || dependencyPublication.status === 'superseded')
    ) {
      actions.push({
        id: `${alert.id}:restore-dependency`,
        alertId: alert.id,
        operation: 'lifecycle',
        type: 'restore_dependency',
        severity: alert.severity,
        targetRole: 'dependency',
        targetPublicationId: dependencyPublication.id,
        targetTitle: dependencyPublication.title,
        actionLabel: 'Restore dependency baseline',
        detail: 'Restore this visible dependency version when no newer current baseline exists.',
        reviewState: null,
        riskLevel: null,
        lifecycleAction: 'restore',
        successMessage: `Restored dependency baseline ${dependencyPublication.title}.`,
      })
    }

    if (
      alert.code === 'unapproved_dependency' &&
      dependencyPublication &&
      dependencyPublication.reviewState !== 'approved'
    ) {
      actions.push({
        id: `${alert.id}:approve-dependency`,
        alertId: alert.id,
        operation: 'review',
        type: 'approve_dependency',
        severity: alert.severity,
        targetRole: 'dependency',
        targetPublicationId: dependencyPublication.id,
        targetTitle: dependencyPublication.title,
        actionLabel: 'Approve dependency',
        detail:
          'Approve the dependency publication so downstream source versions can pass sign-off.',
        reviewState: 'approved',
        riskLevel: dependencyPublication.riskLevel,
        lifecycleAction: null,
        successMessage: `Approved dependency ${dependencyPublication.title}.`,
      })
    }

    if (
      alert.code === 'critical_dependency' &&
      dependencyPublication &&
      dependencyPublication.riskLevel === 'critical'
    ) {
      actions.push({
        id: `${alert.id}:triage-dependency-risk`,
        alertId: alert.id,
        operation: 'review',
        type: 'triage_dependency_risk',
        severity: alert.severity,
        targetRole: 'dependency',
        targetPublicationId: dependencyPublication.id,
        targetTitle: dependencyPublication.title,
        actionLabel: 'Lower dependency risk',
        detail:
          'Lower the dependency risk marker after the critical blocker has a mitigation or accepted-risk decision.',
        reviewState: dependencyPublication.reviewState,
        riskLevel: 'high',
        lifecycleAction: null,
        successMessage: `Lowered dependency risk for ${dependencyPublication.title}.`,
      })
    }
  }

  const severityOrder = { danger: 0, warning: 1, info: 2 }
  const typeOrder: Record<PublicationDependencyResolutionAction['type'], number> = {
    triage_dependency_risk: 0,
    restore_dependency: 1,
    approve_dependency: 2,
    request_source_update: 3,
    open_current_dependency: 4,
  }

  return actions.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      typeOrder[left.type] - typeOrder[right.type] ||
      left.targetTitle.localeCompare(right.targetTitle)
  )
}

export function buildPublicationNotificationDeliveryDrafts(
  notifications: PublicationReviewNotification[],
  options: { projectName?: string } = {}
): PublicationNotificationDeliveryDraft[] {
  if (notifications.length === 0) return []

  const projectName = options.projectName?.trim() || 'Project'
  const dangerCount = notifications.filter(
    (notification) => notification.severity === 'danger'
  ).length
  const warningCount = notifications.filter(
    (notification) => notification.severity === 'warning'
  ).length
  const severity: PublicationGovernanceAlertSeverity = dangerCount > 0 ? 'danger' : 'warning'
  const summary = `${notifications.length} publication review notification${notifications.length === 1 ? '' : 's'} need attention in ${projectName}.`
  const bodyLines = [
    summary,
    '',
    ...notifications
      .slice(0, 10)
      .map((notification, index) =>
        [
          `${index + 1}. ${notification.publicationWorkgroupName} / v${notification.publicationVersionNumber} / ${notification.publicationTitle}`,
          `   Type: ${notification.type.replaceAll('_', ' ')}`,
          `   Severity: ${notification.severity}`,
          `   Action: ${notification.actionLabel}`,
          `   Detail: ${notification.detail}`,
        ].join('\n')
      ),
  ]
  if (notifications.length > 10) {
    bodyLines.push(
      '',
      `+${notifications.length - 10} more notifications in the project admin queue.`
    )
  }

  const payload: PublicationNotificationDeliveryDraft['payload'] = {
    event: 'publication.review_notifications.digest',
    projectName,
    notificationCount: notifications.length,
    dangerCount,
    warningCount,
    notifications: notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      severity: notification.severity,
      publicationId: notification.publicationId,
      publicationTitle: notification.publicationTitle,
      publicationWorkgroupName: notification.publicationWorkgroupName,
      reviewerUserId: notification.reviewerUserId,
      actionLabel: notification.actionLabel,
    })),
  }

  return [
    {
      id: 'publication-review-in-app-digest',
      channel: 'in_app',
      severity,
      title: 'In-app bell digest',
      detail: 'Queue a local in-app digest for the project admin session.',
      actionLabel: 'Send bell digest',
      body: summary,
      payload,
    },
    {
      id: 'publication-review-email-digest',
      channel: 'email',
      severity,
      title: 'Email digest draft',
      detail: 'Copy a reviewer-ready digest for an email delivery channel.',
      actionLabel: 'Copy email draft',
      body: bodyLines.join('\n'),
      payload,
    },
    {
      id: 'publication-review-webhook-payload',
      channel: 'webhook',
      severity,
      title: 'Webhook payload draft',
      detail: 'Copy a structured payload for external notification routing.',
      actionLabel: 'Copy webhook JSON',
      body: JSON.stringify(payload, null, 2),
      payload,
    },
  ]
}

export function buildPublicationReviewNotifications(
  publications: PublicationSummary[],
  groups: PublicationStateGroup[] = buildPublicationStateGroups(publications),
  dependencyAlerts: PublicationDependencyConflictAlert[] = buildPublicationDependencyConflictAlerts(
    publications,
    groups
  )
): PublicationReviewNotification[] {
  const currentPublicationIds = new Set(
    groups.flatMap((group) =>
      group.versions
        .filter((version) => version.status === 'published')
        .map((version) => version.id)
    )
  )
  const dependencyAlertSummaryByPublicationId = new Map<
    string,
    { count: number; severity: PublicationGovernanceAlertSeverity }
  >()
  const severityOrder = { danger: 0, warning: 1, info: 2 }

  for (const alert of dependencyAlerts) {
    const summary = dependencyAlertSummaryByPublicationId.get(alert.publicationId)
    if (!summary) {
      dependencyAlertSummaryByPublicationId.set(alert.publicationId, {
        count: 1,
        severity: alert.severity,
      })
      continue
    }
    summary.count += 1
    if (severityOrder[alert.severity] < severityOrder[summary.severity]) {
      summary.severity = alert.severity
    }
  }

  const notifications: PublicationReviewNotification[] = []

  for (const publication of publications) {
    if (!currentPublicationIds.has(publication.id)) continue

    const reviewerUserId = publication.reviewer?.userId ?? null
    const dependencySummary = dependencyAlertSummaryByPublicationId.get(publication.id)
    const hasOpenReview = publication.reviewState !== 'approved'
    const hasCriticalRisk = publication.riskLevel === 'critical'
    const needsReviewer = hasOpenReview || hasCriticalRisk || Boolean(dependencySummary)

    if (!reviewerUserId && needsReviewer) {
      notifications.push({
        id: `${publication.id}:reviewer-unassigned`,
        type: 'reviewer_unassigned',
        severity: hasCriticalRisk ? 'danger' : 'warning',
        publicationId: publication.id,
        publicationTitle: publication.title,
        publicationVersionNumber: publication.versionNumber,
        publicationWorkgroupName: publication.sourceWorkgroup.name,
        reviewerUserId,
        detail: hasOpenReview
          ? `v${publication.versionNumber} is ${formatGovernanceReviewState(publication.reviewState)} and needs an explicit reviewer owner.`
          : `v${publication.versionNumber} needs a reviewer owner before dependency or risk follow-up closes.`,
        actionLabel: 'Assign reviewer',
      })
    }

    if (
      reviewerUserId &&
      (publication.reviewState === 'pending' || publication.reviewState === 'in_review')
    ) {
      notifications.push({
        id: `${publication.id}:reviewer-action`,
        type: 'reviewer_action_required',
        severity: 'warning',
        publicationId: publication.id,
        publicationTitle: publication.title,
        publicationVersionNumber: publication.versionNumber,
        publicationWorkgroupName: publication.sourceWorkgroup.name,
        reviewerUserId,
        detail:
          publication.reviewState === 'pending'
            ? `v${publication.versionNumber} is assigned but review has not started.`
            : `v${publication.versionNumber} is in review and needs a recorded decision.`,
        actionLabel: publication.reviewState === 'pending' ? 'Start review' : 'Record decision',
      })
    }

    if (publication.reviewState === 'changes_requested') {
      notifications.push({
        id: `${publication.id}:changes-requested`,
        type: 'changes_requested',
        severity: 'warning',
        publicationId: publication.id,
        publicationTitle: publication.title,
        publicationVersionNumber: publication.versionNumber,
        publicationWorkgroupName: publication.sourceWorkgroup.name,
        reviewerUserId,
        detail: `v${publication.versionNumber} has requested changes that should be resolved before approval.`,
        actionLabel: 'Review requested changes',
      })
    }

    if (hasCriticalRisk) {
      notifications.push({
        id: `${publication.id}:critical-risk`,
        type: 'critical_risk',
        severity: 'danger',
        publicationId: publication.id,
        publicationTitle: publication.title,
        publicationVersionNumber: publication.versionNumber,
        publicationWorkgroupName: publication.sourceWorkgroup.name,
        reviewerUserId,
        detail: `v${publication.versionNumber} is marked critical risk and blocks clean approval.`,
        actionLabel: 'Triage critical risk',
      })
    }

    if (dependencySummary) {
      notifications.push({
        id: `${publication.id}:dependency-conflict`,
        type: 'dependency_conflict',
        severity: dependencySummary.severity,
        publicationId: publication.id,
        publicationTitle: publication.title,
        publicationVersionNumber: publication.versionNumber,
        publicationWorkgroupName: publication.sourceWorkgroup.name,
        reviewerUserId,
        detail: `${dependencySummary.count} cross-team dependency alert${dependencySummary.count === 1 ? '' : 's'} should be resolved before project sign-off.`,
        actionLabel: 'Review dependencies',
      })
    }
  }

  const typeOrder: Record<PublicationReviewNotification['type'], number> = {
    critical_risk: 0,
    dependency_conflict: 1,
    reviewer_unassigned: 2,
    reviewer_action_required: 3,
    changes_requested: 4,
  }

  return notifications.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      typeOrder[left.type] - typeOrder[right.type] ||
      left.publicationWorkgroupName.localeCompare(right.publicationWorkgroupName) ||
      left.publicationTitle.localeCompare(right.publicationTitle)
  )
}

export function buildPublicationTeamNudges(params: {
  teams: WorkgroupAdminSummary[]
  groups: PublicationStateGroup[]
}): PublicationTeamNudge[] {
  const groupByWorkgroupId = new Map(
    params.groups.map((group) => [group.sourceWorkgroup.id, group])
  )

  return params.teams
    .filter((team) => Boolean(team.teamWorkspaceId))
    .flatMap((team) => {
      const group = groupByWorkgroupId.get(team.id)
      if (!group) {
        return [
          {
            id: `${team.id}:never-published`,
            type: 'never_published' as const,
            severity: 'info' as const,
            teamId: team.id,
            teamName: team.name,
            teamWorkspaceId: team.teamWorkspaceId,
            disciplineName: team.disciplineName,
            agentCode: team.agentCode,
            publicationId: null,
            versionNumber: null,
            detail: 'No showcase publication has been submitted from this team canvas yet.',
            actionLabel: 'Open team management',
          },
        ]
      }

      const alerts = new Set(group.governanceAlerts.map((alert) => alert.code))
      const nudges: PublicationTeamNudge[] = []
      if (alerts.has('no_current_version')) {
        const restoreCandidate =
          group.current && group.current.status !== 'retracted' ? group.current : null
        nudges.push({
          id: `${team.id}:missing-current`,
          type: 'missing_current',
          severity: 'warning',
          teamId: team.id,
          teamName: team.name,
          teamWorkspaceId: team.teamWorkspaceId,
          disciplineName: team.disciplineName,
          agentCode: team.agentCode,
          publicationId: restoreCandidate?.id ?? null,
          versionNumber: group.current?.versionNumber ?? null,
          detail: restoreCandidate
            ? `Latest visible v${restoreCandidate.versionNumber} is ${restoreCandidate.status}; restore it or ask the team to submit a new current version.`
            : 'No visible publication version can act as the current showcase baseline.',
          actionLabel: restoreCandidate ? 'Restore latest visible' : 'Open team management',
        })
      }

      if (alerts.has('stale_current_version') && group.current) {
        nudges.push({
          id: `${team.id}:stale-current`,
          type: 'stale_current',
          severity: 'warning',
          teamId: team.id,
          teamName: team.name,
          teamWorkspaceId: team.teamWorkspaceId,
          disciplineName: team.disciplineName,
          agentCode: team.agentCode,
          publicationId: group.current.id,
          versionNumber: group.current.versionNumber,
          detail: `Current v${group.current.versionNumber} is past the freshness window; request a team refresh review or confirm it is still valid.`,
          actionLabel: 'Start refresh review',
        })
      }

      return nudges
    })
    .sort((left, right) => {
      const severityOrder = { danger: 0, warning: 1, info: 2 }
      return (
        severityOrder[left.severity] - severityOrder[right.severity] ||
        left.teamName.localeCompare(right.teamName)
      )
    })
}

export function buildPublicationStateGroups(
  publications: PublicationSummary[],
  options: PublicationStateGroupOptions = {}
): PublicationStateGroup[] {
  const groups = new Map<string, PublicationStateGroup>()
  const now = options.now ?? new Date()
  const staleDays = options.staleDays ?? DEFAULT_STALE_DAYS

  for (const publication of publications) {
    const groupId = getPublicationGroupId(publication)
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
