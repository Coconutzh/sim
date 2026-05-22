'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ExternalLink, PenLine, Users } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button, Loader } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow'
import {
  useCopySelection,
  useMyWorkgroups,
  usePersonalWorkspace,
  useTeamWorkspace,
} from '@/hooks/queries/collaboration'
import { useWorkflowState, useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

type CanvasPaneKind = 'personal' | 'team'

interface PaneConfig {
  kind: CanvasPaneKind
  label: string
  workspaceId?: string
  workflowId?: string
  workflows: WorkflowMetadata[]
  isWorkflowsLoading: boolean
  selectedBlockId: string | null
  onSelectBlock: (blockId: string) => void
  onSelectWorkflow: (workflowId: string) => void
}

function useDefaultWorkflowSelection(workflows: WorkflowMetadata[], preferredId?: string) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | undefined>(preferredId)

  useEffect(() => {
    if (preferredId && workflows.some((workflow) => workflow.id === preferredId)) {
      setSelectedWorkflowId(preferredId)
      return
    }
    if (!selectedWorkflowId || !workflows.some((workflow) => workflow.id === selectedWorkflowId)) {
      setSelectedWorkflowId(workflows[0]?.id)
    }
  }, [preferredId, selectedWorkflowId, workflows])

  return [selectedWorkflowId, setSelectedWorkflowId] as const
}

function PaneHeader({ pane }: { pane: PaneConfig }) {
  const Icon = pane.kind === 'personal' ? PenLine : Users

  return (
    <div className='flex flex-col gap-3 border-[var(--border)] border-b p-3'>
      <div className='flex items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2'>
          <div className='flex h-[28px] w-[28px] items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface-2)]'>
            <Icon className='h-[15px] w-[15px] text-[var(--text-icon)]' />
          </div>
          <div className='min-w-0'>
            <div className='truncate font-medium text-[var(--text-primary)] text-sm'>
              {pane.label}
            </div>
            <div className='truncate text-[12px] text-[var(--text-muted)]'>
              {pane.selectedBlockId ? `Selected ${pane.selectedBlockId}` : 'Click a node to copy'}
            </div>
          </div>
        </div>
        {pane.workspaceId && pane.workflowId && (
          <Link
            href={`/workspace/${pane.workspaceId}/w/${pane.workflowId}`}
            className='flex h-[28px] items-center gap-1.5 rounded-[6px] border border-[var(--border)] px-2 text-[12px] text-[var(--text-body)] transition-colors hover-hover:bg-[var(--surface-hover)]'
          >
            <ExternalLink className='h-[13px] w-[13px]' />
            Open
          </Link>
        )}
      </div>
      <select
        value={pane.workflowId ?? ''}
        onChange={(event) => pane.onSelectWorkflow(event.target.value)}
        disabled={pane.workflows.length === 0}
        className='h-[30px] rounded-[6px] border border-[var(--border)] bg-[var(--surface-1)] px-2 text-[12px] text-[var(--text-body)] outline-none'
      >
        {pane.workflows.length === 0 ? (
          <option value=''>No node graph yet</option>
        ) : (
          pane.workflows.map((workflow) => (
            <option key={workflow.id} value={workflow.id}>
              {workflow.name}
            </option>
          ))
        )}
      </select>
    </div>
  )
}

function CanvasPane({ pane }: { pane: PaneConfig }) {
  const { data: workflowState, isLoading: isWorkflowStateLoading } = useWorkflowState(
    pane.workflowId
  )
  const isLoading = pane.isWorkflowsLoading || isWorkflowStateLoading

  return (
    <section className='flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
      <PaneHeader pane={pane} />
      <div className='relative min-h-0 flex-1 bg-[var(--bg)]'>
        {isLoading && (
          <div className='absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg)]'>
            <Loader className='h-[18px] w-[18px] text-[var(--text-icon)]' animate />
          </div>
        )}
        {!isLoading && workflowState && pane.workspaceId ? (
          <PreviewWorkflow
            workflowState={workflowState}
            workspaceId={pane.workspaceId}
            selectedBlockId={pane.selectedBlockId}
            onNodeClick={(blockId) => pane.onSelectBlock(blockId)}
            onPaneClick={() => pane.onSelectBlock('')}
            cursorStyle='pointer'
            fitPadding={0.2}
            lightweight
          />
        ) : (
          !isLoading && (
            <div className='flex h-full items-center justify-center px-6 text-center text-[13px] text-[var(--text-muted)] leading-5'>
              {pane.workspaceId
                ? 'Create a node graph in this canvas before using split view copy.'
                : 'This canvas is not available for the active team.'}
            </div>
          )
        )}
      </div>
    </section>
  )
}

export function SplitCanvasWorkbench() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: workgroupsData } = useMyWorkgroups()
  const workgroups = workgroupsData?.workgroups ?? []
  const { data: workspaceSettingsData } = useWorkspaceSettings(workspaceId)
  const currentWorkspaceWorkgroupId = workspaceSettingsData?.settings.workspace.workgroupId
  const activeWorkgroup =
    workgroups.find((workgroup) => workgroup.teamWorkspaceId === workspaceId) ??
    workgroups.find((workgroup) => workgroup.id === currentWorkspaceWorkgroupId) ??
    workgroups.find((workgroup) => workgroup.id === workgroupsData?.defaultWorkgroupId) ??
    workgroups[0]
  const activeWorkgroupId = activeWorkgroup?.id
  const { data: personalWorkspaceData } = usePersonalWorkspace(activeWorkgroupId)
  const { data: teamWorkspaceData } = useTeamWorkspace(activeWorkgroupId)
  const personalWorkspaceId = personalWorkspaceData?.workspace.id
  const teamWorkspaceId = teamWorkspaceData?.workspace.id ?? activeWorkgroup?.teamWorkspaceId
  const { data: personalWorkflows = [], isLoading: isPersonalWorkflowsLoading } =
    useWorkflows(personalWorkspaceId)
  const { data: teamWorkflows = [], isLoading: isTeamWorkflowsLoading } =
    useWorkflows(teamWorkspaceId)
  const [personalWorkflowId, setPersonalWorkflowId] = useDefaultWorkflowSelection(personalWorkflows)
  const [teamWorkflowId, setTeamWorkflowId] = useDefaultWorkflowSelection(teamWorkflows)
  const [selectedPane, setSelectedPane] = useState<CanvasPaneKind>('personal')
  const [selectedPersonalBlockId, setSelectedPersonalBlockId] = useState<string | null>(null)
  const [selectedTeamBlockId, setSelectedTeamBlockId] = useState<string | null>(null)
  const [copiedTargetBlockId, setCopiedTargetBlockId] = useState<string | null>(null)
  const copySelection = useCopySelection()

  const panes = useMemo(() => {
    const personalPane: PaneConfig = {
      kind: 'personal',
      label: 'Personal draft',
      workspaceId: personalWorkspaceId,
      workflowId: personalWorkflowId,
      workflows: personalWorkflows,
      isWorkflowsLoading: isPersonalWorkflowsLoading,
      selectedBlockId: selectedPersonalBlockId,
      onSelectBlock: (blockId) => {
        setSelectedPane('personal')
        setSelectedPersonalBlockId(blockId || null)
      },
      onSelectWorkflow: setPersonalWorkflowId,
    }
    const teamPane: PaneConfig = {
      kind: 'team',
      label: 'Team canvas',
      workspaceId: teamWorkspaceId,
      workflowId: teamWorkflowId,
      workflows: teamWorkflows,
      isWorkflowsLoading: isTeamWorkflowsLoading,
      selectedBlockId: selectedTeamBlockId,
      onSelectBlock: (blockId) => {
        setSelectedPane('team')
        setSelectedTeamBlockId(blockId || null)
      },
      onSelectWorkflow: setTeamWorkflowId,
    }
    return { personal: personalPane, team: teamPane }
  }, [
    isPersonalWorkflowsLoading,
    isTeamWorkflowsLoading,
    personalWorkflowId,
    personalWorkflows,
    personalWorkspaceId,
    selectedPersonalBlockId,
    selectedTeamBlockId,
    setPersonalWorkflowId,
    setTeamWorkflowId,
    teamWorkflowId,
    teamWorkflows,
    teamWorkspaceId,
  ])

  const sourcePane = panes[selectedPane]
  const targetPane = selectedPane === 'personal' ? panes.team : panes.personal
  const canCopy =
    Boolean(sourcePane.workspaceId) &&
    Boolean(sourcePane.workflowId) &&
    Boolean(sourcePane.selectedBlockId) &&
    Boolean(targetPane.workspaceId) &&
    Boolean(targetPane.workflowId)

  const handleCopy = async () => {
    if (!canCopy || !sourcePane.workflowId || !sourcePane.selectedBlockId) return
    if (!targetPane.workspaceId || !targetPane.workflowId) return

    const result = await copySelection.mutateAsync({
      workflowId: sourcePane.workflowId,
      body: {
        source: { type: sourcePane.kind, workflowId: sourcePane.workflowId },
        target: {
          type: targetPane.kind,
          workspaceId: targetPane.workspaceId,
          workflowId: targetPane.workflowId,
        },
        selection: { blockIds: [sourcePane.selectedBlockId], edgeIds: [] },
        placement: { offsetX: 120, offsetY: 80 },
      },
    })

    const firstTargetBlockId = Object.values(result.mappings.blockIds)[0]
    if (firstTargetBlockId) {
      setCopiedTargetBlockId(firstTargetBlockId)
      if (targetPane.kind === 'personal') setSelectedPersonalBlockId(firstTargetBlockId)
      if (targetPane.kind === 'team') setSelectedTeamBlockId(firstTargetBlockId)
    }
  }

  return (
    <div className='flex h-full flex-col overflow-hidden bg-[var(--bg)]'>
      <div className='flex flex-col gap-3 border-[var(--border)] border-b p-4'>
        <div className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
          <div>
            <div className='text-[12px] text-[var(--text-muted)]'>
              {activeWorkgroup
                ? `${activeWorkgroup.discipline.name} / ${activeWorkgroup.name}`
                : 'Split view'}
            </div>
            <h1 className='mt-1 font-medium text-[18px] text-[var(--text-primary)]'>
              Split view canvas workbench
            </h1>
          </div>
          <Button
            variant='primary'
            onClick={() => void handleCopy()}
            disabled={!canCopy || copySelection.isPending}
            className='h-[32px] gap-2'
          >
            {copySelection.isPending ? (
              <Loader className='h-[14px] w-[14px]' animate />
            ) : (
              <ArrowRight className='h-[14px] w-[14px]' />
            )}
            Copy selected to {targetPane.label}
          </Button>
        </div>
        <div
          className={cn(
            'rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[12px] text-[var(--text-muted)]',
            copiedTargetBlockId && 'text-[var(--text-body)]'
          )}
        >
          {copiedTargetBlockId
            ? `Copied into ${targetPane.label}. New block ${copiedTargetBlockId} is selected after refresh.`
            : 'Click a node in either pane, then copy it into the other canvas. Each pane keeps its own workflow and selection.'}
        </div>
      </div>
      <div className='grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 lg:grid-cols-2'>
        <CanvasPane pane={panes.personal} />
        <CanvasPane pane={panes.team} />
      </div>
    </div>
  )
}
