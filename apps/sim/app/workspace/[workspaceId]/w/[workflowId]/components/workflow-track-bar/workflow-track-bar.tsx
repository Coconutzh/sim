'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Input,
  Label,
  Loader,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
  Textarea,
} from '@/components/emcn'
import { useOrganizationWorkgroups } from '@/hooks/queries/collaboration'
import {
  usePublishWorkflow,
  useSyncWorkflowMainline,
  useWorkflowPublication,
} from '@/hooks/queries/workflows'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

type PublicationVisibility = 'organization' | 'selected_workgroups'

interface WorkflowTrackBarProps {
  workspaceId: string
  workflowId: string
  workflow: WorkflowMetadata | undefined
  canPublish: boolean
  organizationId?: string | null
  activeWorkgroupId?: string | null
  onNotify: (message: string, level?: 'info' | 'error') => void
}

function getVisibilityLabel(
  visibility: 'workspace' | 'organization' | 'selected_workgroups' | undefined
): string {
  if (visibility === 'organization') return 'Org Visible'
  if (visibility === 'selected_workgroups') return 'Scoped'
  return 'Team Only'
}

export function WorkflowTrackBar({
  workspaceId,
  workflowId,
  workflow,
  canPublish,
  organizationId,
  activeWorkgroupId,
  onNotify,
}: WorkflowTrackBarProps) {
  const { data: publication } = useWorkflowPublication(workflowId)
  const publishWorkflow = usePublishWorkflow()
  const syncWorkflowMainline = useSyncWorkflowMainline()
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false)
  const [publishTitle, setPublishTitle] = useState('')
  const [publishDescription, setPublishDescription] = useState('')
  const [publishVisibility, setPublishVisibility] = useState<PublicationVisibility>('organization')
  const [publishTargetWorkgroupIds, setPublishTargetWorkgroupIds] = useState<string[]>([])
  const { data: organizationWorkgroupsData, isLoading: isLoadingOrganizationWorkgroups } =
    useOrganizationWorkgroups(isPublishModalOpen && organizationId ? organizationId : undefined)

  const hasPublishedMainline = Boolean(publication?.publishedWorkflowId)
  const trackLabel =
    workflow?.track === 'published'
      ? 'Published Mainline'
      : hasPublishedMainline
        ? 'Team Draft - Mainline published'
        : 'Team Draft'

  const visibilityLabel = getVisibilityLabel(
    workflow?.track === 'published'
      ? (publication?.visibility ?? workflow.visibility)
      : (publication?.visibility ?? workflow?.visibility)
  )
  const publishActionLabel = 'Publish to Mainline'
  const trackActionLabel = hasPublishedMainline ? 'Update Mainline' : publishActionLabel
  const publicationTargetIds = useMemo(
    () => publication?.viewerScopes.map((scope) => scope.workgroupId) ?? [],
    [publication?.viewerScopes]
  )
  const publishTargetWorkgroups = organizationWorkgroupsData?.workgroups ?? []

  useEffect(() => {
    if (!isPublishModalOpen) return
    setPublishTitle(workflow?.name ?? '')
    setPublishDescription('')
    setPublishVisibility(
      publication?.visibility === 'selected_workgroups' ? 'selected_workgroups' : 'organization'
    )
    setPublishTargetWorkgroupIds(publicationTargetIds)
  }, [isPublishModalOpen, publication?.visibility, publicationTargetIds, workflow?.name])

  const handlePublish = async () => {
    const title = publishTitle.trim()
    if (!title) {
      onNotify('Publication title is required', 'error')
      return
    }

    const targetWorkgroupIds =
      publishVisibility === 'selected_workgroups'
        ? publishTargetWorkgroupIds.length > 0
          ? publishTargetWorkgroupIds
          : activeWorkgroupId
            ? [activeWorkgroupId]
            : []
        : []

    try {
      const publishedWorkflow = await publishWorkflow.mutateAsync({
        workflowId,
        workspaceId,
        title,
        description: publishDescription.trim() || undefined,
        visibility: publishVisibility,
        targetWorkgroupIds,
      })

      onNotify(
        `${hasPublishedMainline ? 'Updated' : 'Published'} mainline: ${publishedWorkflow.name}`,
        'info'
      )
      setIsPublishModalOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to publish workflow'
      onNotify(message, 'error')
    }
  }

  const handleSyncMainline = async () => {
    try {
      const publishedWorkflow = await syncWorkflowMainline.mutateAsync({
        workflowId,
        workspaceId,
      })
      onNotify(`Updated mainline: ${publishedWorkflow.name}`, 'info')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update mainline'
      onNotify(message, 'error')
    }
  }

  const handlePublishTargetToggle = (workgroupId: string, checked: boolean) => {
    setPublishTargetWorkgroupIds((current) =>
      checked ? [...new Set([...current, workgroupId])] : current.filter((id) => id !== workgroupId)
    )
  }

  return (
    <>
      <div className='absolute top-4 right-4 left-4 z-10 flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-1)]/95 px-4 py-2 backdrop-blur'>
        <div className='flex items-center gap-3'>
          <div className='rounded-full bg-[var(--surface-3)] px-3 py-1 font-medium text-[var(--text-primary)] text-xs'>
            {trackLabel}
          </div>
          <div className='text-[var(--text-secondary)] text-xs'>{visibilityLabel}</div>
        </div>

        <div className='flex items-center gap-2'>
          {workflow?.track !== 'published' && canPublish && (
            <Button
              variant='default'
              size='sm'
              onClick={() =>
                hasPublishedMainline ? void handleSyncMainline() : setIsPublishModalOpen(true)
              }
              disabled={publishWorkflow.isPending || syncWorkflowMainline.isPending}
            >
              {publishWorkflow.isPending || syncWorkflowMainline.isPending
                ? hasPublishedMainline
                  ? 'Updating...'
                  : 'Publishing...'
                : trackActionLabel}
            </Button>
          )}
        </div>
      </div>

      <Modal open={isPublishModalOpen} onOpenChange={setIsPublishModalOpen}>
        <ModalContent size='lg'>
          <ModalHeader>{publishActionLabel}</ModalHeader>
          <ModalBody className='grid gap-4'>
            <div className='grid gap-2'>
              <Label
                htmlFor='mainline-publication-title'
                className='font-medium text-[12px] text-[var(--text-muted)]'
              >
                Publication title
              </Label>
              <Input
                id='mainline-publication-title'
                value={publishTitle}
                onChange={(event) => setPublishTitle(event.target.value)}
                placeholder={workflow?.name ?? 'Team plan'}
                disabled={publishWorkflow.isPending}
              />
            </div>
            <div className='grid gap-2'>
              <Label
                htmlFor='mainline-publication-description'
                className='font-medium text-[12px] text-[var(--text-muted)]'
              >
                Version note
              </Label>
              <Textarea
                id='mainline-publication-description'
                value={publishDescription}
                onChange={(event) => setPublishDescription(event.target.value)}
                placeholder='Describe what changed before updating the showcase canvas'
                rows={3}
                disabled={publishWorkflow.isPending}
              />
            </div>
            <div className='grid gap-2'>
              <Label
                htmlFor='mainline-publication-visibility'
                className='font-medium text-[12px] text-[var(--text-muted)]'
              >
                Visibility
              </Label>
              <select
                id='mainline-publication-visibility'
                value={publishVisibility}
                onChange={(event) =>
                  setPublishVisibility(event.target.value as PublicationVisibility)
                }
                disabled={publishWorkflow.isPending}
                className='h-[38px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[13px] text-[var(--text-body)] outline-none'
              >
                <option value='organization'>Organization visible</option>
                <option value='selected_workgroups'>Selected teams</option>
              </select>
            </div>
            {publishVisibility === 'selected_workgroups' && (
              <div className='rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)] p-3'>
                <div className='mb-2 text-[12px] text-[var(--text-muted)]'>
                  Choose which teams can see this showcase update. If none are selected, the current
                  team remains the default target.
                </div>
                {isLoadingOrganizationWorkgroups ? (
                  <div className='flex items-center gap-2 text-[13px] text-[var(--text-muted)]'>
                    <Loader className='h-[14px] w-[14px]' animate />
                    Loading organization teams...
                  </div>
                ) : publishTargetWorkgroups.length === 0 ? (
                  <div className='text-[13px] text-[var(--text-muted)]'>
                    No active teams are available in this organization.
                  </div>
                ) : (
                  <div className='grid max-h-[220px] gap-2 overflow-y-auto md:grid-cols-2'>
                    {publishTargetWorkgroups.map((workgroup) => (
                      <div
                        key={workgroup.id}
                        className='flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[13px] text-[var(--text-body)]'
                      >
                        <span className='truncate'>
                          {workgroup.disciplineName} / {workgroup.name}
                        </span>
                        <Switch
                          checked={publishTargetWorkgroupIds.includes(workgroup.id)}
                          disabled={publishWorkflow.isPending}
                          aria-label={`Toggle ${workgroup.name} mainline visibility`}
                          onCheckedChange={(checked) =>
                            handlePublishTargetToggle(workgroup.id, checked)
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setIsPublishModalOpen(false)}
              disabled={publishWorkflow.isPending}
            >
              Cancel
            </Button>
            <Button
              variant='primary'
              onClick={handlePublish}
              disabled={
                publishWorkflow.isPending ||
                !publishTitle.trim() ||
                (publishVisibility === 'selected_workgroups' && isLoadingOrganizationWorkgroups)
              }
            >
              {publishWorkflow.isPending && <Loader className='mr-2 h-[14px] w-[14px]' animate />}
              {publishActionLabel}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
