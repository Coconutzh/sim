'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ExternalLink, PenLine, Users } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button, Loader } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  computeViewportCenteredPlacement,
  describePaneSelection,
  mapCopiedTargetBlockIds,
  type PaneViewportSnapshot,
  selectPaneBlock,
} from '@/app/workspace/[workspaceId]/split/split-selection'
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
import type { WorkflowState } from '@/stores/workflows/workflow/types'

type CanvasPaneKind = 'personal' | 'team'
const FALLBACK_COPY_PLACEMENT = { offsetX: 120, offsetY: 80 } as const

interface PaneConfig {
  kind: CanvasPaneKind
  label: string
  workspaceId?: string
  workflowId?: string
  workflowState?: WorkflowState
  workflows: WorkflowMetadata[]
  isWorkflowsLoading: boolean
  isWorkflowStateLoading: boolean
  viewport?: PaneViewportSnapshot
  selectedBlockIds: string[]
  copiedBlockIds: string[]
  onSelectBlock: (blockId: string, additive: boolean) => void
  onClearSelection: () => void
  onSelectWorkflow: (workflowId: string) => void
  onViewportChange: (viewport: PaneViewportSnapshot) => void
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
              {describePaneSelection(pane.selectedBlockIds)}
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
  const isLoading = pane.isWorkflowsLoading || pane.isWorkflowStateLoading

  return (
    <section className='flex min-h-[360px] min-w-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)]'>
      <PaneHeader pane={pane} />
      <div className='relative min-h-0 flex-1 bg-[var(--bg)]'>
        {isLoading && (
          <div className='absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg)]'>
            <Loader className='h-[18px] w-[18px] text-[var(--text-icon)]' animate />
          </div>
        )}
        {!isLoading && pane.workflowState && pane.workspaceId ? (
          <PreviewWorkflow
            workflowState={pane.workflowState}
            workspaceId={pane.workspaceId}
            selectedBlockIds={pane.selectedBlockIds}
            onNodeClick={(blockId, _mousePosition, modifiers) =>
              pane.onSelectBlock(blockId, modifiers?.additive ?? false)
            }
            onPaneClick={pane.onClearSelection}
            cursorStyle='pointer'
            fitPadding={0.2}
            onViewportChange={pane.onViewportChange}
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
  const { data: personalWorkflowState, isLoading: isPersonalWorkflowStateLoading } =
    useWorkflowState(personalWorkflowId)
  const { data: teamWorkflowState, isLoading: isTeamWorkflowStateLoading } =
    useWorkflowState(teamWorkflowId)
  const [selectedPane, setSelectedPane] = useState<CanvasPaneKind>('personal')
  const [selectedPersonalBlockIds, setSelectedPersonalBlockIds] = useState<string[]>([])
  const [selectedTeamBlockIds, setSelectedTeamBlockIds] = useState<string[]>([])
  const [copiedPersonalBlockIds, setCopiedPersonalBlockIds] = useState<string[]>([])
  const [copiedTeamBlockIds, setCopiedTeamBlockIds] = useState<string[]>([])
  const [personalViewport, setPersonalViewport] = useState<PaneViewportSnapshot | undefined>()
  const [teamViewport, setTeamViewport] = useState<PaneViewportSnapshot | undefined>()
  const copySelection = useCopySelection()

  const panes = useMemo(() => {
    const personalPane: PaneConfig = {
      kind: 'personal',
      label: 'Personal draft',
      workspaceId: personalWorkspaceId,
      workflowId: personalWorkflowId,
      workflowState: personalWorkflowState ?? undefined,
      workflows: personalWorkflows,
      isWorkflowsLoading: isPersonalWorkflowsLoading,
      isWorkflowStateLoading: isPersonalWorkflowStateLoading,
      viewport: personalViewport,
      selectedBlockIds: selectedPersonalBlockIds,
      copiedBlockIds: copiedPersonalBlockIds,
      onSelectBlock: (blockId, additive) => {
        setSelectedPane('personal')
        setSelectedPersonalBlockIds((currentBlockIds) =>
          selectPaneBlock({ currentBlockIds, blockId, additive })
        )
        setCopiedPersonalBlockIds([])
      },
      onClearSelection: () => {
        setSelectedPersonalBlockIds([])
        setCopiedPersonalBlockIds([])
      },
      onSelectWorkflow: (workflowId) => {
        setPersonalWorkflowId(workflowId)
        setSelectedPersonalBlockIds([])
        setCopiedPersonalBlockIds([])
        setPersonalViewport(undefined)
      },
      onViewportChange: setPersonalViewport,
    }
    const teamPane: PaneConfig = {
      kind: 'team',
      label: 'Team canvas',
      workspaceId: teamWorkspaceId,
      workflowId: teamWorkflowId,
      workflowState: teamWorkflowState ?? undefined,
      workflows: teamWorkflows,
      isWorkflowsLoading: isTeamWorkflowsLoading,
      isWorkflowStateLoading: isTeamWorkflowStateLoading,
      viewport: teamViewport,
      selectedBlockIds: selectedTeamBlockIds,
      copiedBlockIds: copiedTeamBlockIds,
      onSelectBlock: (blockId, additive) => {
        setSelectedPane('team')
        setSelectedTeamBlockIds((currentBlockIds) =>
          selectPaneBlock({ currentBlockIds, blockId, additive })
        )
        setCopiedTeamBlockIds([])
      },
      onClearSelection: () => {
        setSelectedTeamBlockIds([])
        setCopiedTeamBlockIds([])
      },
      onSelectWorkflow: (workflowId) => {
        setTeamWorkflowId(workflowId)
        setSelectedTeamBlockIds([])
        setCopiedTeamBlockIds([])
        setTeamViewport(undefined)
      },
      onViewportChange: setTeamViewport,
    }
    return { personal: personalPane, team: teamPane }
  }, [
    copiedPersonalBlockIds,
    copiedTeamBlockIds,
    isPersonalWorkflowsLoading,
    isPersonalWorkflowStateLoading,
    isTeamWorkflowsLoading,
    isTeamWorkflowStateLoading,
    personalWorkflowId,
    personalWorkflowState,
    personalWorkflows,
    personalWorkspaceId,
    personalViewport,
    selectedPersonalBlockIds,
    selectedTeamBlockIds,
    setPersonalWorkflowId,
    setTeamWorkflowId,
    teamWorkflowId,
    teamWorkflowState,
    teamWorkflows,
    teamWorkspaceId,
    teamViewport,
  ])

  const sourcePane = panes[selectedPane]
  const targetPane = selectedPane === 'personal' ? panes.team : panes.personal
  const canCopy =
    Boolean(sourcePane.workspaceId) &&
    Boolean(sourcePane.workflowId) &&
    sourcePane.selectedBlockIds.length > 0 &&
    Boolean(targetPane.workspaceId) &&
    Boolean(targetPane.workflowId)

  const handleCopy = async () => {
    if (!canCopy || !sourcePane.workflowId || sourcePane.selectedBlockIds.length === 0) return
    if (!targetPane.workspaceId || !targetPane.workflowId) return

    const placement = computeViewportCenteredPlacement({
      sourceBlockIds: sourcePane.selectedBlockIds,
      sourceWorkflowState: sourcePane.workflowState,
      targetViewport: targetPane.viewport,
      fallback: FALLBACK_COPY_PLACEMENT,
    })

    const result = await copySelection.mutateAsync({
      workflowId: sourcePane.workflowId,
      body: {
        source: { type: sourcePane.kind, workflowId: sourcePane.workflowId },
        target: {
          type: targetPane.kind,
          workspaceId: targetPane.workspaceId,
          workflowId: targetPane.workflowId,
        },
        selection: { blockIds: sourcePane.selectedBlockIds, edgeIds: [] },
        placement,
      },
    })

    const targetBlockIds = mapCopiedTargetBlockIds(
      sourcePane.selectedBlockIds,
      result.mappings.blockIds
    )
    if (targetBlockIds.length > 0) {
      if (targetPane.kind === 'personal') {
        setSelectedPersonalBlockIds(targetBlockIds)
        setCopiedPersonalBlockIds(targetBlockIds)
      }
      if (targetPane.kind === 'team') {
        setSelectedTeamBlockIds(targetBlockIds)
        setCopiedTeamBlockIds(targetBlockIds)
      }
    }
  }

  const copiedTargetBlockIds = targetPane.copiedBlockIds

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
            copiedTargetBlockIds.length > 0 && 'text-[var(--text-body)]'
          )}
        >
          {copiedTargetBlockIds.length > 0
            ? `Copied ${copiedTargetBlockIds.length} block${copiedTargetBlockIds.length === 1 ? '' : 's'} into ${targetPane.label}. New target selection is highlighted after refresh.`
            : 'Click nodes in either pane, Shift/Ctrl/Cmd-click to multi-select, then copy into the other canvas. Each pane keeps its own workflow and selection.'}
        </div>
      </div>
      <div className='grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 lg:grid-cols-2'>
        <CanvasPane pane={panes.personal} />
        <CanvasPane pane={panes.team} />
      </div>
    </div>
  )
}
