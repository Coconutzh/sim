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
  mapCopiedTargetEdgeIds,
  type PaneViewportSnapshot,
  selectPaneBlock,
  selectPaneEdge,
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
const SPLIT_VIEWPORT_STORAGE_PREFIX = 'sim:split-canvas:viewport'

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
  hasStoredViewport: boolean
  selectedBlockIds: string[]
  selectedEdgeIds: string[]
  copiedBlockIds: string[]
  copiedEdgeIds: string[]
  onSelectBlock: (blockId: string, additive: boolean) => void
  onSelectEdge: (edgeId: string, additive: boolean) => void
  onClearSelection: () => void
  onSelectWorkflow: (workflowId: string) => void
  onViewportChange: (viewport: PaneViewportSnapshot) => void
}

function getPaneViewportStorageKey(kind: CanvasPaneKind, workflowId?: string): string | null {
  return workflowId ? `${SPLIT_VIEWPORT_STORAGE_PREFIX}:${kind}:${workflowId}` : null
}

function isPaneViewportSnapshot(value: unknown): value is PaneViewportSnapshot {
  if (!value || typeof value !== 'object') return false
  const viewport = value as Record<string, unknown>
  return (
    typeof viewport.x === 'number' &&
    Number.isFinite(viewport.x) &&
    typeof viewport.y === 'number' &&
    Number.isFinite(viewport.y) &&
    typeof viewport.zoom === 'number' &&
    Number.isFinite(viewport.zoom) &&
    viewport.zoom > 0 &&
    typeof viewport.width === 'number' &&
    Number.isFinite(viewport.width) &&
    viewport.width > 0 &&
    typeof viewport.height === 'number' &&
    Number.isFinite(viewport.height) &&
    viewport.height > 0
  )
}

function readStoredPaneViewport(
  kind: CanvasPaneKind,
  workflowId?: string
): PaneViewportSnapshot | undefined {
  if (typeof window === 'undefined') return undefined
  const key = getPaneViewportStorageKey(kind, workflowId)
  if (!key) return undefined

  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? 'null')
    return isPaneViewportSnapshot(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function writeStoredPaneViewport(
  kind: CanvasPaneKind,
  workflowId: string | undefined,
  viewport: PaneViewportSnapshot
) {
  if (typeof window === 'undefined') return
  const key = getPaneViewportStorageKey(kind, workflowId)
  if (!key) return

  try {
    window.localStorage.setItem(key, JSON.stringify(viewport))
  } catch {
    return
  }
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
              {describePaneSelection(pane.selectedBlockIds, pane.selectedEdgeIds)}
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
            key={`${pane.kind}:${pane.workflowId ?? 'none'}`}
            workflowState={pane.workflowState}
            workspaceId={pane.workspaceId}
            selectedBlockIds={pane.selectedBlockIds}
            selectedEdgeIds={pane.selectedEdgeIds}
            focusNodeIds={pane.copiedBlockIds}
            defaultPosition={pane.viewport}
            defaultZoom={pane.viewport?.zoom}
            autoFitView={!pane.hasStoredViewport}
            zoomOnScroll
            onNodeClick={(blockId, _mousePosition, modifiers) =>
              pane.onSelectBlock(blockId, modifiers?.additive ?? false)
            }
            onEdgeClick={(edgeId, modifiers) =>
              pane.onSelectEdge(edgeId, modifiers?.additive ?? false)
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
  const [selectedPersonalEdgeIds, setSelectedPersonalEdgeIds] = useState<string[]>([])
  const [selectedTeamBlockIds, setSelectedTeamBlockIds] = useState<string[]>([])
  const [selectedTeamEdgeIds, setSelectedTeamEdgeIds] = useState<string[]>([])
  const [copiedPersonalBlockIds, setCopiedPersonalBlockIds] = useState<string[]>([])
  const [copiedPersonalEdgeIds, setCopiedPersonalEdgeIds] = useState<string[]>([])
  const [copiedTeamBlockIds, setCopiedTeamBlockIds] = useState<string[]>([])
  const [copiedTeamEdgeIds, setCopiedTeamEdgeIds] = useState<string[]>([])
  const [personalViewport, setPersonalViewport] = useState<PaneViewportSnapshot | undefined>()
  const [teamViewport, setTeamViewport] = useState<PaneViewportSnapshot | undefined>()
  const [personalHasStoredViewport, setPersonalHasStoredViewport] = useState(false)
  const [teamHasStoredViewport, setTeamHasStoredViewport] = useState(false)
  const copySelection = useCopySelection()

  useEffect(() => {
    const storedViewport = readStoredPaneViewport('personal', personalWorkflowId)
    setPersonalViewport(storedViewport)
    setPersonalHasStoredViewport(Boolean(storedViewport))
  }, [personalWorkflowId])

  useEffect(() => {
    const storedViewport = readStoredPaneViewport('team', teamWorkflowId)
    setTeamViewport(storedViewport)
    setTeamHasStoredViewport(Boolean(storedViewport))
  }, [teamWorkflowId])

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
      hasStoredViewport: personalHasStoredViewport,
      selectedBlockIds: selectedPersonalBlockIds,
      selectedEdgeIds: selectedPersonalEdgeIds,
      copiedBlockIds: copiedPersonalBlockIds,
      copiedEdgeIds: copiedPersonalEdgeIds,
      onSelectBlock: (blockId, additive) => {
        setSelectedPane('personal')
        setSelectedPersonalBlockIds((currentBlockIds) =>
          selectPaneBlock({ currentBlockIds, blockId, additive })
        )
        if (!additive) setSelectedPersonalEdgeIds([])
        setCopiedPersonalBlockIds([])
        setCopiedPersonalEdgeIds([])
      },
      onSelectEdge: (edgeId, additive) => {
        setSelectedPane('personal')
        setSelectedPersonalEdgeIds((currentEdgeIds) =>
          selectPaneEdge({ currentEdgeIds, edgeId, additive })
        )
        setCopiedPersonalBlockIds([])
        setCopiedPersonalEdgeIds([])
      },
      onClearSelection: () => {
        setSelectedPersonalBlockIds([])
        setSelectedPersonalEdgeIds([])
        setCopiedPersonalBlockIds([])
        setCopiedPersonalEdgeIds([])
      },
      onSelectWorkflow: (workflowId) => {
        setPersonalWorkflowId(workflowId)
        setSelectedPersonalBlockIds([])
        setSelectedPersonalEdgeIds([])
        setCopiedPersonalBlockIds([])
        setCopiedPersonalEdgeIds([])
        const storedViewport = readStoredPaneViewport('personal', workflowId)
        setPersonalViewport(storedViewport)
        setPersonalHasStoredViewport(Boolean(storedViewport))
      },
      onViewportChange: (viewport) => {
        setPersonalViewport(viewport)
        writeStoredPaneViewport('personal', personalWorkflowId, viewport)
      },
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
      hasStoredViewport: teamHasStoredViewport,
      selectedBlockIds: selectedTeamBlockIds,
      selectedEdgeIds: selectedTeamEdgeIds,
      copiedBlockIds: copiedTeamBlockIds,
      copiedEdgeIds: copiedTeamEdgeIds,
      onSelectBlock: (blockId, additive) => {
        setSelectedPane('team')
        setSelectedTeamBlockIds((currentBlockIds) =>
          selectPaneBlock({ currentBlockIds, blockId, additive })
        )
        if (!additive) setSelectedTeamEdgeIds([])
        setCopiedTeamBlockIds([])
        setCopiedTeamEdgeIds([])
      },
      onSelectEdge: (edgeId, additive) => {
        setSelectedPane('team')
        setSelectedTeamEdgeIds((currentEdgeIds) =>
          selectPaneEdge({ currentEdgeIds, edgeId, additive })
        )
        setCopiedTeamBlockIds([])
        setCopiedTeamEdgeIds([])
      },
      onClearSelection: () => {
        setSelectedTeamBlockIds([])
        setSelectedTeamEdgeIds([])
        setCopiedTeamBlockIds([])
        setCopiedTeamEdgeIds([])
      },
      onSelectWorkflow: (workflowId) => {
        setTeamWorkflowId(workflowId)
        setSelectedTeamBlockIds([])
        setSelectedTeamEdgeIds([])
        setCopiedTeamBlockIds([])
        setCopiedTeamEdgeIds([])
        const storedViewport = readStoredPaneViewport('team', workflowId)
        setTeamViewport(storedViewport)
        setTeamHasStoredViewport(Boolean(storedViewport))
      },
      onViewportChange: (viewport) => {
        setTeamViewport(viewport)
        writeStoredPaneViewport('team', teamWorkflowId, viewport)
      },
    }
    return { personal: personalPane, team: teamPane }
  }, [
    copiedPersonalBlockIds,
    copiedPersonalEdgeIds,
    copiedTeamBlockIds,
    copiedTeamEdgeIds,
    isPersonalWorkflowsLoading,
    isPersonalWorkflowStateLoading,
    isTeamWorkflowsLoading,
    isTeamWorkflowStateLoading,
    personalWorkflowId,
    personalWorkflowState,
    personalWorkflows,
    personalWorkspaceId,
    personalViewport,
    personalHasStoredViewport,
    selectedPersonalBlockIds,
    selectedPersonalEdgeIds,
    selectedTeamBlockIds,
    selectedTeamEdgeIds,
    setPersonalWorkflowId,
    setTeamWorkflowId,
    teamWorkflowId,
    teamWorkflowState,
    teamWorkflows,
    teamWorkspaceId,
    teamViewport,
    teamHasStoredViewport,
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
        selection: {
          blockIds: sourcePane.selectedBlockIds,
          edgeIds: sourcePane.selectedEdgeIds,
        },
        placement,
      },
    })

    const targetBlockIds = mapCopiedTargetBlockIds(
      sourcePane.selectedBlockIds,
      result.mappings.blockIds
    )
    const targetEdgeIds = mapCopiedTargetEdgeIds(
      sourcePane.selectedEdgeIds,
      result.mappings.edgeIds
    )
    if (targetBlockIds.length > 0) {
      if (targetPane.kind === 'personal') {
        setSelectedPersonalBlockIds(targetBlockIds)
        setSelectedPersonalEdgeIds(targetEdgeIds)
        setCopiedPersonalBlockIds(targetBlockIds)
        setCopiedPersonalEdgeIds(targetEdgeIds)
      }
      if (targetPane.kind === 'team') {
        setSelectedTeamBlockIds(targetBlockIds)
        setSelectedTeamEdgeIds(targetEdgeIds)
        setCopiedTeamBlockIds(targetBlockIds)
        setCopiedTeamEdgeIds(targetEdgeIds)
      }
    }
  }

  const copiedTargetBlockIds = targetPane.copiedBlockIds
  const copiedTargetEdgeIds = targetPane.copiedEdgeIds

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
            ? `Copied ${copiedTargetBlockIds.length} block${copiedTargetBlockIds.length === 1 ? '' : 's'}${copiedTargetEdgeIds.length > 0 ? ` and ${copiedTargetEdgeIds.length} edge${copiedTargetEdgeIds.length === 1 ? '' : 's'}` : ''} into ${targetPane.label}. New target selection is highlighted and focused after refresh.`
            : 'Click nodes in either pane, Shift/Ctrl/Cmd-click to multi-select, and click edges to limit which connections copy. Selected edges copy only when both endpoint nodes are selected.'}
        </div>
      </div>
      <div className='grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 lg:grid-cols-2'>
        <CanvasPane pane={panes.personal} />
        <CanvasPane pane={panes.team} />
      </div>
    </div>
  )
}
