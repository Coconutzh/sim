'use client'

import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Scissors } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import ReactFlow, {
  applyNodeChanges,
  ConnectionLineType,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import { getWorkflowStateContract } from '@/lib/api/contracts/workflows'
import { useSession } from '@/lib/auth/auth-client'
import type { OAuthConnectEventDetail } from '@/lib/copilot/tools/client/base-tool'
import { consumeOAuthReturnContext, writeOAuthReturnContext } from '@/lib/credentials/client-state'
import {
  getNearestSupportedImageAspectRatio,
  type ImageAspectRatioValue,
} from '@/lib/generated-media/image/image-generation-utils'
import {
  removeVideoMediaFileForType,
  upsertVideoMediaFile,
} from '@/lib/generated-media/video/video-generation-utils'
import type { OAuthProvider } from '@/lib/oauth'
import { type ContentNodePresetId, getContentNodePreset } from '@/lib/product/content-node-presets'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import {
  getCanvasNodeDragHandle,
  getCanvasNodeType,
  isPureCanvasBlockType,
} from '@/lib/workflows/blocks/pure-canvas-blocks'
import {
  CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX,
  type ContentReferenceAutoLinkType,
  createContentReferenceEdge,
  findAutoVideoContentReferenceEdge,
  getContentReferenceAnchorForTarget,
  getContentReferenceAutoLinkType,
  getContentReferenceSourceHandleId,
  getContentReferenceTargetHandleId,
  isContentBlockState,
  isContentReferenceEdge,
} from '@/lib/workflows/content-reference-edges'
import {
  type ContentNodeVariant,
  type ContentReferenceRecord,
  getDefaultReferenceRole,
  getModelDisabledReason,
  normalizeContentReferences,
  upsertContentReference,
} from '@/lib/workflows/content-references'
import { TriggerUtils } from '@/lib/workflows/triggers/triggers'
import { OAuthModal } from '@/app/workspace/[workspaceId]/components/oauth-modal'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-context'
import { BlockMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/block-menu'
import { CanvasMenu } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/canvas-menu'
import { Cursors } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/cursors/cursors'
import { ErrorBoundary } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/error/index'
import { Notifications } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/notifications/notifications'
import { ProductionTaskTimeline } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/production-tasks/production-task-timeline'
import type { SubflowNodeData } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/subflow-node'
import {
  useAutoLayout,
  useCanvasContextMenu,
  useCurrentWorkflow,
  useDynamicHandleRefresh,
  useNodeUtilities,
  useShiftSelectionLock,
  useWorkflowExecution,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks'
import { createNodeGeometrySnapshot } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-node-utilities'
import {
  calculateContainerDimensions,
  clampPositionToContainer,
  clearDragHighlights,
  computeClampedPositionUpdates,
  estimateBlockDimensions,
  filterProtectedBlocks,
  getClampedPositionForNode,
  getDescendantBlockIds,
  getDragHighlightTransition,
  getEdgeSelectionContextId,
  getNodeSelectionContextId,
  getWorkflowLockToggleIds,
  isBlockProtected,
  isEdgeProtected,
  isInEditableElement,
  pickBestContainerMatch,
  reconcileDisplayNodePositions,
  resolveSelectionConflicts,
  validateTriggerPaste,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import {
  defaultEdgeOptions,
  embeddedFitViewOptions,
  embeddedResizeFitViewOptions,
  reactFlowFitViewOptions,
  reactFlowProOptions,
  reactFlowStyles,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-constants'
import {
  liteEdgeTypes,
  liteNodeTypes,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/workflow-node-types-lite'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import { getWorkflowEditorRedirectPath } from '@/app/workspace/redirect-workflow'
import {
  getAnyBlockCatalogEntry,
  getBlockConfigFromCatalog,
  resolveCatalogBlockType,
} from '@/blocks/catalog'
import type { BlockConfig } from '@/blocks/types'
import { isAnnotationOnlyBlock } from '@/executor/constants'
import {
  useCopySelection,
  useMyWorkgroups,
  usePersonalWorkspace,
  useTeamWorkspace,
} from '@/hooks/queries/collaboration'
import { useWorkspaceEnvironment } from '@/hooks/queries/environment'
import { useFolderMap } from '@/hooks/queries/folders'
import { useAutoConnect, useSnapToGridSize } from '@/hooks/queries/general-settings'
import {
  findLockedAncestorFolder,
  isFolderOrAncestorLocked,
} from '@/hooks/queries/utils/folder-tree'
import { useUpdateWorkflow, useWorkflowMap, useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useOAuthReturnForWorkflow } from '@/hooks/use-oauth-return'
import { useCanvasModeStore } from '@/stores/canvas-mode'
import { useChatStore } from '@/stores/chat/store'
import { useContentReferenceSelectionStore } from '@/stores/content/content-reference-selection/store'
import { useVideoFrameSelectionStore } from '@/stores/content/video-frame-selection/store'
import { useContentCanvasSelectionStore } from '@/stores/copilot/content-canvas-selection/store'
import { defaultWorkflowExecutionState, useExecutionStore } from '@/stores/execution'
import { useNotificationStore } from '@/stores/notifications'
import { usePanelEditorStore } from '@/stores/panel'
import { usePanelStore } from '@/stores/panel/store'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useVariablesModalStore } from '@/stores/variables/modal'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useWorkflowSearchReplaceStore } from '@/stores/workflow-search-replace/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { getUniqueBlockName, prepareBlockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** Lazy-loaded components for non-critical UI that can load after initial render */
const LazyChat = lazy(() =>
  import('@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/chat').then((mod) => ({
    default: mod.Chat,
  }))
)

const LazyWorkflowSearchReplace = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/search-replace/workflow-search-replace'
  ).then((mod) => ({
    default: mod.WorkflowSearchReplace,
  }))
)

const LazyCommandList = lazy(() =>
  import('@/app/workspace/[workspaceId]/w/[workflowId]/components/command-list/command-list').then(
    (mod) => ({
      default: mod.CommandList,
    })
  )
)

type ContentVariant = 'text' | 'image' | 'video' | 'audio'

interface UploadedFileSnapshot {
  id?: string
  name?: string
  path?: string
  key?: string
  size?: number
  type?: string
  context?: string
}

const CLEAR_VIDEO_FRAME_AUTO_LINK_EVENT = 'clear-video-frame-auto-link'

function hasUploadedFileSnapshot(value: unknown): value is UploadedFileSnapshot {
  return Boolean(
    value &&
      typeof value === 'object' &&
      ('path' in value || 'key' in value || 'name' in value) &&
      (typeof (value as UploadedFileSnapshot).path === 'string' ||
        typeof (value as UploadedFileSnapshot).key === 'string' ||
        typeof (value as UploadedFileSnapshot).name === 'string')
  )
}

function inferContentVariantFromSnapshot(value: unknown): ContentVariant | null {
  if (!hasUploadedFileSnapshot(value)) return null

  const file = value as UploadedFileSnapshot
  const fileType = file.type?.toLowerCase()
  if (fileType?.startsWith('image/')) return 'image'
  if (fileType?.startsWith('video/')) return 'video'
  if (fileType?.startsWith('audio/')) return 'audio'

  const fileName = `${file.name ?? ''} ${file.path ?? ''}`.toLowerCase()
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|$)/.test(fileName)) return 'image'
  if (/\.(mp4|webm|mov|m4v|ogv|avi|mkv)(\?|$)/.test(fileName)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|aac|flac|webm)(\?|$)/.test(fileName)) return 'audio'

  return null
}

function normalizeContentVariant(value: unknown): ContentVariant | null {
  return value === 'text' || value === 'image' || value === 'video' || value === 'audio'
    ? value
    : null
}

function getStoredSubBlockValue(
  source: Record<string, unknown> | undefined,
  key: string
): unknown | undefined {
  const rawValue = source?.[key]
  if (rawValue && typeof rawValue === 'object' && 'value' in rawValue) {
    return (rawValue as { value?: unknown }).value
  }
  return rawValue
}

function inferImageAspectRatioFromUrl(
  path: string
): Promise<Exclude<ImageAspectRatioValue, 'auto'> | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)

  return new Promise((resolve) => {
    const image = new window.Image()
    image.onload = () =>
      resolve(getNearestSupportedImageAspectRatio(image.naturalWidth, image.naturalHeight))
    image.onerror = () => resolve(null)
    image.src = path
  })
}

function normalizeVideoMediaSnapshots(value: unknown): Array<{
  type: 'first_frame' | 'last_frame'
  file: UploadedFileSnapshot
}> {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const type = (item as { type?: unknown }).type
    const file = (item as { file?: unknown }).file
    if ((type !== 'first_frame' && type !== 'last_frame') || !hasUploadedFileSnapshot(file)) {
      return []
    }
    return [{ type, file }]
  })
}

const LazyDiffControls = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/diff-controls/diff-controls'
  ).then((mod) => ({
    default: mod.DiffControls,
  }))
)

interface LazyPanelProps {
  workspaceId?: string
}

const LazyPanel = lazy(async () => {
  if (process.env.NEXT_PUBLIC_SIM_LOW_MEMORY_DEV === 'true') {
    const mod = await import(
      '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/panel-lite'
    )
    return { default: mod.PanelLite as React.ComponentType<LazyPanelProps> }
  }

  const mod = await import('@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/panel')
  return { default: mod.Panel as React.ComponentType<LazyPanelProps> }
})

const LazyTerminal = lazy(() =>
  import('@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/terminal').then(
    (mod) => ({
      default: mod.Terminal,
    })
  )
)

const LazyWorkflowTrackBar = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-track-bar/workflow-track-bar'
  ).then((mod) => ({
    default: mod.WorkflowTrackBar,
  }))
)

const LazyWorkflowControls = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-controls/workflow-controls'
  ).then((mod) => ({
    default: mod.WorkflowControls,
  }))
)

const logger = createLogger('Workflow')

const DEFAULT_PASTE_OFFSET = { x: 50, y: 50 }
const IS_LOW_MEMORY_DEV = process.env.NEXT_PUBLIC_SIM_LOW_MEMORY_DEV === 'true'

/**
 * Calculates the offset to paste blocks at viewport center
 */
function calculatePasteOffset(
  clipboard: {
    blocks: Record<string, { position: { x: number; y: number }; type: string; height?: number }>
  } | null,
  viewportCenter: { x: number; y: number }
): { x: number; y: number } {
  if (!clipboard) return DEFAULT_PASTE_OFFSET

  const clipboardBlocks = Object.values(clipboard.blocks)
  if (clipboardBlocks.length === 0) return DEFAULT_PASTE_OFFSET

  const minX = Math.min(...clipboardBlocks.map((b) => b.position.x))
  const maxX = Math.max(
    ...clipboardBlocks.map((b) => {
      const width =
        b.type === 'loop' || b.type === 'parallel'
          ? CONTAINER_DIMENSIONS.DEFAULT_WIDTH
          : BLOCK_DIMENSIONS.FIXED_WIDTH
      return b.position.x + width
    })
  )
  const minY = Math.min(...clipboardBlocks.map((b) => b.position.y))
  const maxY = Math.max(
    ...clipboardBlocks.map((b) => {
      const height =
        b.type === 'loop' || b.type === 'parallel'
          ? CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
          : Math.max(b.height || BLOCK_DIMENSIONS.MIN_HEIGHT, BLOCK_DIMENSIONS.MIN_HEIGHT)
      return b.position.y + height
    })
  )
  const clipboardCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }

  return {
    x: viewportCenter.x - clipboardCenter.x,
    y: viewportCenter.y - clipboardCenter.y,
  }
}

function mapEdgesByNode(edges: Edge[], nodeIds: Set<string>): Map<string, Edge[]> {
  const result = new Map<string, Edge[]>()
  edges.forEach((edge) => {
    if (nodeIds.has(edge.source)) {
      const list = result.get(edge.source) ?? []
      list.push(edge)
      result.set(edge.source, list)
      return
    }
    if (nodeIds.has(edge.target)) {
      const list = result.get(edge.target) ?? []
      list.push(edge)
      result.set(edge.target, list)
    }
  })
  return result
}

/**
 * Syncs the panel editor with the current selection state.
 * Shows the last selected block in the panel. Clears when nothing is selected.
 */
function syncPanelWithSelection(selectedIds: string[]) {
  const { currentBlockId, clearCurrentBlock, setCurrentBlockId } = usePanelEditorStore.getState()
  if (selectedIds.length === 0) {
    if (currentBlockId) clearCurrentBlock()
  } else {
    const lastSelectedId = selectedIds[selectedIds.length - 1]
    if (lastSelectedId !== currentBlockId) {
      setCurrentBlockId(lastSelectedId)
    }
  }
}

/**
 * Map from edge contextId to edge id.
 * Context IDs include parent loop info for edges inside loops.
 * The actual edge ID is stored as the value for deletion operations.
 */
type SelectedEdgesMap = Map<string, string>

interface BlockData {
  id: string
  type: string
  position: { x: number; y: number }
}

interface ContentReferenceEdgeMenuState {
  edgeId: string
  x: number
  y: number
}

interface ConnectionStartParams {
  nodeId?: string | null
  handleId?: string | null
}

interface CanvasConnection {
  source?: string | null
  target?: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

function isContentNodeVariantValue(value: unknown): value is ContentNodeVariant {
  return value === 'text' || value === 'image' || value === 'video' || value === 'audio'
}

function isContentReferenceSourceHandle(handleId: string | null | undefined): boolean {
  return typeof handleId === 'string' && handleId.startsWith(CONTENT_REFERENCE_SOURCE_HANDLE_PREFIX)
}

function getContentReferenceSourceAnchorFromHandle(
  handleId: string | null | undefined
): 'left' | 'right' {
  return typeof handleId === 'string' && handleId.endsWith('-left') ? 'left' : 'right'
}

function getLiveContentSubblockValue(params: {
  block: BlockState | undefined
  values: Record<string, unknown> | undefined
  key: string
}): unknown {
  if (params.values && params.key in params.values) {
    return params.values[params.key]
  }
  return getStoredSubBlockValue(
    params.block?.subBlocks as Record<string, unknown> | undefined,
    params.key
  )
}

function resolveContentBlockVariant(params: {
  block: BlockState | undefined
  values: Record<string, unknown> | undefined
}): ContentNodeVariant | null {
  if (!isContentBlockState(params.block)) return null
  const value = getLiveContentSubblockValue({
    block: params.block,
    values: params.values,
    key: 'contentVariant',
  })
  return isContentNodeVariantValue(value) ? value : 'text'
}

function resolveContentBlockReferenceModel(params: {
  block: BlockState | undefined
  values: Record<string, unknown> | undefined
  variant: ContentNodeVariant
}): string {
  if (params.variant === 'image') {
    const model = getLiveContentSubblockValue({ ...params, key: 'aiModel' })
    return typeof model === 'string' && model.trim().length > 0 ? model : 'jimeng-4.5'
  }

  if (params.variant === 'audio') {
    const model = getLiveContentSubblockValue({ ...params, key: 'audioModel' })
    return typeof model === 'string' && model.trim().length > 0 ? model : 'suno-v5-beta'
  }

  if (params.variant === 'video') {
    const modelFamily = getLiveContentSubblockValue({ ...params, key: 'videoModelFamily' })
    return modelFamily === 'wan2.7' ? 'wan2.7-i2v' : 'wan2.6-i2v-flash'
  }

  const model = getLiveContentSubblockValue({ ...params, key: 'aiModel' })
  return typeof model === 'string' && model.trim().length > 0
    ? model
    : 'gemini-3.1-flash-lite-preview'
}

/**
 * Main workflow canvas content component.
 * Renders the ReactFlow canvas with blocks, edges, and all interactive features.
 */
interface WorkflowContentProps {
  workspaceId?: string
  workflowId?: string
  embedded?: boolean
  /** Sandbox mode: full editing enabled but no workspace API calls (used by Sim Academy). */
  sandbox?: boolean
}

const WorkflowContent = React.memo(
  ({
    workspaceId: propWorkspaceId,
    workflowId: propWorkflowId,
    embedded,
    sandbox,
  }: WorkflowContentProps = {}) => {
    const [isCanvasReady, setIsCanvasReady] = useState(false)
    const [potentialParentId, setPotentialParentId] = useState<string | null>(null)
    const [selectedEdges, setSelectedEdges] = useState<SelectedEdgesMap>(new Map())
    const [contentReferenceEdgeMenu, setContentReferenceEdgeMenu] =
      useState<ContentReferenceEdgeMenuState | null>(null)
    const [isErrorConnectionDrag, setIsErrorConnectionDrag] = useState(false)
    const [isHeavyEditorChromeLoaded, setIsHeavyEditorChromeLoaded] = useState(!IS_LOW_MEMORY_DEV)
    const [nodeTypesForRender, setNodeTypesForRender] = useState<NodeTypes>(liteNodeTypes)
    const [edgeTypesForRender, setEdgeTypesForRender] = useState<EdgeTypes>(liteEdgeTypes)
    const canvasContainerRef = useRef<HTMLDivElement>(null)
    const embeddedFitFrameRef = useRef<number | null>(null)
    const hasCompletedInitialEmbeddedFitRef = useRef(false)
    const canvasMode = useCanvasModeStore((state) => state.mode)
    const isHandMode = embedded ? true : canvasMode === 'hand'
    const { handleCanvasMouseDown, selectionProps } = useShiftSelectionLock({ isHandMode })
    const [oauthModal, setOauthModal] = useState<{
      provider: OAuthProvider
      serviceId: string
      providerName: string
      requiredScopes: string[]
      newScopes?: string[]
    } | null>(null)

    const params = useParams()
    const router = useRouter()
    const reactFlowInstance = useReactFlow()
    const { screenToFlowPosition, getNodes, setNodes } = reactFlowInstance
    const { fitViewToBounds, getViewportCenter } = useCanvasViewport(reactFlowInstance, {
      embedded,
    })
    const { emitCursorUpdate, joinWorkflow, leaveWorkflow } = useSocket()
    const activePanelTab = usePanelStore((state) => state.activeTab)
    const shouldUseFullNodeTypes = !IS_LOW_MEMORY_DEV || embedded || sandbox
    const contentReferenceSelection = useContentReferenceSelectionStore((state) => state.selection)
    const clearContentReferenceSelection = useContentReferenceSelectionStore(
      (state) => state.clearSelection
    )

    useEffect(() => {
      if (!shouldUseFullNodeTypes) return

      let isCancelled = false

      import('@/app/workspace/[workspaceId]/w/[workflowId]/workflow-node-types-full')
        .then(({ fullEdgeTypes, fullNodeTypes }) => {
          if (isCancelled) return
          setNodeTypesForRender(fullNodeTypes)
          setEdgeTypesForRender(fullEdgeTypes)
        })
        .catch((err: unknown) => {
          logger.error('Failed to load full workflow node types', { err })
        })

      return () => {
        isCancelled = true
      }
    }, [shouldUseFullNodeTypes])
    useDynamicHandleRefresh()

    const workspaceId = propWorkspaceId || (params.workspaceId as string)
    const workflowIdParam = propWorkflowId || (params.workflowId as string)

    const addNotification = useNotificationStore((state) => state.addNotification)
    const notifyTrackAction = useCallback(
      (message: string, level: 'info' | 'error' = 'info') => {
        addNotification({
          level,
          message,
          workflowId: workflowIdParam || undefined,
        })
      },
      [addNotification, workflowIdParam]
    )

    useEffect(() => {
      if (!embedded || !workflowIdParam) return
      joinWorkflow(workflowIdParam)
      return () => {
        leaveWorkflow()
      }
    }, [embedded, workflowIdParam, joinWorkflow, leaveWorkflow])

    useOAuthReturnForWorkflow(workflowIdParam)

    const shouldSkipWorkflowMap = IS_LOW_MEMORY_DEV && !sandbox
    const workflowMapQuery = useWorkflowMap(shouldSkipWorkflowMap ? undefined : workspaceId)
    const workflows = workflowMapQuery.data ?? {}
    const isWorkflowMapLoading = shouldSkipWorkflowMap ? false : workflowMapQuery.isLoading
    const isWorkflowMapPlaceholderData = shouldSkipWorkflowMap
      ? false
      : workflowMapQuery.isPlaceholderData
    const lowMemoryWorkspaceId = IS_LOW_MEMORY_DEV && !sandbox ? '' : workspaceId
    const { data: folders = {} } = useFolderMap(lowMemoryWorkspaceId)
    const updateWorkflowMutation = useUpdateWorkflow()
    const { mutateAsync: copySelection, isPending: isCopyingSelection } = useCopySelection()
    const { data: myWorkgroupsData } = useMyWorkgroups(!embedded && !IS_LOW_MEMORY_DEV)
    const { data: workspaceSettingsData } = useWorkspaceSettings(lowMemoryWorkspaceId)
    const currentWorkspaceWorkgroupId = workspaceSettingsData?.settings.workspace.workgroupId
    const activeWorkgroupId =
      myWorkgroupsData?.workgroups.find((workgroup) => workgroup.teamWorkspaceId === workspaceId)
        ?.id ??
      myWorkgroupsData?.workgroups.find((workgroup) => workgroup.id === currentWorkspaceWorkgroupId)
        ?.id ??
      myWorkgroupsData?.defaultWorkgroupId ??
      myWorkgroupsData?.workgroups[0]?.id
    const { data: teamWorkspaceData } = useTeamWorkspace(
      IS_LOW_MEMORY_DEV ? undefined : activeWorkgroupId
    )
    const { data: personalWorkspaceData } = usePersonalWorkspace(
      IS_LOW_MEMORY_DEV ? undefined : activeWorkgroupId
    )
    const copyTargetDescriptor = useMemo(() => {
      if (!activeWorkgroupId) return null
      const teamWorkspace = teamWorkspaceData?.workspace
      const personalWorkspace = personalWorkspaceData?.workspace

      if (teamWorkspace?.id && teamWorkspace.id !== workspaceId) {
        return {
          sourceType: 'personal' as const,
          targetType: 'team' as const,
          targetWorkspaceId: teamWorkspace.id,
          label: 'Copy to team canvas',
        }
      }

      if (personalWorkspace?.id && personalWorkspace.id !== workspaceId) {
        return {
          sourceType: 'team' as const,
          targetType: 'personal' as const,
          targetWorkspaceId: personalWorkspace.id,
          label: 'Copy to personal draft',
        }
      }

      return null
    }, [
      activeWorkgroupId,
      personalWorkspaceData?.workspace,
      teamWorkspaceData?.workspace,
      workspaceId,
    ])
    const { data: copyTargetWorkflows = [] } = useWorkflows(copyTargetDescriptor?.targetWorkspaceId)
    const copyTargetWorkflow = copyTargetWorkflows[0]

    const {
      activeWorkflowId,
      hydration,
      setActiveWorkflow,
      copyBlocks,
      preparePasteData,
      hasClipboard,
      clipboard,
      pendingSelection,
      setPendingSelection,
      clearPendingSelection,
    } = useWorkflowRegistry(
      useShallow((state) => ({
        activeWorkflowId: state.activeWorkflowId,
        hydration: state.hydration,
        setActiveWorkflow: state.setActiveWorkflow,
        copyBlocks: state.copyBlocks,
        preparePasteData: state.preparePasteData,
        hasClipboard: state.hasClipboard,
        clipboard: state.clipboard,
        pendingSelection: state.pendingSelection,
        setPendingSelection: state.setPendingSelection,
        clearPendingSelection: state.clearPendingSelection,
      }))
    )

    const currentWorkflow = useCurrentWorkflow()

    // Undo/redo availability for context menu
    const { data: session } = useSession()
    const userId = session?.user?.id || 'unknown'
    const undoRedoStacks = useUndoRedoStore((s) => s.stacks)
    const undoRedoKey = activeWorkflowId && userId ? `${activeWorkflowId}:${userId}` : ''
    const undoRedoStack = (undoRedoKey && undoRedoStacks[undoRedoKey]) || { undo: [], redo: [] }
    const canUndo = undoRedoStack.undo.length > 0
    const canRedo = undoRedoStack.redo.length > 0

    const { updateNodeDimensions, setDragStartPosition, getDragStartPosition } = useWorkflowStore(
      useShallow((state) => ({
        updateNodeDimensions: state.updateNodeDimensions,
        setDragStartPosition: state.setDragStartPosition,
        getDragStartPosition: state.getDragStartPosition,
      }))
    )

    const { handleRunFromBlock, handleRunUntilBlock, handleRunWorkflow, handleCancelExecution } =
      useWorkflowExecution()

    const lowMemorySettingsQueryOptions = useMemo(() => ({ enabled: !IS_LOW_MEMORY_DEV }), [])
    const snapToGridSize = useSnapToGridSize(lowMemorySettingsQueryOptions)
    const snapToGrid = snapToGridSize > 0

    const isAutoConnectEnabled = useAutoConnect(lowMemorySettingsQueryOptions) && !sandbox
    const autoConnectRef = useRef(isAutoConnectEnabled)
    autoConnectRef.current = isAutoConnectEnabled

    // Panel open states for context menu
    const isVariablesOpen = useVariablesModalStore((state) => state.isOpen)
    const isChatOpen = useChatStore((state) => state.isChatOpen)
    const isWorkflowSearchReplaceOpen = useWorkflowSearchReplaceStore((state) => state.isOpen)
    const frameSelection = useVideoFrameSelectionStore((state) => state.selection)
    const clearFrameSelection = useVideoFrameSelectionStore((state) => state.clearSelection)

    const snapGrid: [number, number] = useMemo(
      () => [snapToGridSize, snapToGridSize],
      [snapToGridSize]
    )

    const { blocks, edges, lastSaved } = currentWorkflow
    const workflowMetadata = workflows[workflowIdParam]
    const isPublishedTrack = workflowMetadata?.track === 'published'
    const workflowRowLocked = !!workflowMetadata?.locked
    const workflowFolderLocked = isFolderOrAncestorLocked(workflowMetadata?.folderId, folders)

    const allBlocksLocked = useMemo(() => {
      const blockList = Object.values(blocks)
      return blockList.length > 0 && blockList.every((b) => b.locked)
    }, [blocks])
    const workflowLocked = workflowRowLocked || workflowFolderLocked
    const workflowReadOnly = workflowLocked && !sandbox
    const workflowTrackReadOnly = Boolean(isPublishedTrack && !sandbox)
    const canvasOpacityClass = isCanvasReady
      ? workflowReadOnly || workflowTrackReadOnly
        ? 'opacity-75'
        : 'opacity-100'
      : 'opacity-0'

    const hasBlocks = useMemo(() => Object.keys(blocks).length > 0, [blocks])

    const hasLockedBlocks = useMemo(() => Object.values(blocks).some((b) => b.locked), [blocks])

    const workflowBlockTypes = useMemo(
      () =>
        Array.from(
          new Set(
            Object.values(blocks)
              .map((block) => block.type)
              .filter(
                (type): type is string => Boolean(type) && type !== 'loop' && type !== 'parallel'
              )
              .map(resolveCatalogBlockType)
              .filter((type) => Boolean(getAnyBlockCatalogEntry(type)))
          )
        ).sort((a, b) => a.localeCompare(b)),
      [blocks]
    )

    const blockConfigs = useMemo(
      () =>
        Object.fromEntries(
          workflowBlockTypes
            .map((type) => {
              const config = getBlockConfigFromCatalog(type)
              return config ? ([type, config] as const) : null
            })
            .filter((entry): entry is readonly [string, BlockConfig] => Boolean(entry))
        ),
      [workflowBlockTypes]
    )

    const areWorkflowBlockConfigsReady = useMemo(
      () => workflowBlockTypes.every((type) => Boolean(blockConfigs[type])),
      [blockConfigs, workflowBlockTypes]
    )

    const isWorkflowReady = useMemo(
      () =>
        !isWorkflowMapPlaceholderData &&
        hydration.phase === 'ready' &&
        hydration.workflowId === workflowIdParam &&
        activeWorkflowId === workflowIdParam &&
        (shouldSkipWorkflowMap || Boolean(workflows[workflowIdParam])) &&
        lastSaved !== undefined &&
        areWorkflowBlockConfigsReady,
      [
        shouldSkipWorkflowMap,
        isWorkflowMapPlaceholderData,
        hydration.phase,
        hydration.workflowId,
        workflowIdParam,
        activeWorkflowId,
        workflows,
        lastSaved,
        areWorkflowBlockConfigsReady,
      ]
    )

    const scheduleEmbeddedFit = useCallback(() => {
      if (!embedded || !isWorkflowReady) return

      if (embeddedFitFrameRef.current !== null) {
        cancelAnimationFrame(embeddedFitFrameRef.current)
      }

      embeddedFitFrameRef.current = requestAnimationFrame(() => {
        embeddedFitFrameRef.current = null

        const container = canvasContainerRef.current
        if (!container) return

        const rect = container.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return

        const nodes = reactFlowInstance.getNodes()
        if (nodes.length > 0) {
          void reactFlowInstance.fitView(embeddedResizeFitViewOptions)
        }

        if (!hasCompletedInitialEmbeddedFitRef.current) {
          hasCompletedInitialEmbeddedFitRef.current = true
          setIsCanvasReady(true)
        }
      })
    }, [embedded, isWorkflowReady, reactFlowInstance])

    const {
      getNodeDepth,
      getNodeAbsolutePosition,
      isDescendantOf,
      calculateRelativePosition,
      isPointInLoopNode,
      resizeLoopNodes,
      updateNodeParent: updateNodeParentUtil,
      getNodeAnchorPosition,
      getBlockDimensions,
    } = useNodeUtilities(blocks)

    const resizeLoopNodesWrapper = useCallback(() => {
      return resizeLoopNodes(updateNodeDimensions)
    }, [resizeLoopNodes, updateNodeDimensions])

    /** Checks if a node can be placed inside a container (loop/parallel). */
    const canNodeEnterContainer = useCallback(
      (node: Node): boolean => {
        if (node.data?.type === 'starter') return false
        const block = blocks[node.id]
        return !(block && TriggerUtils.isTriggerBlock(block))
      },
      [blocks]
    )

    /** Shifts position updates to ensure nodes stay within container bounds. */
    const shiftUpdatesToContainerBounds = useCallback(
      <T extends { newPosition: { x: number; y: number } }>(rawUpdates: T[]): T[] => {
        if (rawUpdates.length === 0) return rawUpdates

        const minX = Math.min(...rawUpdates.map((u) => u.newPosition.x))
        const minY = Math.min(...rawUpdates.map((u) => u.newPosition.y))

        const targetMinX = CONTAINER_DIMENSIONS.LEFT_PADDING
        const targetMinY = CONTAINER_DIMENSIONS.HEADER_HEIGHT + CONTAINER_DIMENSIONS.TOP_PADDING

        const shiftX = minX < targetMinX ? targetMinX - minX : 0
        const shiftY = minY < targetMinY ? targetMinY - minY : 0

        if (shiftX === 0 && shiftY === 0) return rawUpdates

        return rawUpdates.map((u) => ({
          ...u,
          newPosition: {
            x: u.newPosition.x + shiftX,
            y: u.newPosition.y + shiftY,
          },
        }))
      },
      []
    )

    /** Clears the active drag highlight only when the target actually changes. */
    const resetDragHighlights = useCallback(() => {
      if (getDragHighlightTransition(highlightedContainerRef.current, null) === 'noop') {
        return
      }
      clearDragHighlights()
      highlightedContainerRef.current = null
    }, [])

    /** Applies highlight styling to a container node during drag operations. */
    const highlightContainerNode = useCallback(
      (containerId: string, containerKind: 'loop' | 'parallel') => {
        if (getDragHighlightTransition(highlightedContainerRef.current, containerId) === 'noop') {
          return
        }

        clearDragHighlights()
        const containerElement = document.querySelector(`[data-id="${containerId}"]`)
        if (containerElement) {
          containerElement.classList.add(
            containerKind === 'loop' ? 'loop-node-drag-over' : 'parallel-node-drag-over'
          )
          document.body.style.cursor = 'copy'
          highlightedContainerRef.current = containerId
          return
        }

        highlightedContainerRef.current = null
      },
      []
    )

    const { handleAutoLayout: autoLayoutWithFitView } = useAutoLayout(
      activeWorkflowId || null,
      {
        embedded,
      },
      lowMemorySettingsQueryOptions
    )

    const isWorkflowEmpty = useMemo(() => Object.keys(blocks).length === 0, [blocks])

    /** Handles OAuth connect events dispatched by Copilot tools. */
    useEffect(() => {
      const handleOpenOAuthConnect = (event: Event) => {
        const detail = (event as CustomEvent<OAuthConnectEventDetail>).detail
        if (!detail) return

        writeOAuthReturnContext({
          origin: 'workflow',
          workflowId: workflowIdParam,
          displayName: detail.providerName,
          providerId: detail.providerId,
          preCount: 0,
          workspaceId,
          requestedAt: Date.now(),
        })

        setOauthModal({
          provider: detail.providerId as OAuthProvider,
          serviceId: detail.serviceId,
          providerName: detail.providerName,
          requiredScopes: detail.requiredScopes || [],
          newScopes: detail.newScopes || [],
        })
      }

      window.addEventListener('open-oauth-connect', handleOpenOAuthConnect as EventListener)
      return () =>
        window.removeEventListener('open-oauth-connect', handleOpenOAuthConnect as EventListener)
    }, [workflowIdParam, workspaceId])

    const { diffAnalysis, isShowingDiff, isDiffReady, reapplyDiffMarkers, hasActiveDiff } =
      useWorkflowDiffStore(
        useShallow((state) => ({
          diffAnalysis: state.diffAnalysis,
          isShowingDiff: state.isShowingDiff,
          isDiffReady: state.isDiffReady,
          reapplyDiffMarkers: state.reapplyDiffMarkers,
          hasActiveDiff: state.hasActiveDiff,
        }))
      )

    /** Stores source node/handle info when a connection drag starts for drop-on-block detection. */
    const connectionSourceRef = useRef<ConnectionStartParams | null>(null)

    /** Tracks whether onConnect successfully handled the connection (ReactFlow pattern). */
    const connectionCompletedRef = useRef(false)

    /** Stores start positions for multi-node drag undo/redo recording. */
    const multiNodeDragStartRef = useRef<Map<string, { x: number; y: number; parentId?: string }>>(
      new Map()
    )
    const highlightedContainerRef = useRef<string | null>(null)

    /** Re-applies diff markers when blocks change after socket rehydration. */
    const blocksRef = useRef(blocks)
    useEffect(() => {
      if (!isWorkflowReady) return
      if (hasActiveDiff && isDiffReady && blocks !== blocksRef.current) {
        blocksRef.current = blocks
        setTimeout(() => reapplyDiffMarkers(), 0)
      }
    }, [blocks, hasActiveDiff, isDiffReady, reapplyDiffMarkers, isWorkflowReady])

    /** Reconstructs deleted edges for diff view and filters invalid edges. */
    const edgesForDisplay = useMemo(() => {
      let edgesToFilter = edges

      if (!isShowingDiff && isDiffReady && diffAnalysis?.edge_diff?.deleted_edges) {
        const reconstructedEdges: Edge[] = []
        const validHandles = ['source', 'target', 'success', 'error', 'default', 'condition']

        diffAnalysis.edge_diff.deleted_edges.forEach((edgeIdentifier) => {
          const parts = edgeIdentifier.split('-')
          if (parts.length >= 4) {
            let sourceEndIndex = -1
            let targetStartIndex = -1

            for (let i = 1; i < parts.length - 1; i++) {
              if (validHandles.includes(parts[i])) {
                sourceEndIndex = i
                for (let j = i + 1; j < parts.length - 1; j++) {
                  if (parts[j].length > 0) {
                    targetStartIndex = j
                    break
                  }
                }
                break
              }
            }

            if (sourceEndIndex > 0 && targetStartIndex > 0) {
              const sourceId = parts.slice(0, sourceEndIndex).join('-')
              const sourceHandle = parts[sourceEndIndex]
              const targetHandle = parts[parts.length - 1]
              const targetId = parts.slice(targetStartIndex, parts.length - 1).join('-')

              if (blocks[sourceId] && blocks[targetId]) {
                reconstructedEdges.push({
                  id: `deleted-${sourceId}-${sourceHandle}-${targetId}-${targetHandle}`,
                  source: sourceId,
                  target: targetId,
                  sourceHandle,
                  targetHandle,
                  type: 'workflowEdge',
                  data: { isDeleted: true },
                })
              }
            }
          }
        })

        edgesToFilter = [...edges, ...reconstructedEdges]
      }

      return edgesToFilter.filter((edge) => {
        const sourceBlock = blocks[edge.source]
        const targetBlock = blocks[edge.target]
        return Boolean(sourceBlock && targetBlock)
      })
    }, [edges, isShowingDiff, isDiffReady, diffAnalysis, blocks])

    const { userPermissions, workspacePermissions, permissionsError } =
      useWorkspacePermissionsContext()
    const canPublishToMainline =
      userPermissions.canAdmin && workspaceSettingsData?.settings.workspace.canvasScope === 'team'
    /** Returns read-only permissions when viewing snapshot or a locked workflow. */
    const effectivePermissions = useMemo(() => {
      if (currentWorkflow.isSnapshotView || workflowReadOnly || workflowTrackReadOnly) {
        return {
          ...userPermissions,
          canEdit: false,
          canAdmin: currentWorkflow.isSnapshotView ? false : userPermissions.canAdmin,
          canRead: userPermissions.canRead,
        }
      }
      return userPermissions
    }, [userPermissions, currentWorkflow.isSnapshotView, workflowReadOnly, workflowTrackReadOnly])
    const {
      collaborativeBatchAddEdges,
      collaborativeBatchRemoveEdges,
      collaborativeBatchUpdatePositions,
      collaborativeBatchUpdateParent,
      collaborativeBatchAddBlocks,
      collaborativeBatchRemoveBlocks,
      collaborativeBatchToggleBlockEnabled,
      collaborativeBatchToggleBlockHandles,
      collaborativeBatchToggleLocked,
      collaborativeSetSubblockValue,
      undo,
      redo,
    } = useCollaborativeWorkflow()

    const updateBlockPosition = useCallback(
      (id: string, position: { x: number; y: number }) => {
        collaborativeBatchUpdatePositions([{ id, position }])
      },
      [collaborativeBatchUpdatePositions]
    )

    const addEdge = useCallback(
      (edge: Edge) => {
        collaborativeBatchAddEdges([edge])
      },
      [collaborativeBatchAddEdges]
    )

    const batchUpdateBlocksWithParent = useCallback(
      (updates: Array<{ id: string; position: { x: number; y: number }; parentId?: string }>) => {
        collaborativeBatchUpdateParent(
          updates.map((u) => ({
            blockId: u.id,
            newParentId: u.parentId || null,
            newPosition: u.position,
            affectedEdges: [],
          }))
        )
      },
      [collaborativeBatchUpdateParent]
    )

    /**
     * Executes a batch parent update for nodes being moved into or out of containers.
     * Consolidates the common logic used by onNodeDragStop and onSelectionDragStop.
     */
    const executeBatchParentUpdate = useCallback(
      (nodesToProcess: Node[], targetParentId: string | null, logMessage: string) => {
        // Build set of node IDs for efficient lookup
        const nodeIds = new Set(nodesToProcess.map((n) => n.id))

        // Filter to nodes whose parent is actually changing
        const nodesNeedingUpdate = nodesToProcess.filter((n) => {
          const block = blocks[n.id]
          if (!block) return false
          const currentParent = block.data?.parentId || null
          // Skip if the node's parent is also being moved (keep children with their parent)
          if (currentParent && nodeIds.has(currentParent)) return false
          return currentParent !== targetParentId
        })

        if (nodesNeedingUpdate.length === 0) return

        // Filter out nodes that cannot enter containers (when target is a container)
        let validNodes = targetParentId
          ? nodesNeedingUpdate.filter(canNodeEnterContainer)
          : nodesNeedingUpdate

        // Exclude nodes that would create a cycle (moving a container into one of its descendants)
        if (targetParentId) {
          validNodes = validNodes.filter((n) => !isDescendantOf(n.id, targetParentId))
        }

        if (validNodes.length === 0) return

        // Find boundary edges (edges that cross the container boundary)
        const movingNodeIds = new Set(validNodes.map((n) => n.id))
        const boundaryEdges = edgesForDisplay.filter((e) => {
          const sourceInSelection = movingNodeIds.has(e.source)
          const targetInSelection = movingNodeIds.has(e.target)
          return sourceInSelection !== targetInSelection
        })
        const boundaryEdgesByNode = mapEdgesByNode(boundaryEdges, movingNodeIds)

        // Build position updates
        const rawUpdates = validNodes.map((n) => {
          const edgesForThisNode = boundaryEdgesByNode.get(n.id) ?? []
          const newPosition = targetParentId
            ? calculateRelativePosition(n.id, targetParentId, true)
            : getNodeAbsolutePosition(n.id)
          return {
            blockId: n.id,
            newParentId: targetParentId,
            newPosition,
            affectedEdges: edgesForThisNode,
          }
        })

        // Shift to container bounds if moving into a container
        const updates = targetParentId ? shiftUpdatesToContainerBounds(rawUpdates) : rawUpdates

        collaborativeBatchUpdateParent(updates)

        // Update display nodes
        setDisplayNodes((nodes) =>
          nodes.map((node) => {
            const update = updates.find((u) => u.blockId === node.id)
            if (update) {
              return {
                ...node,
                position: update.newPosition,
                parentId: update.newParentId ?? undefined,
              }
            }
            return node
          })
        )

        // Resize container if moving into one
        if (targetParentId) {
          resizeLoopNodesWrapper()
        }

        logger.info(logMessage, {
          targetParentId,
          nodeCount: validNodes.length,
        })
      },
      [
        blocks,
        edgesForDisplay,
        canNodeEnterContainer,
        isDescendantOf,
        calculateRelativePosition,
        getNodeAbsolutePosition,
        shiftUpdatesToContainerBounds,
        collaborativeBatchUpdateParent,
        resizeLoopNodesWrapper,
      ]
    )

    const addBlock = useCallback(
      (
        id: string,
        type: string,
        name: string,
        position: { x: number; y: number },
        data?: Record<string, unknown>,
        parentId?: string,
        extent?: 'parent',
        autoConnectEdge?: Edge,
        triggerMode?: boolean,
        presetSubBlockValues?: Record<string, unknown>,
        blockConfig?: BlockConfig
      ) => {
        setPendingSelection([id])
        setSelectedEdges(new Map())

        const blockData: Record<string, unknown> = { ...(data || {}) }
        if (parentId) blockData.parentId = parentId
        if (extent) blockData.extent = extent

        const block = prepareBlockState({
          id,
          type,
          name,
          position,
          data: blockData,
          parentId,
          extent,
          triggerMode,
          blockConfig,
        })

        const subBlockValues: Record<string, Record<string, unknown>> = {}
        if (block.subBlocks && Object.keys(block.subBlocks).length > 0) {
          subBlockValues[id] = {}
          for (const [subBlockId, subBlock] of Object.entries(block.subBlocks)) {
            if (subBlock.value !== null && subBlock.value !== undefined) {
              subBlockValues[id][subBlockId] = subBlock.value
            }
          }
        }

        // Apply preset subblock values (e.g., from tool-operation search)
        if (presetSubBlockValues) {
          if (!subBlockValues[id]) {
            subBlockValues[id] = {}
          }
          Object.assign(subBlockValues[id], presetSubBlockValues)
        }

        collaborativeBatchAddBlocks(
          [block],
          autoConnectEdge ? [autoConnectEdge] : [],
          {},
          {},
          subBlockValues
        )
        usePanelEditorStore.getState().setCurrentBlockId(id)
      },
      [collaborativeBatchAddBlocks, setSelectedEdges, setPendingSelection]
    )

    const { activeBlockIds, pendingBlocks, isDebugging, isExecuting } = useExecutionStore(
      useShallow((state) => {
        const wf = activeWorkflowId ? state.workflowExecutions.get(activeWorkflowId) : undefined
        return {
          activeBlockIds: wf?.activeBlockIds ?? defaultWorkflowExecutionState.activeBlockIds,
          pendingBlocks: wf?.pendingBlocks ?? defaultWorkflowExecutionState.pendingBlocks,
          isDebugging: wf?.isDebugging ?? false,
          isExecuting: wf?.isExecuting ?? false,
        }
      })
    )
    const getLastExecutionSnapshot = useExecutionStore((s) => s.getLastExecutionSnapshot)

    const [dragStartParentId, setDragStartParentId] = useState<string | null>(null)

    /** Connection line style - red for error handles, default otherwise. */
    const connectionLineStyle = useMemo(
      () => ({
        stroke: isErrorConnectionDrag ? 'var(--text-error)' : 'var(--workflow-edge)',
        strokeWidth: 2,
      }),
      [isErrorConnectionDrag]
    )

    /** Logs permission loading results for debugging. */
    useEffect(() => {
      if (permissionsError) {
        logger.error('Failed to load workspace permissions', {
          workspaceId,
          error: permissionsError,
        })
      } else if (workspacePermissions) {
        logger.info('Workspace permissions loaded in workflow', {
          workspaceId,
          userCount: workspacePermissions.total,
          permissions: workspacePermissions.users.map((u) => ({
            email: u.email,
            permissions: u.permissionType,
          })),
        })
      }
    }, [workspacePermissions, permissionsError, workspaceId])

    const updateNodeParent = useCallback(
      (nodeId: string, newParentId: string | null, affectedEdges: any[] = []) => {
        const node = getNodes().find((n: any) => n.id === nodeId)
        if (!node) return

        const currentBlock = blocks[nodeId]
        if (!currentBlock) return

        const oldParentId = node.parentId || currentBlock.data?.parentId
        const oldPosition = { ...node.position }

        // affectedEdges are edges that are either being removed (when leaving a subflow)
        // or being added (when entering a subflow)
        if (!affectedEdges.length && !newParentId && oldParentId) {
          affectedEdges = edgesForDisplay.filter((e) => e.source === nodeId || e.target === nodeId)
        }

        let newPosition = oldPosition
        if (newParentId) {
          const nodeAbsPos = getNodeAbsolutePosition(nodeId)
          const parentAbsPos = getNodeAbsolutePosition(newParentId)
          const headerHeight = 50
          const leftPadding = 16
          const topPadding = 16
          newPosition = {
            x: nodeAbsPos.x - parentAbsPos.x - leftPadding,
            y: nodeAbsPos.y - parentAbsPos.y - headerHeight - topPadding,
          }
        } else if (oldParentId) {
          newPosition = getNodeAbsolutePosition(nodeId)
        }

        const result = updateNodeParentUtil(
          nodeId,
          newParentId,
          collaborativeBatchUpdatePositions,
          batchUpdateBlocksWithParent,
          () => resizeLoopNodesWrapper()
        )

        if (oldParentId !== newParentId) {
          window.dispatchEvent(
            new CustomEvent('workflow-record-parent-update', {
              detail: {
                blockId: nodeId,
                oldParentId: oldParentId || undefined,
                newParentId: newParentId || undefined,
                oldPosition,
                newPosition,
                affectedEdges: affectedEdges.map((e) => ({ ...e })),
              },
            })
          )
        }

        return result
      },
      [
        getNodes,
        collaborativeBatchUpdatePositions,
        batchUpdateBlocksWithParent,
        blocks,
        edgesForDisplay,
        getNodeAbsolutePosition,
        updateNodeParentUtil,
        resizeLoopNodesWrapper,
      ]
    )

    /** Applies auto-layout to the workflow canvas. */
    const handleAutoLayout = useCallback(async () => {
      if (Object.keys(blocks).length === 0) return
      await autoLayoutWithFitView()
    }, [blocks, autoLayoutWithFitView])

    const debouncedAutoLayout = useCallback(() => {
      const debounceTimer = setTimeout(() => {
        handleAutoLayout()
      }, 250)

      return () => clearTimeout(debounceTimer)
    }, [handleAutoLayout])

    const {
      isBlockMenuOpen,
      isPaneMenuOpen,
      position: contextMenuPosition,
      menuRef: contextMenuRef,
      selectedBlocks: contextMenuBlocks,
      handleNodeContextMenu,
      handlePaneContextMenu,
      handleSelectionContextMenu,
      closeMenu: closeContextMenu,
    } = useCanvasContextMenu({ blocks, getNodes, setNodes })

    const handleContextCopy = useCallback(() => {
      const blockIds = contextMenuBlocks.map((b) => b.id)
      copyBlocks(blockIds)
    }, [contextMenuBlocks, copyBlocks])

    const notifyProtectedBlockRemoval = useCallback(
      (protectedIds: string[], allProtected: boolean) => {
        if (protectedIds.length === 0) return false

        if (allProtected) {
          addNotification({
            level: 'info',
            message: 'Cannot delete locked blocks or blocks inside locked containers',
            workflowId: activeWorkflowId || undefined,
          })
          return true
        }

        addNotification({
          level: 'info',
          message: `Skipped ${protectedIds.length} protected block(s)`,
          workflowId: activeWorkflowId || undefined,
        })
        return false
      },
      [activeWorkflowId, addNotification]
    )

    const clearVideoFrameMediaForRemovedBlock = useCallback(
      (videoBlockId: string, autoLinkType: ContentReferenceAutoLinkType) => {
        const targetBlock = blocks[videoBlockId]
        if (!targetBlock || targetBlock.type !== 'content') return

        const targetStoreValues = activeWorkflowId
          ? useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[videoBlockId]
          : undefined
        const storedVideoMedia = normalizeVideoMediaSnapshots(targetStoreValues?.videoMedia)
        const currentVideoMedia =
          storedVideoMedia.length > 0
            ? storedVideoMedia
            : normalizeVideoMediaSnapshots(targetBlock.subBlocks?.videoMedia?.value)

        collaborativeSetSubblockValue(
          videoBlockId,
          'videoMedia',
          removeVideoMediaFileForType(
            currentVideoMedia,
            autoLinkType === 'video_first_frame' ? 'first_frame' : 'last_frame'
          )
        )
      },
      [activeWorkflowId, blocks, collaborativeSetSubblockValue]
    )

    const removeBlocksWithProtection = useCallback(
      (blockIds: string[]) => {
        const { deletableIds, protectedIds, allProtected } = filterProtectedBlocks(blockIds, blocks)
        if (notifyProtectedBlockRemoval(protectedIds, allProtected)) return []

        if (deletableIds.length > 0) {
          edges.forEach((edge) => {
            const autoLinkType = getContentReferenceAutoLinkType(edge)
            if (!autoLinkType) return
            if (!deletableIds.includes(edge.source) && !deletableIds.includes(edge.target)) return
            clearVideoFrameMediaForRemovedBlock(edge.target, autoLinkType)
          })
          collaborativeBatchRemoveBlocks(deletableIds)
        }

        return deletableIds
      },
      [
        blocks,
        clearVideoFrameMediaForRemovedBlock,
        collaborativeBatchRemoveBlocks,
        edges,
        notifyProtectedBlockRemoval,
      ]
    )

    const cutBlocksWithProtection = useCallback(
      (blockIds: string[]) => {
        const { deletableIds, protectedIds, allProtected } = filterProtectedBlocks(blockIds, blocks)
        if (notifyProtectedBlockRemoval(protectedIds, allProtected)) return

        if (deletableIds.length > 0) {
          copyBlocks(deletableIds)
          edges.forEach((edge) => {
            const autoLinkType = getContentReferenceAutoLinkType(edge)
            if (!autoLinkType) return
            if (!deletableIds.includes(edge.source) && !deletableIds.includes(edge.target)) return
            clearVideoFrameMediaForRemovedBlock(edge.target, autoLinkType)
          })
          collaborativeBatchRemoveBlocks(deletableIds)
        }
      },
      [
        blocks,
        clearVideoFrameMediaForRemovedBlock,
        collaborativeBatchRemoveBlocks,
        copyBlocks,
        edges,
        notifyProtectedBlockRemoval,
      ]
    )

    /**
     * Executes a paste operation with validation and selection handling.
     * Consolidates shared logic for context paste, duplicate, and keyboard paste.
     */
    const executePasteOperation = useCallback(
      (
        operation: 'paste' | 'duplicate',
        pasteOffset: { x: number; y: number },
        targetContainer?: {
          loopId: string
          loopPosition: { x: number; y: number }
          dimensions: { width: number; height: number }
        } | null,
        pasteTargetPosition?: { x: number; y: number }
      ) => {
        // For context menu paste into a subflow, calculate offset to center blocks at click position
        // Skip click-position centering if blocks came from inside a subflow (relative coordinates)
        let effectiveOffset = pasteOffset
        if (targetContainer && pasteTargetPosition && clipboard) {
          const clipboardBlocks = Object.values(clipboard.blocks)
          // Only use click-position centering for top-level blocks (absolute coordinates)
          // Blocks with parentId have relative positions that can't be mixed with absolute click position
          const hasNestedBlocks = clipboardBlocks.some((b) => b.data?.parentId)
          if (clipboardBlocks.length > 0 && !hasNestedBlocks) {
            const minX = Math.min(...clipboardBlocks.map((b) => b.position.x))
            const maxX = Math.max(
              ...clipboardBlocks.map((b) => b.position.x + BLOCK_DIMENSIONS.FIXED_WIDTH)
            )
            const minY = Math.min(...clipboardBlocks.map((b) => b.position.y))
            const maxY = Math.max(
              ...clipboardBlocks.map((b) => b.position.y + BLOCK_DIMENSIONS.MIN_HEIGHT)
            )
            const clipboardCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
            effectiveOffset = {
              x: pasteTargetPosition.x - clipboardCenter.x,
              y: pasteTargetPosition.y - clipboardCenter.y,
            }
          }
        }

        const pasteData = preparePasteData(effectiveOffset)
        if (!pasteData) return

        let pastedBlocksArray = Object.values(pasteData.blocks)

        // If pasting into a subflow, adjust blocks to be children of that subflow
        if (targetContainer) {
          // Check if any pasted block is a trigger - triggers cannot be in subflows
          const hasTrigger = pastedBlocksArray.some((b) => TriggerUtils.isTriggerBlock(b))
          if (hasTrigger) {
            addNotification({
              level: 'error',
              message: 'Triggers cannot be placed inside loop or parallel subflows.',
              workflowId: activeWorkflowId || undefined,
            })
            return
          }

          // Prevent cycle: pasting a container that is the target container itself or one of its ancestors.
          // Use original clipboard IDs since preparePasteData regenerates them via generateId().
          const ancestorIds = new Set<string>()
          let walkId: string | undefined = targetContainer.loopId
          while (walkId && !ancestorIds.has(walkId)) {
            ancestorIds.add(walkId)
            walkId = blocks[walkId]?.data?.parentId as string | undefined
          }
          const originalClipboardBlocks = clipboard ? Object.values(clipboard.blocks) : []
          const wouldCreateCycle = originalClipboardBlocks.some(
            (b) => (b.type === 'loop' || b.type === 'parallel') && ancestorIds.has(b.id)
          )
          if (wouldCreateCycle) {
            addNotification({
              level: 'error',
              message: 'Cannot paste a subflow inside itself or its own descendant.',
              workflowId: activeWorkflowId || undefined,
            })
            return
          }

          // Adjust each block's position to be relative to the container and set parentId
          pastedBlocksArray = pastedBlocksArray.map((block) => {
            // For blocks already nested (have parentId), positions are already relative - use as-is
            // For top-level blocks, convert absolute position to relative by subtracting container position
            const wasNested = Boolean(block.data?.parentId)
            const relativePosition = wasNested
              ? { x: block.position.x, y: block.position.y }
              : {
                  x: block.position.x - targetContainer.loopPosition.x,
                  y: block.position.y - targetContainer.loopPosition.y,
                }

            // Clamp position to keep block inside container (below header)
            const clampedPosition = {
              x: Math.max(
                CONTAINER_DIMENSIONS.LEFT_PADDING,
                Math.min(
                  relativePosition.x,
                  targetContainer.dimensions.width -
                    BLOCK_DIMENSIONS.FIXED_WIDTH -
                    CONTAINER_DIMENSIONS.RIGHT_PADDING
                )
              ),
              y: Math.max(
                CONTAINER_DIMENSIONS.HEADER_HEIGHT + CONTAINER_DIMENSIONS.TOP_PADDING,
                Math.min(
                  relativePosition.y,
                  targetContainer.dimensions.height -
                    BLOCK_DIMENSIONS.MIN_HEIGHT -
                    CONTAINER_DIMENSIONS.BOTTOM_PADDING
                )
              ),
            }

            return {
              ...block,
              position: clampedPosition,
              data: {
                ...block.data,
                parentId: targetContainer.loopId,
                extent: 'parent',
              },
            }
          })

          // Update pasteData.blocks with the modified blocks
          pasteData.blocks = pastedBlocksArray.reduce(
            (acc, block) => {
              acc[block.id] = block
              return acc
            },
            {} as Record<string, (typeof pastedBlocksArray)[0]>
          )
        }

        const validation = validateTriggerPaste(pastedBlocksArray, blocks, operation)
        if (!validation.isValid) {
          addNotification({
            level: 'error',
            message: validation.message!,
            workflowId: activeWorkflowId || undefined,
          })
          return
        }

        // Set pending selection before adding blocks - sync effect will apply it (accumulates for rapid pastes)
        setPendingSelection(pastedBlocksArray.map((b) => b.id))

        collaborativeBatchAddBlocks(
          pastedBlocksArray,
          pasteData.edges,
          pasteData.loops,
          pasteData.parallels,
          pasteData.subBlockValues
        )

        // Resize container if we pasted into a subflow
        if (targetContainer) {
          resizeLoopNodesWrapper()
        }
      },
      [
        preparePasteData,
        blocks,
        clipboard,
        addNotification,
        activeWorkflowId,
        collaborativeBatchAddBlocks,
        setPendingSelection,
        resizeLoopNodesWrapper,
      ]
    )

    const handleContextPaste = useCallback(() => {
      if (!hasClipboard()) return

      // Convert context menu position to flow coordinates and check if inside a subflow
      const flowPosition = screenToFlowPosition(contextMenuPosition)
      const targetContainer = isPointInLoopNode(flowPosition)

      executePasteOperation(
        'paste',
        calculatePasteOffset(clipboard, getViewportCenter()),
        targetContainer,
        flowPosition // Pass the click position so blocks are centered at where user right-clicked
      )
    }, [
      hasClipboard,
      executePasteOperation,
      clipboard,
      getViewportCenter,
      screenToFlowPosition,
      contextMenuPosition,
      isPointInLoopNode,
    ])

    const handleContextDuplicate = useCallback(() => {
      copyBlocks(contextMenuBlocks.map((b) => b.id))
      executePasteOperation('duplicate', DEFAULT_PASTE_OFFSET)
    }, [contextMenuBlocks, copyBlocks, executePasteOperation])

    const copyToCanvasDisabledReason = useMemo(() => {
      if (!copyTargetDescriptor) return 'No alternate personal/team canvas is available'
      if (!copyTargetWorkflow) return 'Target canvas does not have a node graph yet'
      return 'Select blocks to copy'
    }, [copyTargetDescriptor, copyTargetWorkflow])

    const canCopySelectionToCanvas = Boolean(
      activeWorkflowId &&
        copyTargetDescriptor &&
        copyTargetWorkflow &&
        contextMenuBlocks.length > 0 &&
        !isCopyingSelection
    )

    const handleContextCopyToCanvas = useCallback(async () => {
      if (!activeWorkflowId || !copyTargetDescriptor || !copyTargetWorkflow) {
        addNotification({
          level: 'error',
          message: copyToCanvasDisabledReason,
          workflowId: activeWorkflowId || undefined,
        })
        return
      }

      const blockIds = contextMenuBlocks.map((block) => block.id)
      if (blockIds.length === 0) return

      try {
        const result = await copySelection({
          workflowId: activeWorkflowId,
          body: {
            source: { type: copyTargetDescriptor.sourceType, workflowId: activeWorkflowId },
            target: {
              type: copyTargetDescriptor.targetType,
              workspaceId: copyTargetDescriptor.targetWorkspaceId,
              workflowId: copyTargetWorkflow.id,
            },
            selection: {
              blockIds,
              edgeIds: Array.from(selectedEdges.values()),
            },
          },
        })
        addNotification({
          level: 'info',
          message: `Copied ${result.inserted.blockIds.length} block(s) to ${copyTargetDescriptor.label.toLowerCase().replace('copy to ', '')}.`,
          workflowId: activeWorkflowId,
        })
      } catch (error) {
        logger.warn('Failed to copy selection to another canvas', { error })
        addNotification({
          level: 'error',
          message: 'Failed to copy selection to the target canvas.',
          workflowId: activeWorkflowId,
        })
      }
    }, [
      activeWorkflowId,
      addNotification,
      contextMenuBlocks,
      copySelection,
      copyTargetDescriptor,
      copyTargetWorkflow,
      copyToCanvasDisabledReason,
      selectedEdges,
    ])

    const handleContextCut = useCallback(() => {
      cutBlocksWithProtection(contextMenuBlocks.map((b) => b.id))
    }, [contextMenuBlocks, cutBlocksWithProtection])

    const handleContextDelete = useCallback(() => {
      removeBlocksWithProtection(contextMenuBlocks.map((b) => b.id))
    }, [contextMenuBlocks, removeBlocksWithProtection])

    const handleContextToggleEnabled = useCallback(() => {
      const blockIds = contextMenuBlocks.map((block) => block.id)
      collaborativeBatchToggleBlockEnabled(blockIds)
    }, [contextMenuBlocks, collaborativeBatchToggleBlockEnabled])

    const handleContextToggleHandles = useCallback(() => {
      const blockIds = contextMenuBlocks.map((block) => block.id)
      collaborativeBatchToggleBlockHandles(blockIds)
    }, [contextMenuBlocks, collaborativeBatchToggleBlockHandles])

    const handleContextToggleLocked = useCallback(() => {
      const blockIds = contextMenuBlocks.map((block) => block.id)
      collaborativeBatchToggleLocked(blockIds)
    }, [contextMenuBlocks, collaborativeBatchToggleLocked])

    const handleToggleWorkflowLock = useCallback(() => {
      const currentBlocks = useWorkflowStore.getState().blocks
      const allLocked = Object.values(currentBlocks).every((b) => b.locked)
      const ids = getWorkflowLockToggleIds(currentBlocks, !allLocked)
      if (ids.length > 0) collaborativeBatchToggleLocked(ids)
    }, [collaborativeBatchToggleLocked])

    const lockNotificationIdRef = useRef<string | null>(null)

    const clearLockNotification = useCallback(() => {
      if (lockNotificationIdRef.current) {
        useNotificationStore.getState().removeNotification(lockNotificationIdRef.current)
        lockNotificationIdRef.current = null
      }
    }, [])

    // Clear persisted lock notifications on mount/workflow change (prevents duplicates after reload)
    useEffect(() => {
      // Reset ref so the main effect creates a fresh notification for the new workflow
      clearLockNotification()

      if (!activeWorkflowId) return
      const store = useNotificationStore.getState()
      const stale = store.notifications.filter(
        (n) =>
          n.workflowId === activeWorkflowId &&
          (n.action?.type === 'unlock-workflow' || n.message.startsWith('This workflow is locked'))
      )
      for (const n of stale) {
        store.removeNotification(n.id)
      }
    }, [activeWorkflowId, clearLockNotification])

    /**
     * Locate the folder ancestor that supplies the inherited lock so the
     * notification can name it. Null when the lock is row/block-level instead.
     */
    const inheritedLockFolderName = useMemo(() => {
      if (!workflowFolderLocked) return null
      return findLockedAncestorFolder(workflowMetadata?.folderId, folders)?.name ?? null
    }, [workflowFolderLocked, workflowMetadata?.folderId, folders])

    const prevIsAdminRef = useRef(
      workspacePermissions?.viewer?.isAdmin ?? effectivePermissions.canAdmin
    )
    const prevLockSignatureRef = useRef<string | null>(null)
    useEffect(() => {
      if (!isWorkflowReady) return

      const isAdmin = workspacePermissions?.viewer?.isAdmin ?? effectivePermissions.canAdmin
      const canAdminChanged = prevIsAdminRef.current !== isAdmin
      prevIsAdminRef.current = isAdmin

      const lockSignature =
        workflowReadOnly || workflowTrackReadOnly
          ? workflowRowLocked
            ? 'row'
            : `folder:${inheritedLockFolderName ?? ''}`
          : null
      const lockSignatureChanged = prevLockSignatureRef.current !== lockSignature
      prevLockSignatureRef.current = lockSignature

      if (canAdminChanged || lockSignatureChanged) {
        clearLockNotification()
      }

      if (workflowReadOnly || workflowTrackReadOnly) {
        if (lockNotificationIdRef.current) return
        const isFolderInherited = workflowFolderLocked && !workflowRowLocked
        const message = isFolderInherited
          ? inheritedLockFolderName
            ? `This workflow is locked by folder "${inheritedLockFolderName}"`
            : 'This workflow is locked by a parent folder'
          : isAdmin
            ? 'This workflow is locked'
            : 'This workflow is locked. Ask an admin to unlock it.'

        const showInlineUnlock = isAdmin && !isFolderInherited

        lockNotificationIdRef.current = addNotification({
          level: 'info',
          message,
          workflowId: activeWorkflowId || undefined,
          ...(showInlineUnlock
            ? { action: { type: 'unlock-workflow' as const, message: '' } }
            : {}),
        })
      } else {
        clearLockNotification()
      }
    }, [
      workflowReadOnly,
      workflowTrackReadOnly,
      workflowRowLocked,
      workflowFolderLocked,
      inheritedLockFolderName,
      isWorkflowReady,
      effectivePermissions.canAdmin,
      workspacePermissions,
      addNotification,
      activeWorkflowId,
      clearLockNotification,
    ])

    // Clean up notification on unmount
    useEffect(() => clearLockNotification, [clearLockNotification])

    /**
     * `mutate` is the only stable handle on a TanStack Query v5 mutation; the
     * mutation object itself rebuilds on every state change (e.g. `isPending`
     * flipping during the unlock call), so depend on `.mutate` directly.
     */
    const updateWorkflowMutate = updateWorkflowMutation.mutate
    useEffect(() => {
      const handleUnlockWorkflow = () => {
        if (workflowRowLocked && activeWorkflowId) {
          updateWorkflowMutate({
            workspaceId,
            workflowId: activeWorkflowId,
            metadata: { locked: false },
          })
        }
      }

      window.addEventListener('unlock-workflow', handleUnlockWorkflow)
      return () => window.removeEventListener('unlock-workflow', handleUnlockWorkflow)
    }, [activeWorkflowId, updateWorkflowMutate, workflowRowLocked, workspaceId])

    const handleContextRemoveFromSubflow = useCallback(() => {
      const blocksToRemove = contextMenuBlocks.filter(
        (block) =>
          block.parentId && (block.parentType === 'loop' || block.parentType === 'parallel')
      )
      if (blocksToRemove.length > 0) {
        window.dispatchEvent(
          new CustomEvent('remove-from-subflow', {
            detail: { blockIds: blocksToRemove.map((b) => b.id) },
          })
        )
      }
    }, [contextMenuBlocks])

    const handleContextOpenEditor = useCallback(() => {
      if (contextMenuBlocks.length === 1) {
        usePanelEditorStore.getState().setCurrentBlockId(contextMenuBlocks[0].id)
      }
    }, [contextMenuBlocks])

    const handleContextRename = useCallback(() => {
      if (contextMenuBlocks.length === 1) {
        usePanelEditorStore.getState().setCurrentBlockId(contextMenuBlocks[0].id)
        usePanelEditorStore.getState().triggerRename()
      }
    }, [contextMenuBlocks])

    const handleContextRunFromBlock = useCallback(() => {
      if (contextMenuBlocks.length !== 1) return
      const blockId = contextMenuBlocks[0].id
      handleRunFromBlock(blockId, workflowIdParam)
    }, [contextMenuBlocks, workflowIdParam, handleRunFromBlock])

    const handleContextRunUntilBlock = useCallback(() => {
      if (contextMenuBlocks.length !== 1) return
      const blockId = contextMenuBlocks[0].id
      handleRunUntilBlock(blockId, workflowIdParam)
    }, [contextMenuBlocks, workflowIdParam, handleRunUntilBlock])

    const runFromBlockState = useMemo(() => {
      if (contextMenuBlocks.length !== 1) {
        return { canRun: false, reason: undefined }
      }
      const block = contextMenuBlocks[0]
      const snapshot = getLastExecutionSnapshot(workflowIdParam)
      const incomingEdges = edges.filter((edge) => edge.target === block.id)
      const isTriggerBlock = incomingEdges.length === 0

      // Check if each source block is either executed OR is a trigger block (triggers don't need prior execution)
      const isSourceSatisfied = (sourceId: string) => {
        if (snapshot?.executedBlocks.includes(sourceId)) return true
        // Check if source is a trigger (has no incoming edges itself)
        const sourceIncomingEdges = edges.filter((edge) => edge.target === sourceId)
        return sourceIncomingEdges.length === 0
      }

      // Non-trigger blocks need a snapshot to exist (so upstream outputs are available)
      const dependenciesSatisfied =
        isTriggerBlock ||
        (snapshot && incomingEdges.every((edge) => isSourceSatisfied(edge.source)))
      const isPureCanvasBlock = isPureCanvasBlockType(block.type)
      const isInsideSubflow =
        block.parentId && (block.parentType === 'loop' || block.parentType === 'parallel')

      if (isInsideSubflow) return { canRun: false, reason: 'Cannot run from inside subflow' }
      if (!dependenciesSatisfied) return { canRun: false, reason: 'Run previous blocks first' }
      if (isPureCanvasBlock) return { canRun: false, reason: undefined }
      if (isExecuting) return { canRun: false, reason: undefined }

      return { canRun: true, reason: undefined }
    }, [contextMenuBlocks, edges, workflowIdParam, getLastExecutionSnapshot, isExecuting])

    const handleContextOpenLogs = useCallback(() => {
      router.push(`/workspace/${workspaceId}/logs?workflowIds=${workflowIdParam}`)
    }, [router, workspaceId, workflowIdParam])

    const handleContextOpenSearchReplace = useCallback(() => {
      useWorkflowSearchReplaceStore.getState().open()
    }, [])

    const handleContextToggleVariables = useCallback(() => {
      const { isOpen, setIsOpen } = useVariablesModalStore.getState()
      setIsOpen(!isOpen)
    }, [])

    const handleContextToggleChat = useCallback(() => {
      const { isChatOpen, setIsChatOpen } = useChatStore.getState()
      setIsChatOpen(!isChatOpen)
    }, [])

    useEffect(() => {
      let cleanup: (() => void) | null = null

      const handleKeyDown = (event: KeyboardEvent) => {
        if (isInEditableElement()) {
          event.stopPropagation()
          return
        }

        if (event.shiftKey && event.key === 'L' && !event.ctrlKey && !event.metaKey) {
          event.preventDefault()
          if (cleanup) cleanup()
          cleanup = debouncedAutoLayout()
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'z' && !event.shiftKey) {
          event.preventDefault()
          undo()
        } else if (
          (event.ctrlKey || event.metaKey) &&
          (event.key === 'Z' || (event.key === 'z' && event.shiftKey))
        ) {
          event.preventDefault()
          redo()
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
          const selection = window.getSelection()
          const hasTextSelection = selection && selection.toString().length > 0

          if (hasTextSelection) {
            return
          }

          const selectedNodes = getNodes().filter((node) => node.selected)
          if (selectedNodes.length > 0) {
            event.preventDefault()
            copyBlocks(selectedNodes.map((node) => node.id))
          } else {
            const currentBlockId = usePanelEditorStore.getState().currentBlockId
            if (currentBlockId && blocks[currentBlockId]) {
              event.preventDefault()
              copyBlocks([currentBlockId])
            }
          }
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'x') {
          const selection = window.getSelection()
          const hasTextSelection = selection && selection.toString().length > 0

          if (hasTextSelection || !effectivePermissions.canEdit) {
            return
          }

          const selectedNodes = getNodes().filter((node) => node.selected)
          if (selectedNodes.length > 0) {
            event.preventDefault()
            cutBlocksWithProtection(selectedNodes.map((node) => node.id))
          }
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'v') {
          if (effectivePermissions.canEdit && hasClipboard()) {
            event.preventDefault()
            executePasteOperation('paste', calculatePasteOffset(clipboard, getViewportCenter()))
          }
        }
      }

      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('keydown', handleKeyDown)
        if (cleanup) cleanup()
      }
    }, [
      debouncedAutoLayout,
      undo,
      redo,
      getNodes,
      copyBlocks,
      cutBlocksWithProtection,
      hasClipboard,
      effectivePermissions.canEdit,
      clipboard,
      getViewportCenter,
      executePasteOperation,
    ])

    /**
     * Removes all edges connected to a block, skipping individual edge recording for undo/redo.
     * Used when moving nodes between containers where edges would violate boundary constraints.
     */
    const removeEdgesForNode = useCallback(
      (blockId: string, edgesToRemove: Edge[]): void => {
        if (edgesToRemove.length === 0) return

        const edgeIds = edgesToRemove.map((edge) => edge.id)
        collaborativeBatchRemoveEdges(edgeIds, { skipUndoRedo: true })

        logger.debug('Removed edges for node', {
          blockId,
          edgeCount: edgesToRemove.length,
        })
      },
      [collaborativeBatchRemoveEdges]
    )

    const isAutoConnectSourceCandidate = useCallback((block: BlockState): boolean => {
      if (!block.enabled) return false
      if (block.type === 'response') return false
      if (isAnnotationOnlyBlock(block.type)) return false
      return true
    }, [])

    /** Finds the closest block to a position for auto-connect. */
    const findClosestOutput = useCallback(
      (newNodePosition: { x: number; y: number }): BlockData | null => {
        const containerAtPoint = isPointInLoopNode(newNodePosition)
        const nodeIndex = new Map(getNodes().map((n) => [n.id, n]))

        const closest = Object.entries(blocks).reduce<{
          id: string
          type: string
          position: { x: number; y: number }
          distanceSquared: number
        } | null>((acc, [id, block]) => {
          if (!isAutoConnectSourceCandidate(block)) return acc
          const node = nodeIndex.get(id)
          if (!node) return acc

          const blockParentId = blocks[id]?.data?.parentId
          const dropParentId = containerAtPoint?.loopId
          if (dropParentId !== blockParentId) return acc

          const anchor = getNodeAnchorPosition(id)
          const distanceSquared =
            (anchor.x - newNodePosition.x) ** 2 + (anchor.y - newNodePosition.y) ** 2
          if (!acc || distanceSquared < acc.distanceSquared) {
            return {
              id,
              type: block.type,
              position: anchor,
              distanceSquared,
            }
          }
          return acc
        }, null)

        if (!closest) return null

        return {
          id: closest.id,
          type: closest.type,
          position: closest.position,
        }
      },
      [blocks, getNodes, getNodeAnchorPosition, isPointInLoopNode, isAutoConnectSourceCandidate]
    )

    /** Determines the appropriate source handle based on block type. */
    const determineSourceHandle = useCallback((block: { id: string; type: string }) => {
      if (block.type === 'condition') {
        const conditionHandles = document.querySelectorAll(
          `[data-nodeid^="${block.id}"][data-handleid^="condition-"]`
        )
        if (conditionHandles.length > 0) {
          const handleId = conditionHandles[0].getAttribute('data-handleid')
          if (handleId) return handleId
        }
      } else if (block.type === 'router_v2') {
        const routerHandles = document.querySelectorAll(
          `[data-nodeid^="${block.id}"][data-handleid^="router-"]`
        )
        if (routerHandles.length > 0) {
          const handleId = routerHandles[0].getAttribute('data-handleid')
          if (handleId) return handleId
        }
      } else if (block.type === 'loop') {
        return 'loop-end-source'
      } else if (block.type === 'parallel') {
        return 'parallel-end-source'
      }
      return 'source'
    }, [])

    /** Creates a standardized edge object for workflow connections. */
    const createEdgeObject = useCallback(
      (sourceId: string, targetId: string, sourceHandle: string): Edge => {
        const edge = {
          id: generateId(),
          source: sourceId,
          target: targetId,
          sourceHandle,
          targetHandle: 'target',
          type: 'workflowEdge',
        }
        return edge
      },
      []
    )

    /** Gets the appropriate start handle for a container node (loop or parallel). */
    const getContainerStartHandle = useCallback(
      (containerId: string): string => {
        const containerNode = getNodes().find((n) => n.id === containerId)
        return (containerNode?.data as SubflowNodeData)?.kind === 'loop'
          ? 'loop-start-source'
          : 'parallel-start-source'
      },
      [getNodes]
    )

    /** Finds the closest non-response block to a position within a set of blocks. */
    const findClosestBlockInSet = useCallback(
      (
        candidateBlocks: { id: string; type: string; position: { x: number; y: number } }[],
        targetPosition: { x: number; y: number }
      ): { id: string; type: string; position: { x: number; y: number } } | undefined => {
        const closest = candidateBlocks.reduce<{
          id: string
          type: string
          position: { x: number; y: number }
          distanceSquared: number
        } | null>((acc, block) => {
          const blockState = blocks[block.id]
          if (!blockState || !isAutoConnectSourceCandidate(blockState)) return acc
          const distanceSquared =
            (block.position.x - targetPosition.x) ** 2 + (block.position.y - targetPosition.y) ** 2
          if (!acc || distanceSquared < acc.distanceSquared) {
            return { ...block, distanceSquared }
          }
          return acc
        }, null)

        return closest
          ? {
              id: closest.id,
              type: closest.type,
              position: closest.position,
            }
          : undefined
      },
      [blocks, isAutoConnectSourceCandidate]
    )

    /**
     * Attempts to create an auto-connect edge for a new block being added.
     * Returns the edge object if auto-connect should occur, or undefined otherwise.
     *
     * @param position - The position where the new block will be placed
     * @param targetBlockId - The ID of the new block being added
     * @param options - Configuration for auto-connect behavior
     */
    const tryCreateAutoConnectEdge = useCallback(
      (
        position: { x: number; y: number },
        targetBlockId: string,
        options: {
          targetParentId?: string | null
          existingChildBlocks?: { id: string; type: string; position: { x: number; y: number } }[]
          containerId?: string
        }
      ): Edge | undefined => {
        if (!autoConnectRef.current) return undefined

        // Case 1: Adding block inside a container with existing children
        if (options.existingChildBlocks && options.existingChildBlocks.length > 0) {
          const closestBlock = findClosestBlockInSet(options.existingChildBlocks, position)
          if (closestBlock) {
            const sourceHandle = determineSourceHandle({
              id: closestBlock.id,
              type: closestBlock.type,
            })
            return createEdgeObject(closestBlock.id, targetBlockId, sourceHandle)
          }
          return undefined
        }

        // Case 2: Adding block inside an empty container - connect from container start
        if (
          options.containerId &&
          (!options.existingChildBlocks || options.existingChildBlocks.length === 0)
        ) {
          const startHandle = getContainerStartHandle(options.containerId)
          return createEdgeObject(options.containerId, targetBlockId, startHandle)
        }

        // Case 3: Adding block at root level - use findClosestOutput
        const closestBlock = findClosestOutput(position)
        if (!closestBlock) return undefined

        // Don't create cross-container edges
        const closestBlockParentId = blocks[closestBlock.id]?.data?.parentId
        if (closestBlockParentId && !options.targetParentId) {
          return undefined
        }

        const sourceHandle = determineSourceHandle(closestBlock)
        return createEdgeObject(closestBlock.id, targetBlockId, sourceHandle)
      },
      [
        blocks,
        findClosestOutput,
        determineSourceHandle,
        createEdgeObject,
        getContainerStartHandle,
        findClosestBlockInSet,
      ]
    )

    /**
     * Checks if adding a block would violate constraints (triggers or single-instance blocks)
     * and shows notification if so.
     * @returns true if validation failed (caller should return early), false if ok to proceed
     */
    const checkTriggerConstraints = useCallback(
      (blockType: string): boolean => {
        const triggerIssue = TriggerUtils.getTriggerAdditionIssue(blocks, blockType)
        if (triggerIssue) {
          const message =
            triggerIssue.issue === 'legacy'
              ? 'Cannot add new trigger blocks when a legacy Start block exists. Available in newer workflows.'
              : `A workflow can only have one ${triggerIssue.triggerName} trigger block. Please remove the existing one before adding a new one.`
          addNotification({
            level: 'error',
            message,
            workflowId: activeWorkflowId || undefined,
          })
          return true
        }

        const singleInstanceIssue = TriggerUtils.getSingleInstanceBlockIssue(blocks, blockType)
        if (singleInstanceIssue) {
          addNotification({
            level: 'error',
            message: `A workflow can only have one ${singleInstanceIssue.blockName} block. Please remove the existing one before adding a new one.`,
            workflowId: activeWorkflowId || undefined,
          })
          return true
        }

        return false
      },
      [blocks, addNotification, activeWorkflowId]
    )

    /**
     * Adds a pure canvas content node at the requested workflow position.
     */
    const addContentNodeAtPosition = useCallback(
      async (presetId: ContentNodePresetId, position: { x: number; y: number }) => {
        const preset = getContentNodePreset(presetId)

        if (!preset?.available || !preset.blockType || !preset.contentVariant) {
          addNotification({
            level: 'info',
            message: 'Image editor node is not available yet. Use an Image node for now.',
            workflowId: activeWorkflowId || undefined,
          })
          return
        }

        const blockConfig = getBlockConfigFromCatalog(preset.blockType)
        if (!blockConfig) {
          logger.error('Invalid content node block type', {
            presetId,
            blockType: preset.blockType,
          })
          return
        }

        const id = generateId()
        const name = getUniqueBlockName(preset.label, blocks)

        addBlock(
          id,
          preset.blockType,
          name,
          position,
          {
            contentVariant: preset.contentVariant,
          },
          undefined,
          undefined,
          undefined,
          false,
          preset.presetSubBlockValues,
          blockConfig
        )
      },
      [activeWorkflowId, addBlock, addNotification, blocks]
    )

    const handleContextAddContentNode = useCallback(
      (presetId: ContentNodePresetId) => {
        const flowPosition = screenToFlowPosition(contextMenuPosition)
        void addContentNodeAtPosition(presetId, flowPosition)
      },
      [addContentNodeAtPosition, contextMenuPosition, screenToFlowPosition]
    )

    /**
     * Shared handler for drops of toolbar items onto the workflow canvas.
     *
     * This encapsulates the full drop behavior (container handling, auto-connect,
     * trigger constraints, etc.) so it can be reused both for direct ReactFlow
     * drops and for drops forwarded from the empty-workflow command list overlay.
     *
     * @param data - Drag data from the toolbar (type + optional trigger mode).
     * @param position - Drop position in ReactFlow coordinates.
     */
    const handleToolbarDrop = useCallback(
      async (
        data: { type: string; enableTriggerMode?: boolean },
        position: { x: number; y: number }
      ) => {
        if (!data.type || data.type === 'connectionBlock') return

        try {
          const containerInfo = isPointInLoopNode(position)

          resetDragHighlights()

          if (data.type === 'loop' || data.type === 'parallel') {
            const id = generateId()
            const baseName = data.type === 'loop' ? 'Loop' : 'Parallel'
            const name = getUniqueBlockName(baseName, blocks)

            if (containerInfo) {
              const rawPosition = {
                x: position.x - containerInfo.loopPosition.x,
                y: position.y - containerInfo.loopPosition.y,
              }

              const relativePosition = clampPositionToContainer(
                rawPosition,
                containerInfo.dimensions,
                {
                  width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
                  height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
                }
              )

              const existingChildBlocks = Object.values(blocks)
                .filter((b) => b.data?.parentId === containerInfo.loopId)
                .map((b) => ({ id: b.id, type: b.type, position: b.position }))

              const autoConnectEdge = tryCreateAutoConnectEdge(relativePosition, id, {
                targetParentId: containerInfo.loopId,
                existingChildBlocks,
                containerId: containerInfo.loopId,
              })

              addBlock(
                id,
                data.type,
                name,
                relativePosition,
                {
                  width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
                  height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
                  type: 'subflowNode',
                  parentId: containerInfo.loopId,
                  extent: 'parent',
                },
                containerInfo.loopId,
                'parent',
                autoConnectEdge
              )

              resizeLoopNodesWrapper()
            } else {
              const autoConnectEdge = tryCreateAutoConnectEdge(position, id, {
                targetParentId: null,
              })

              addBlock(
                id,
                data.type,
                name,
                position,
                {
                  width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
                  height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
                  type: 'subflowNode',
                },
                undefined,
                undefined,
                autoConnectEdge
              )
            }

            return
          }

          // Validate block config for regular blocks
          const blockConfig = getBlockConfigFromCatalog(data.type)
          if (!blockConfig) {
            logger.error('Invalid block type:', { data })
            return
          }

          // Generate id and name here so they're available in all code paths
          const id = generateId()
          // Prefer semantic default names for triggers; then ensure unique numbering centrally
          const defaultTriggerNameDrop = TriggerUtils.getDefaultTriggerName(data.type)
          const baseName = defaultTriggerNameDrop || blockConfig.name
          const name = getUniqueBlockName(baseName, blocks)

          if (containerInfo) {
            // Check if this is a trigger block or has trigger mode enabled
            const isTriggerBlock =
              blockConfig.category === 'triggers' ||
              blockConfig.triggers?.enabled ||
              data.enableTriggerMode === true

            if (isTriggerBlock) {
              addNotification({
                level: 'error',
                message: 'Triggers cannot be placed inside loop or parallel subflows.',
                workflowId: activeWorkflowId || undefined,
              })
              return
            }

            // Calculate raw position relative to container origin
            const rawPosition = {
              x: position.x - containerInfo.loopPosition.x,
              y: position.y - containerInfo.loopPosition.y,
            }

            // Clamp position to keep block inside container's content area
            const relativePosition = clampPositionToContainer(
              rawPosition,
              containerInfo.dimensions,
              estimateBlockDimensions(data.type)
            )

            // Capture existing child blocks for auto-connect
            const existingChildBlocks = Object.values(blocks)
              .filter((b) => b.data?.parentId === containerInfo.loopId)
              .map((b) => ({ id: b.id, type: b.type, position: b.position }))

            const autoConnectEdge = tryCreateAutoConnectEdge(relativePosition, id, {
              targetParentId: containerInfo.loopId,
              existingChildBlocks,
              containerId: containerInfo.loopId,
            })

            // Add block with parent info AND autoConnectEdge (atomic operation)
            addBlock(
              id,
              data.type,
              name,
              relativePosition,
              {
                parentId: containerInfo.loopId,
                extent: 'parent',
              },
              containerInfo.loopId,
              'parent',
              autoConnectEdge,
              undefined,
              undefined,
              blockConfig
            )

            // Resize the container node to fit the new block
            // Immediate resize without delay
            resizeLoopNodesWrapper()
          } else {
            // Centralized trigger constraints
            if (checkTriggerConstraints(data.type)) return

            const autoConnectEdge = tryCreateAutoConnectEdge(position, id, {
              targetParentId: null,
            })

            // Regular canvas drop with auto-connect edge
            // Use enableTriggerMode from drag data if present (when dragging from Triggers tab)
            const enableTriggerMode = data.enableTriggerMode || false
            addBlock(
              id,
              data.type,
              name,
              position,
              undefined,
              undefined,
              undefined,
              autoConnectEdge,
              enableTriggerMode,
              undefined,
              blockConfig
            )
          }
        } catch (err) {
          logger.error('Error handling toolbar drop on workflow canvas', { err })
        }
      },
      [
        blocks,
        isPointInLoopNode,
        resizeLoopNodesWrapper,
        addBlock,
        addNotification,
        activeWorkflowId,
        tryCreateAutoConnectEdge,
        checkTriggerConstraints,
      ]
    )

    /** Handles toolbar block click events to add blocks to the canvas. */
    useEffect(() => {
      const handleAddBlockFromToolbar = async (event: Event) => {
        // Check if user has permission to interact with blocks
        if (!effectivePermissions.canEdit) {
          return
        }

        const customEvent = event as CustomEvent<{
          type?: string
          enableTriggerMode?: boolean
          presetOperation?: string
        }>
        const { type, enableTriggerMode, presetOperation } = customEvent.detail ?? {}

        if (!type) return
        if (type === 'connectionBlock') return

        const basePosition = getViewportCenter()

        if (type === 'loop' || type === 'parallel') {
          const id = generateId()
          const baseName = type === 'loop' ? 'Loop' : 'Parallel'
          const name = getUniqueBlockName(baseName, blocks)

          const autoConnectEdge = tryCreateAutoConnectEdge(basePosition, id, {
            targetParentId: null,
          })

          addBlock(
            id,
            type,
            name,
            basePosition,
            {
              width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
              height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
              type: 'subflowNode',
            },
            undefined,
            undefined,
            autoConnectEdge
          )

          return
        }

        const blockConfig = getBlockConfigFromCatalog(type)
        if (!blockConfig) {
          logger.error('Invalid block type:', { type })
          return
        }

        if (checkTriggerConstraints(type)) return

        const id = generateId()
        const defaultTriggerName = TriggerUtils.getDefaultTriggerName(type)
        const baseName = defaultTriggerName || blockConfig.name
        const name = getUniqueBlockName(baseName, blocks)

        const autoConnectEdge = tryCreateAutoConnectEdge(basePosition, id, {
          targetParentId: null,
        })

        addBlock(
          id,
          type,
          name,
          basePosition,
          undefined,
          undefined,
          undefined,
          autoConnectEdge,
          enableTriggerMode,
          presetOperation ? { operation: presetOperation } : undefined,
          blockConfig
        )
      }

      window.addEventListener('add-block-from-toolbar', handleAddBlockFromToolbar)

      return () => {
        window.removeEventListener('add-block-from-toolbar', handleAddBlockFromToolbar)
      }
    }, [
      getViewportCenter,
      blocks,
      addBlock,
      effectivePermissions.canEdit,
      checkTriggerConstraints,
      tryCreateAutoConnectEdge,
    ])

    /**
     * Listen for product-facing content node insertions from canvas-first entry points.
     */
    useEffect(() => {
      const handleAddContentNode = (event: CustomEvent<{ presetId?: ContentNodePresetId }>) => {
        if (!effectivePermissions.canEdit) {
          return
        }

        const presetId = event.detail?.presetId
        if (!presetId) {
          return
        }

        void addContentNodeAtPosition(presetId, getViewportCenter())
      }

      window.addEventListener('add-content-node', handleAddContentNode as EventListener)

      return () => {
        window.removeEventListener('add-content-node', handleAddContentNode as EventListener)
      }
    }, [addContentNodeAtPosition, effectivePermissions.canEdit, getViewportCenter])

    /**
     * Listen for toolbar drops that occur on the empty-workflow overlay (command list).
     *
     * The overlay forwards drop events with the cursor position; this handler
     * computes the corresponding ReactFlow coordinates and delegates to
     * `handleToolbarDrop` so the behavior matches native canvas drops.
     */
    useEffect(() => {
      const handleOverlayToolbarDrop = (event: Event) => {
        const customEvent = event as CustomEvent<{
          type: string
          enableTriggerMode?: boolean
          clientX: number
          clientY: number
        }>

        const detail = customEvent.detail
        if (!detail?.type) return

        try {
          const canvasElement = document.querySelector('.workflow-container') as HTMLElement | null
          if (!canvasElement) {
            logger.warn('Workflow canvas element not found for overlay toolbar drop')
            return
          }

          const bounds = canvasElement.getBoundingClientRect()
          const position = screenToFlowPosition({
            x: detail.clientX - bounds.left,
            y: detail.clientY - bounds.top,
          })

          void handleToolbarDrop(
            {
              type: detail.type,
              enableTriggerMode: detail.enableTriggerMode ?? false,
            },
            position
          )
        } catch (err) {
          logger.error('Error handling toolbar drop from empty-workflow overlay', { err })
        }
      }

      window.addEventListener(
        'toolbar-drop-on-empty-workflow-overlay',
        handleOverlayToolbarDrop as EventListener
      )

      return () =>
        window.removeEventListener(
          'toolbar-drop-on-empty-workflow-overlay',
          handleOverlayToolbarDrop as EventListener
        )
    }, [screenToFlowPosition, handleToolbarDrop])

    /** Tracks blocks to pan to after diff updates. */
    const pendingZoomBlockIdsRef = useRef<Set<string> | null>(null)
    const seenDiffBlocksRef = useRef<Set<string>>(new Set())

    /** Queues newly changed blocks for viewport panning. */
    useEffect(() => {
      if (!isDiffReady || !diffAnalysis) {
        pendingZoomBlockIdsRef.current = null
        seenDiffBlocksRef.current.clear()
        return
      }

      const newBlocks = new Set<string>()
      const allBlocks = [...(diffAnalysis.new_blocks || []), ...(diffAnalysis.edited_blocks || [])]

      for (const id of allBlocks) {
        if (!seenDiffBlocksRef.current.has(id)) {
          newBlocks.add(id)
        }
        seenDiffBlocksRef.current.add(id)
      }

      if (newBlocks.size > 0) {
        pendingZoomBlockIdsRef.current = newBlocks
      }
    }, [isDiffReady, diffAnalysis])

    /** Displays trigger warning notifications. */
    useEffect(() => {
      const handleShowTriggerWarning = (event: CustomEvent) => {
        const { type, triggerName } = event.detail
        const message =
          type === 'trigger_in_subflow'
            ? 'Triggers cannot be placed inside loop or parallel subflows.'
            : type === 'legacy_incompatibility'
              ? 'Cannot add new trigger blocks when a legacy Start block exists. Available in newer workflows.'
              : `A workflow can only have one ${triggerName || 'trigger'} trigger block. Please remove the existing one before adding a new one.`
        addNotification({
          level: 'error',
          message,
          workflowId: activeWorkflowId || undefined,
        })
      }

      window.addEventListener('show-trigger-warning', handleShowTriggerWarning as EventListener)

      return () => {
        window.removeEventListener(
          'show-trigger-warning',
          handleShowTriggerWarning as EventListener
        )
      }
    }, [addNotification, activeWorkflowId])

    /** Handles drop events on the ReactFlow canvas. */
    const onDrop = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault()

        try {
          const raw = event.dataTransfer.getData('application/json')
          if (!raw) return
          const data = JSON.parse(raw)
          if (!data?.type) return

          const reactFlowBounds = event.currentTarget.getBoundingClientRect()
          const position = screenToFlowPosition({
            x: event.clientX - reactFlowBounds.left,
            y: event.clientY - reactFlowBounds.top,
          })

          void handleToolbarDrop(
            {
              type: data.type,
              enableTriggerMode: data.enableTriggerMode ?? false,
            },
            position
          )
        } catch (err) {
          logger.error('Error dropping block on ReactFlow canvas:', { err })
        }
      },
      [screenToFlowPosition, handleToolbarDrop]
    )

    const onDropLocked = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault()
        if (!event.dataTransfer?.types.includes('application/json')) return
        const message = effectivePermissions.canAdmin
          ? 'Unlock the workflow to add blocks.'
          : 'This workflow is locked. Ask an admin to unlock it.'
        addNotification({ level: 'info', message, workflowId: activeWorkflowId || undefined })
      },
      [effectivePermissions.canAdmin, addNotification, activeWorkflowId]
    )

    const handleCanvasPointerMove = useCallback(
      (event: React.PointerEvent<Element>) => {
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        })

        emitCursorUpdate(position)
      },
      [screenToFlowPosition, emitCursorUpdate]
    )

    const handleCanvasPointerLeave = useCallback(() => {
      emitCursorUpdate(null)
    }, [emitCursorUpdate])

    useEffect(() => {
      return () => {
        emitCursorUpdate(null)
      }
    }, [emitCursorUpdate])

    /** Handles drag over events for container node highlighting. */
    const onDragOver = useCallback(
      (event: React.DragEvent) => {
        event.preventDefault()

        // Only handle toolbar items
        if (!event.dataTransfer?.types.includes('application/json')) return

        try {
          const reactFlowBounds = event.currentTarget.getBoundingClientRect()
          const position = screenToFlowPosition({
            x: event.clientX - reactFlowBounds.left,
            y: event.clientY - reactFlowBounds.top,
          })

          // Check if hovering over a container node
          const containerInfo = isPointInLoopNode(position)

          // Highlight container if hovering over it

          if (containerInfo) {
            const containerNode = getNodes().find((n) => n.id === containerInfo.loopId)
            if (containerNode?.type === 'subflowNode') {
              const kind = (containerNode.data as SubflowNodeData)?.kind
              if (kind === 'loop' || kind === 'parallel') {
                highlightContainerNode(containerInfo.loopId, kind)
              }
            }
          } else {
            resetDragHighlights()
          }
        } catch (err) {
          logger.error('Error in onDragOver', { err })
        }
      },
      [
        screenToFlowPosition,
        isPointInLoopNode,
        getNodes,
        highlightContainerNode,
        resetDragHighlights,
      ]
    )

    const loadingWorkflowRef = useRef<string | null>(null)
    const currentWorkflowExists =
      shouldSkipWorkflowMap ||
      (!isWorkflowMapPlaceholderData && Boolean(workflows[workflowIdParam]))

    useEffect(() => {
      // In sandbox mode the stores are pre-hydrated externally; skip the API load.
      if (sandbox) return

      const currentId = workflowIdParam
      // Wait for workflow data to be available before attempting to load
      if (
        isWorkflowMapLoading ||
        isWorkflowMapPlaceholderData ||
        !currentId ||
        !currentWorkflowExists ||
        !hydration.workspaceId ||
        hydration.workspaceId !== workspaceId
      ) {
        return
      }

      // Prevent duplicate loads - if we're already loading this workflow, skip
      if (loadingWorkflowRef.current === currentId) {
        return
      }

      if (hydration.phase === 'creating') {
        return
      }

      // If already loading (state-loading phase), skip
      if (hydration.phase === 'state-loading' && hydration.workflowId === currentId) {
        return
      }

      // Check if we encountered an error loading this specific workflow to prevent infinite retries
      const hasLoadError = hydration.phase === 'error' && hydration.workflowId === currentId

      // Check if we need to load the workflow state:
      // 1. Different workflow than currently active
      // 2. Same workflow but hydration phase is not 'ready' (e.g., after a quick refresh)
      const needsWorkflowLoad =
        !hasLoadError &&
        (activeWorkflowId !== currentId ||
          (activeWorkflowId === currentId && hydration.phase !== 'ready'))

      if (needsWorkflowLoad) {
        // Mark this workflow as being loaded to prevent duplicate calls
        loadingWorkflowRef.current = currentId

        const { clearDiff } = useWorkflowDiffStore.getState()
        clearDiff()

        // Reset canvas ready state when loading a new workflow
        setIsCanvasReady(false)

        setActiveWorkflow(currentId)
          .catch((error) => {
            logger.error(`Failed to set active workflow ${currentId}:`, error)
          })
          .finally(() => {
            // Clear the loading ref when done (success or error)
            if (loadingWorkflowRef.current === currentId) {
              loadingWorkflowRef.current = null
            }
          })
      }
    }, [
      workflowIdParam,
      shouldSkipWorkflowMap,
      isWorkflowMapLoading,
      isWorkflowMapPlaceholderData,
      currentWorkflowExists,
      activeWorkflowId,
      setActiveWorkflow,
      hydration.phase,
      hydration.workflowId,
      hydration.workspaceId,
      workspaceId,
    ])

    useWorkspaceEnvironment(sandbox ? '' : lowMemoryWorkspaceId)

    const workflowCount = useMemo(
      () => (shouldSkipWorkflowMap && workflowIdParam ? 1 : Object.keys(workflows).length),
      [shouldSkipWorkflowMap, workflowIdParam, workflows]
    )
    const workspaceWorkflowIds = useMemo(
      () =>
        shouldSkipWorkflowMap
          ? workflowIdParam
            ? [workflowIdParam]
            : []
          : Object.entries(workflows)
              .filter(([, workflow]) => workflow.workspaceId === workspaceId)
              .map(([id]) => id),
      [shouldSkipWorkflowMap, workflowIdParam, workflows, workspaceId]
    )
    const missingWorkflowRedirectRef = useRef<string | null>(null)

    /** Handles navigation validation and redirects for invalid workflow IDs. */
    useEffect(() => {
      if (embedded || sandbox || shouldSkipWorkflowMap) return

      if (
        isWorkflowMapLoading ||
        isWorkflowMapPlaceholderData ||
        !hydration.workspaceId ||
        hydration.workspaceId !== workspaceId
      ) {
        return
      }

      if (hydration.phase === 'creating') {
        return
      }

      // If no workflows exist after loading, redirect to workspace root
      if (workflowCount === 0) {
        logger.info('No workflows found, redirecting to workspace root')
        router.replace(`/workspace/${workspaceId}/w`)
        return
      }

      // Navigate to existing workflow or first available
      if (!currentWorkflowExists) {
        if (!workflowIdParam || missingWorkflowRedirectRef.current === workflowIdParam) {
          return
        }

        missingWorkflowRedirectRef.current = workflowIdParam

        logger.info(`Workflow ${workflowIdParam} not found locally, probing safe redirect target`)

        void (async () => {
          let redirectPath = getWorkflowEditorRedirectPath({
            workflowId: workflowIdParam,
            fallbackWorkspaceId: workspaceId,
            workflow: null,
            workspaceWorkflowIds,
          })

          try {
            const workflowResponse = await requestJson(getWorkflowStateContract, {
              params: { id: workflowIdParam },
            })

            redirectPath = getWorkflowEditorRedirectPath({
              workflowId: workflowIdParam,
              fallbackWorkspaceId: workspaceId,
              workflow: workflowResponse.data,
              workspaceWorkflowIds,
            })
          } catch (error) {
            logger.info(`Workflow ${workflowIdParam} probe fell back to local redirect`, { error })
          }

          router.replace(redirectPath)
        })()
        return
      }

      missingWorkflowRedirectRef.current = null

      // Validate that the current workflow belongs to the current workspace
      const workflowData = workflows[workflowIdParam]
      if (workflowData && workflowData.workspaceId !== workspaceId) {
        logger.warn(
          `Workflow ${workflowIdParam} belongs to workspace ${workflowData.workspaceId}, not ${workspaceId}`
        )
        // Redirect to the correct workspace for this workflow
        router.replace(`/workspace/${workflowData.workspaceId}/w/${workflowIdParam}`)
      }
    }, [
      embedded,
      shouldSkipWorkflowMap,
      workflowIdParam,
      isWorkflowMapLoading,
      isWorkflowMapPlaceholderData,
      currentWorkflowExists,
      workflowCount,
      workspaceWorkflowIds,
      hydration.phase,
      hydration.workspaceId,
      workspaceId,
      router,
      workflows,
    ])

    const getBlockConfig = useCallback(
      (type: string) => {
        return blockConfigs[resolveCatalogBlockType(type)]
      },
      [blockConfigs]
    )

    const prevBlocksHashRef = useRef<string>('')
    const prevBlocksRef = useRef(blocks)

    /** Stable hash of block STRUCTURAL properties - excludes position to prevent node recreation during drag. */
    const blocksStructureHash = useMemo(() => {
      // Only recalculate hash if blocks reference actually changed
      if (prevBlocksRef.current === blocks) {
        return prevBlocksHashRef.current
      }

      prevBlocksRef.current = blocks
      // Hash only structural properties - NOT position (position changes shouldn't recreate nodes)
      const hash = Object.values(blocks)
        .map((b) => {
          const width = typeof b.data?.width === 'number' ? b.data.width : ''
          const height = typeof b.data?.height === 'number' ? b.data.height : ''
          // Exclude position from hash - drag should not recreate nodes
          return `${b.id}:${b.type}:${b.name}:${b.height}:${b.data?.parentId || ''}:${width}:${height}`
        })
        .join('|')

      prevBlocksHashRef.current = hash
      return hash
    }, [blocks])

    /** Transforms blocks into ReactFlow nodes - only recreates on structural changes. */
    const derivedNodes = useMemo(() => {
      const nodeArray: Node[] = []

      // Add block nodes
      Object.entries(blocks).forEach(([, block]) => {
        if (!block || !block.type || !block.name) {
          return
        }

        // Handle container nodes differently
        if (block.type === 'loop' || block.type === 'parallel') {
          // Compute nesting depth so children always render above parents
          let depth = 0
          let pid = block.data?.parentId as string | undefined
          while (pid && depth < 100) {
            depth++
            pid = blocks[pid]?.data?.parentId as string | undefined
          }
          nodeArray.push({
            id: block.id,
            type: 'subflowNode',
            position: block.position,
            parentId: block.data?.parentId,
            extent: block.data?.extent || undefined,
            dragHandle: '.workflow-drag-handle',
            draggable:
              !(workflowReadOnly || workflowTrackReadOnly) && !isBlockProtected(block.id, blocks),
            zIndex: depth,
            className: block.data?.parentId ? 'nested-subflow-node' : undefined,
            data: {
              ...block.data,
              name: block.name,
              width: block.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
              height: block.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
              kind: block.type === 'loop' ? 'loop' : 'parallel',
              isWorkflowLocked: workflowReadOnly || workflowTrackReadOnly,
            },
          })
          return
        }

        const blockConfig = getBlockConfig(block.type)
        if (!blockConfig) {
          logger.error(`No configuration found for block type: ${block.type}`, {
            block,
          })
          return
        }

        const position = block.position

        const isActive = activeBlockIds.has(block.id)
        const isPending = isDebugging && pendingBlocks.includes(block.id)

        // Both note blocks and workflow blocks use deterministic dimensions
        const nodeType = getCanvasNodeType(block.type)
        const dragHandle = getCanvasNodeDragHandle(block.type)

        // Compute zIndex for blocks inside containers so they render above the
        // parent subflow's interactive body area (which needs pointer-events for
        // click-to-select). Container nodes use zIndex: depth (0, 1, 2...),
        // so child blocks use a baseline that is always above any container.
        const childZIndex = block.data?.parentId ? 1000 : undefined

        // Create stable node object - React Flow will handle shallow comparison
        nodeArray.push({
          id: block.id,
          type: nodeType,
          position,
          parentId: block.data?.parentId,
          dragHandle,
          draggable:
            !(workflowReadOnly || workflowTrackReadOnly) && !isBlockProtected(block.id, blocks),
          ...(childZIndex !== undefined && { zIndex: childZIndex }),
          extent: (() => {
            // Clamp children to subflow body (exclude header)
            const parentId = block.data?.parentId as string | undefined
            if (!parentId) return block.data?.extent || undefined

            // Constrain ONLY the top by header height (42px) and keep a small left padding.
            // Do not clamp right/bottom so blocks can move freely within the body.
            const headerHeight = 42
            const leftPadding = 16
            const minX = leftPadding
            const minY = headerHeight
            const maxX = Number.POSITIVE_INFINITY
            const maxY = Number.POSITIVE_INFINITY

            return [
              [minX, minY],
              [maxX, maxY],
            ] as [[number, number], [number, number]]
          })(),
          data: {
            type: block.type,
            config: blockConfig, // Cached config reference
            name: block.name,
            contentVariant:
              typeof block.data?.contentVariant === 'string'
                ? block.data.contentVariant
                : undefined,
            isActive,
            isPending,
            ...(embedded && { isEmbedded: true }),
            ...(sandbox && { isSandbox: true }),
            isWorkflowLocked: workflowReadOnly || workflowTrackReadOnly,
          },
          // Include dynamic dimensions for container resizing calculations (must match rendered size)
          // Both note and workflow blocks calculate dimensions deterministically via useBlockDimensions
          // Use estimated dimensions for blocks without measured height to ensure selection bounds are correct
          width:
            block.layout?.measuredWidth ??
            (typeof block.data?.width === 'number'
              ? block.data.width
              : BLOCK_DIMENSIONS.FIXED_WIDTH),
          height: block.height
            ? Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT)
            : estimateBlockDimensions(block.type).height,
        })
      })

      return nodeArray
    }, [
      blocksStructureHash,
      blocks,
      activeBlockIds,
      pendingBlocks,
      isDebugging,
      getBlockConfig,
      sandbox,
      embedded,
      workflowReadOnly,
      workflowTrackReadOnly,
    ])

    // Local state for nodes - allows smooth drag without store updates on every frame
    const [displayNodes, setDisplayNodes] = useState<Node[]>([])
    const [lastInteractedNodeId, setLastInteractedNodeId] = useState<string | null>(null)

    const selectedNodeIds = useMemo(
      () => displayNodes.filter((node) => node.selected).map((node) => node.id),
      [displayNodes]
    )
    const selectedNodeIdsKey = selectedNodeIds.join(',')

    useEffect(() => {
      syncPanelWithSelection(selectedNodeIds)
    }, [selectedNodeIdsKey])

    const contentCanvasSelectionWorkflowIdRef = useRef<string | null>(null)
    useEffect(() => {
      const previousWorkflowId = contentCanvasSelectionWorkflowIdRef.current
      if (previousWorkflowId && previousWorkflowId !== activeWorkflowId) {
        useContentCanvasSelectionStore.getState().clearSelection(previousWorkflowId)
      }
      contentCanvasSelectionWorkflowIdRef.current = activeWorkflowId
    }, [activeWorkflowId])

    useEffect(() => {
      if (!activeWorkflowId) return
      useContentCanvasSelectionStore.getState().setSelection(activeWorkflowId, selectedNodeIds)
    }, [activeWorkflowId, selectedNodeIdsKey, selectedNodeIds])

    useEffect(
      () => () => {
        const workflowId = contentCanvasSelectionWorkflowIdRef.current
        if (workflowId) {
          useContentCanvasSelectionStore.getState().clearSelection(workflowId)
        }
      },
      []
    )

    // Keep the most recently selected block on top even after deselection, so a
    // dragged block doesn't suddenly drop behind other overlapping blocks.
    useEffect(() => {
      if (selectedNodeIds.length > 0) {
        setLastInteractedNodeId(selectedNodeIds[selectedNodeIds.length - 1])
      }
    }, [selectedNodeIdsKey])

    useEffect(() => {
      // Check for pending selection (from paste/duplicate), otherwise preserve existing selection
      if (pendingSelection && pendingSelection.length > 0) {
        const pendingSet = new Set(pendingSelection)
        clearPendingSelection()

        // Apply pending selection and resolve parent-child conflicts
        const withSelection = derivedNodes.map((node) => ({
          ...node,
          selected: pendingSet.has(node.id),
        }))
        const resolved = resolveSelectionConflicts(withSelection, blocks)
        setDisplayNodes(resolved)
        return
      }

      // Preserve existing selection state
      setDisplayNodes((currentNodes) => {
        const selectedIds = new Set(currentNodes.filter((n) => n.selected).map((n) => n.id))
        return derivedNodes.map((node) => ({
          ...node,
          selected: selectedIds.has(node.id),
        }))
      })
    }, [derivedNodes, blocks, pendingSelection, clearPendingSelection])

    useEffect(() => {
      if (!isWorkflowReady) return
      if (getDragStartPosition() !== null || multiNodeDragStartRef.current.size > 0) return
      setDisplayNodes((currentNodes) => reconcileDisplayNodePositions(currentNodes, blocks))
    }, [blocks, getDragStartPosition, isWorkflowReady])

    /** Pans viewport to pending blocks once they have valid dimensions. */
    useEffect(() => {
      const pendingBlockIds = pendingZoomBlockIdsRef.current
      if (!pendingBlockIds || pendingBlockIds.size === 0) return

      const pendingNodes = displayNodes.filter((node) => pendingBlockIds.has(node.id))
      const allNodesReady =
        pendingNodes.length === pendingBlockIds.size &&
        pendingNodes.every(
          (node) =>
            typeof node.width === 'number' &&
            typeof node.height === 'number' &&
            node.width > 0 &&
            node.height > 0
        )

      if (allNodesReady) {
        logger.info('Focusing on changed blocks', {
          changedBlockIds: Array.from(pendingBlockIds),
          foundNodes: pendingNodes.length,
        })
        pendingZoomBlockIdsRef.current = null

        const nodesWithAbsolutePositions = pendingNodes.map((node) => ({
          ...node,
          position: getNodeAbsolutePosition(node.id),
        }))

        requestAnimationFrame(() => {
          fitViewToBounds({
            nodes: nodesWithAbsolutePositions,
            duration: 600,
            padding: 0.1,
            minZoom: 0.5,
            maxZoom: 1.0,
          })
        })
      }
    }, [displayNodes, fitViewToBounds, getNodeAbsolutePosition])

    /** Handles ActionBar remove-from-subflow events. */
    useEffect(() => {
      const handleRemoveFromSubflow = (event: Event) => {
        const customEvent = event as CustomEvent<{ blockIds: string[] }>
        const blockIds = customEvent.detail?.blockIds
        if (!blockIds || blockIds.length === 0) return

        try {
          const validBlockIds = blockIds.filter((id) => {
            const block = blocks[id]
            return block?.data?.parentId
          })
          if (validBlockIds.length === 0) return

          const validBlockIdSet = new Set(validBlockIds)
          const descendantIds = getDescendantBlockIds(validBlockIds, blocks)
          const movingNodeIds = new Set([...validBlockIds, ...descendantIds])

          // Find boundary edges (one end inside the subtree, one end outside)
          const boundaryEdges = edgesForDisplay.filter((e) => {
            const sourceInSelection = movingNodeIds.has(e.source)
            const targetInSelection = movingNodeIds.has(e.target)
            return sourceInSelection !== targetInSelection
          })

          // Attribute each boundary edge to the validBlockId that is the ancestor of the moved endpoint
          const boundaryEdgesByNode = new Map<string, Edge[]>()
          for (const edge of boundaryEdges) {
            const movedEnd = movingNodeIds.has(edge.source) ? edge.source : edge.target
            let id: string | undefined = movedEnd
            const seen = new Set<string>()
            while (id) {
              if (seen.has(id)) break
              seen.add(id)
              if (validBlockIdSet.has(id)) {
                const list = boundaryEdgesByNode.get(id) ?? []
                list.push(edge)
                boundaryEdgesByNode.set(id, list)
                break
              }
              id = blocks[id]?.data?.parentId
            }
          }

          // Collect absolute positions BEFORE any mutations
          const absolutePositions = new Map<string, { x: number; y: number }>()
          for (const blockId of validBlockIds) {
            absolutePositions.set(blockId, getNodeAbsolutePosition(blockId))
          }

          // Build batch update with all blocks and their affected edges
          const updates = validBlockIds.map((blockId) => {
            const absolutePosition = absolutePositions.get(blockId)!
            const edgesForThisNode = boundaryEdgesByNode.get(blockId) ?? []
            return {
              blockId,
              newParentId: null,
              newPosition: absolutePosition,
              affectedEdges: edgesForThisNode,
            }
          })

          // Single atomic batch update (handles edge removal + parent update + undo/redo)
          collaborativeBatchUpdateParent(updates)

          // Update displayNodes once to prevent React Flow from using stale parent data
          setDisplayNodes((nodes) =>
            nodes.map((n) => {
              const absPos = absolutePositions.get(n.id)
              if (absPos) {
                return {
                  ...n,
                  position: absPos,
                  parentId: undefined,
                  extent: undefined,
                }
              }
              return n
            })
          )

          // Note: Container resize happens automatically via the derivedNodes effect
        } catch (err) {
          logger.error('Failed to remove from subflow', { err })
        }
      }

      window.addEventListener('remove-from-subflow', handleRemoveFromSubflow as EventListener)
      return () =>
        window.removeEventListener('remove-from-subflow', handleRemoveFromSubflow as EventListener)
    }, [blocks, edgesForDisplay, getNodeAbsolutePosition, collaborativeBatchUpdateParent])

    useEffect(() => {
      const handleToggleWorkflowLock = (e: CustomEvent<{ blockIds: string[] }>) => {
        collaborativeBatchToggleLocked(e.detail.blockIds)
      }

      window.addEventListener('toggle-workflow-lock', handleToggleWorkflowLock as EventListener)
      return () =>
        window.removeEventListener(
          'toggle-workflow-lock',
          handleToggleWorkflowLock as EventListener
        )
    }, [collaborativeBatchToggleLocked])

    /**
     * Updates container dimensions in displayNodes during drag or keyboard movement.
     * Resizes the moved node's immediate parent and all ancestor containers (for nested loops/parallels).
     */
    const updateContainerDimensionsDuringMove = useCallback(
      (movedNodeId: string, movedNodePosition: { x: number; y: number }) => {
        const ancestorIds: string[] = []
        const visited = new Set<string>()
        let currentId = blocks[movedNodeId]?.data?.parentId
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId)
          ancestorIds.push(currentId)
          currentId = blocks[currentId]?.data?.parentId
        }
        if (ancestorIds.length === 0) return

        setDisplayNodes((currentNodes) => {
          const computedDimensions = new Map<string, { width: number; height: number }>()

          for (const containerId of ancestorIds) {
            const childNodes = currentNodes.filter((n) => n.parentId === containerId)
            if (childNodes.length === 0) continue

            const childPositions = childNodes.map((node) => {
              const nodePosition = node.id === movedNodeId ? movedNodePosition : node.position
              const dims = computedDimensions.get(node.id)
              const width = dims?.width ?? node.data?.width ?? getBlockDimensions(node.id).width
              const height = dims?.height ?? node.data?.height ?? getBlockDimensions(node.id).height
              return { x: nodePosition.x, y: nodePosition.y, width, height }
            })

            computedDimensions.set(containerId, calculateContainerDimensions(childPositions))
          }

          return currentNodes.map((node) => {
            const newDims = computedDimensions.get(node.id)
            if (!newDims) return node
            const currentWidth = node.data?.width ?? CONTAINER_DIMENSIONS.DEFAULT_WIDTH
            const currentHeight = node.data?.height ?? CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
            if (newDims.width === currentWidth && newDims.height === currentHeight) {
              return node
            }
            return {
              ...node,
              data: {
                ...node.data,
                width: newDims.width,
                height: newDims.height,
              },
            }
          })
        })
      },
      [blocks, getBlockDimensions]
    )

    /** Handles node changes - applies changes and resolves parent-child selection conflicts. */
    const onNodesChange = useCallback(
      (changes: NodeChange[]) => {
        const hasSelectionChange = changes.some((c) => c.type === 'select')
        setDisplayNodes((currentNodes) => {
          // Filter out cross-context selection changes before applying so that
          // nodes at a different nesting level never appear selected, even for
          // a single frame.
          let changesToApply = changes
          if (hasSelectionChange) {
            const currentlySelected = currentNodes.filter((n) => n.selected)
            // Only filter on additive multi-select (shift-click), not replacement
            // clicks. A replacement click includes deselections of currently selected
            // nodes; a shift-click only adds selections.
            const isReplacementClick = changes.some(
              (c) =>
                c.type === 'select' &&
                'selected' in c &&
                !c.selected &&
                currentlySelected.some((n) => n.id === c.id)
            )
            if (!isReplacementClick && currentlySelected.length > 0) {
              const selectionContext = getNodeSelectionContextId(currentlySelected[0], blocks)
              changesToApply = changes.filter((c) => {
                if (c.type !== 'select' || !('selected' in c) || !c.selected) return true
                const node = currentNodes.find((n) => n.id === c.id)
                if (!node) return true
                return getNodeSelectionContextId(node, blocks) === selectionContext
              })
            }
          }

          const updated = applyNodeChanges(changesToApply, currentNodes)
          if (!hasSelectionChange) return updated

          const preferredNodeId = [...changesToApply]
            .reverse()
            .find(
              (change): change is NodeChange & { id: string; selected: boolean } =>
                change.type === 'select' && 'selected' in change && change.selected === true
            )?.id

          return resolveSelectionConflicts(updated, blocks, preferredNodeId)
        })

        // Handle position changes (e.g., from keyboard arrow key movement)
        // Update container dimensions when child nodes are moved and persist to backend
        // Only persist if not in a drag operation (drag-end is handled by onNodeDragStop)
        const isInDragOperation =
          getDragStartPosition() !== null || multiNodeDragStartRef.current.size > 0
        const keyboardPositionUpdates: Array<{ id: string; position: { x: number; y: number } }> =
          []
        for (const change of changes) {
          if (
            change.type === 'position' &&
            !change.dragging &&
            'position' in change &&
            change.position
          ) {
            updateContainerDimensionsDuringMove(change.id, change.position)
            if (!isInDragOperation) {
              keyboardPositionUpdates.push({ id: change.id, position: change.position })
            }
          }
        }
        // Persist keyboard movements to backend for collaboration sync
        if (keyboardPositionUpdates.length > 0) {
          collaborativeBatchUpdatePositions(keyboardPositionUpdates)
        }
      },
      [
        blocks,
        updateContainerDimensionsDuringMove,
        collaborativeBatchUpdatePositions,
        getDragStartPosition,
      ]
    )

    /**
     * Effect to resize loops when nodes change (add/remove/position change).
     * Runs on structural changes only - not during drag (position-only changes).
     * Skips during loading.
     */
    useEffect(() => {
      // Skip during initial render when nodes aren't loaded yet or workflow not ready
      if (derivedNodes.length === 0 || !isWorkflowReady) return

      // Resize all loops to fit their children
      resizeLoopNodesWrapper()
    }, [derivedNodes, resizeLoopNodesWrapper, isWorkflowReady])

    /** Cleans up orphaned nodes with invalid parent references after deletion. */
    useEffect(() => {
      if (!isWorkflowReady) return

      // Create a mapping of node IDs to check for missing parent references
      const nodeIds = new Set(Object.keys(blocks))

      // Check for nodes with invalid parent references and collect updates
      const orphanedUpdates: Array<{
        id: string
        position: { x: number; y: number }
        parentId: string
      }> = []
      Object.entries(blocks).forEach(([id, block]) => {
        const parentId = block.data?.parentId

        // If block has a parent reference but parent no longer exists
        if (parentId && !nodeIds.has(parentId)) {
          logger.warn('Found orphaned node with invalid parent reference', {
            nodeId: id,
            missingParentId: parentId,
          })

          const absolutePosition = getNodeAbsolutePosition(id)
          orphanedUpdates.push({ id, position: absolutePosition, parentId: '' })
        }
      })

      // Batch update all orphaned nodes at once
      if (orphanedUpdates.length > 0) {
        batchUpdateBlocksWithParent(orphanedUpdates)
      }
    }, [blocks, batchUpdateBlocksWithParent, getNodeAbsolutePosition, isWorkflowReady])

    /** Handles edge removal changes. */
    const onEdgesChange = useCallback(
      (changes: any) => {
        const edgeIdsToRemove = changes
          .filter((change: any) => change.type === 'remove')
          .map((change: any) => change.id)
          .filter((edgeId: string) => {
            // Prevent removing edges targeting protected blocks
            const edge = edges.find((e) => e.id === edgeId)
            if (!edge) return true
            return !isEdgeProtected(edge, blocks)
          })

        if (edgeIdsToRemove.length > 0) {
          collaborativeBatchRemoveEdges(edgeIdsToRemove)
        }
      },
      [collaborativeBatchRemoveEdges, edges, blocks]
    )

    /**
     * Finds the node under the cursor using DOM hit-testing for pixel-perfect
     * detection that matches exactly what the user sees on screen.
     * Uses the same approach as ReactFlow's internal handle detection.
     */
    const findNodeAtScreenPosition = useCallback(
      (clientX: number, clientY: number) => {
        const elements = document.elementsFromPoint(clientX, clientY)
        const nodes = getNodes()

        for (const el of elements) {
          const nodeEl = el.closest('.react-flow__node') as HTMLElement | null
          if (!nodeEl) continue

          const nodeId = nodeEl.getAttribute('data-id')
          if (!nodeId) continue

          const node = nodes.find((n) => n.id === nodeId)
          if (node && node.type !== 'subflowNode') return node
        }

        return undefined
      },
      [getNodes]
    )

    const createContentReferenceFromHandleDrag = useCallback(
      (sourceBlockId: string, targetBlockId: string, sourceAnchor: 'left' | 'right') => {
        if (sourceBlockId === targetBlockId) return false

        const sourceBlock = blocks[sourceBlockId]
        const targetBlock = blocks[targetBlockId]
        if (!isContentBlockState(sourceBlock) || !isContentBlockState(targetBlock)) {
          return false
        }

        const workflowValues = activeWorkflowId
          ? useSubBlockStore.getState().workflowValues[activeWorkflowId]
          : undefined
        const sourceValues = workflowValues?.[sourceBlockId] as Record<string, unknown> | undefined
        const targetValues = workflowValues?.[targetBlockId] as Record<string, unknown> | undefined
        const sourceVariant = resolveContentBlockVariant({
          block: sourceBlock,
          values: sourceValues,
        })
        const targetVariant = resolveContentBlockVariant({
          block: targetBlock,
          values: targetValues,
        })

        if (!sourceVariant || !targetVariant) return false

        const targetModel = resolveContentBlockReferenceModel({
          block: targetBlock,
          values: targetValues,
          variant: targetVariant,
        })
        const referenceRole = getDefaultReferenceRole({
          targetVariant,
          model: targetModel,
          sourceVariant,
        })
        if (!referenceRole) return false

        const currentReferences = normalizeContentReferences(
          getLiveContentSubblockValue({
            block: targetBlock,
            values: targetValues,
            key: 'contentReferences',
          })
        )
        const nextReferences = upsertContentReference(currentReferences, {
          sourceBlockId,
          sourceVariant,
          role: referenceRole,
        })
        const disabledReason = getModelDisabledReason({
          targetVariant,
          model: targetModel,
          references: nextReferences,
        })
        if (disabledReason) return false

        const isVideoFrameReference =
          referenceRole === 'video_first_frame' || referenceRole === 'video_last_frame'
        const edgeSourceId = isVideoFrameReference ? sourceBlockId : targetBlockId
        const edgeTargetId = isVideoFrameReference ? targetBlockId : sourceBlockId
        const edgeSourcePosition = blocks[edgeSourceId]?.position ?? { x: 0, y: 0 }
        const edgeTargetPosition = blocks[edgeTargetId]?.position ?? { x: 0, y: 0 }
        const derivedSourceAnchor = edgeTargetPosition.x >= edgeSourcePosition.x ? 'right' : 'left'
        const derivedTargetAnchor = getContentReferenceAnchorForTarget({
          sourceX: edgeSourcePosition.x,
          targetX: edgeTargetPosition.x,
        })

        setContentReferenceEdgeMenu(null)
        collaborativeSetSubblockValue(targetBlockId, 'contentReferences', nextReferences)

        if (isVideoFrameReference) {
          const previousEdge = findAutoVideoContentReferenceEdge(
            edges,
            targetBlockId,
            referenceRole
          )
          if (previousEdge?.id) {
            collaborativeBatchRemoveEdges([previousEdge.id], { skipUndoRedo: true })
          }

          const sourceFile = getLiveContentSubblockValue({
            block: sourceBlock,
            values: sourceValues,
            key: 'file',
          })
          if (hasUploadedFileSnapshot(sourceFile)) {
            const currentVideoMedia = normalizeVideoMediaSnapshots(
              getLiveContentSubblockValue({
                block: targetBlock,
                values: targetValues,
                key: 'videoMedia',
              })
            )
            collaborativeSetSubblockValue(
              targetBlockId,
              'videoMedia',
              upsertVideoMediaFile(
                currentVideoMedia,
                referenceRole === 'video_first_frame' ? 'first_frame' : 'last_frame',
                sourceFile
              )
            )
          }
        }

        const autoLinkType =
          referenceRole === 'video_first_frame' || referenceRole === 'video_last_frame'
            ? referenceRole
            : undefined
        const edge = createContentReferenceEdge({
          id: generateId(),
          source: edgeSourceId,
          target: edgeTargetId,
          sourceHandle: getContentReferenceSourceHandleId(
            isVideoFrameReference ? sourceAnchor : derivedSourceAnchor
          ),
          targetHandle: getContentReferenceTargetHandleId(
            isVideoFrameReference ? derivedTargetAnchor : sourceAnchor
          ),
          autoLinkType,
        })

        const alreadyLinked =
          !isVideoFrameReference &&
          edges.some(
            (candidate) =>
              isContentReferenceEdge(candidate) &&
              !getContentReferenceAutoLinkType(candidate) &&
              candidate.source === edgeSourceId &&
              candidate.target === edgeTargetId
          )

        if (!alreadyLinked) {
          collaborativeBatchAddEdges([edge])
        }
        return true
      },
      [
        activeWorkflowId,
        blocks,
        collaborativeBatchAddEdges,
        collaborativeBatchRemoveEdges,
        collaborativeSetSubblockValue,
        edges,
      ]
    )

    /**
     * Captures the source handle when a connection drag starts.
     * Resets connectionCompletedRef to track if onConnect handles this connection.
     */
    const onConnectStart = useCallback((_event: unknown, params: ConnectionStartParams) => {
      const handleId = params.handleId
      setIsErrorConnectionDrag(handleId === 'error')
      connectionSourceRef.current = {
        nodeId: params.nodeId ?? undefined,
        handleId: params.handleId ?? undefined,
      }
      connectionCompletedRef.current = false
    }, [])

    /** Handles new edge connections with container boundary validation. */
    const onConnect = useCallback(
      (connection: CanvasConnection) => {
        const sourceId = connection.source
        const targetId = connection.target
        if (sourceId && targetId) {
          const validConnection = {
            source: sourceId,
            target: targetId,
            sourceHandle: connection.sourceHandle,
            targetHandle: connection.targetHandle,
          }

          // Check if connecting nodes across container boundaries
          const sourceNode = getNodes().find((n) => n.id === sourceId)
          const targetNode = getNodes().find((n) => n.id === targetId)

          if (!sourceNode || !targetNode) return

          if (isContentReferenceSourceHandle(connection.sourceHandle)) {
            connectionCompletedRef.current = createContentReferenceFromHandleDrag(
              sourceNode.id,
              targetNode.id,
              getContentReferenceSourceAnchorFromHandle(connection.sourceHandle)
            )
            return
          }

          // Prevent connections to protected blocks (outbound from locked blocks is allowed)
          if (isEdgeProtected(validConnection, blocks)) {
            addNotification({
              level: 'info',
              message: 'Cannot connect to locked blocks or blocks inside locked containers',
              workflowId: activeWorkflowId || undefined,
            })
            return
          }

          // Get parent information (handle container start node case)
          const sourceParentId =
            blocks[sourceNode.id]?.data?.parentId ||
            (connection.sourceHandle === 'loop-start-source' ||
            connection.sourceHandle === 'parallel-start-source'
              ? sourceId
              : undefined)
          const targetParentId = blocks[targetNode.id]?.data?.parentId

          // Generate a unique edge ID
          const edgeId = generateId()

          // Special case for container start source: Always allow connections to nodes within the same container
          if (
            (connection.sourceHandle === 'loop-start-source' ||
              connection.sourceHandle === 'parallel-start-source') &&
            blocks[targetNode.id]?.data?.parentId === sourceNode.id
          ) {
            // This is a connection from container start to a node inside the container - always allow

            addEdge({
              ...validConnection,
              id: edgeId,
              type: 'workflowEdge',
              // Add metadata about the container context
              data: {
                parentId: sourceNode.id,
                isInsideContainer: true,
              },
            })
            connectionCompletedRef.current = true
            return
          }

          // Prevent connections across container boundaries
          if (
            (sourceParentId && !targetParentId) ||
            (!sourceParentId && targetParentId) ||
            (sourceParentId && targetParentId && sourceParentId !== targetParentId)
          ) {
            return
          }

          // Track if this connection is inside a container
          const isInsideContainer = Boolean(sourceParentId) || Boolean(targetParentId)
          const parentId = sourceParentId || targetParentId

          // Add appropriate metadata for container context
          addEdge({
            ...validConnection,
            id: edgeId,
            type: 'workflowEdge',
            data: isInsideContainer
              ? {
                  parentId,
                  isInsideContainer,
                }
              : undefined,
          })
          connectionCompletedRef.current = true
        }
      },
      [
        addEdge,
        getNodes,
        blocks,
        addNotification,
        activeWorkflowId,
        createContentReferenceFromHandleDrag,
      ]
    )

    /**
     * Handles connection drag end. Detects if the edge was dropped over a block
     * and automatically creates a connection to that block's target handle.
     *
     * Uses connectionCompletedRef to check if onConnect already handled this connection
     * (ReactFlow pattern for distinguishing handle-to-handle vs handle-to-body drops).
     */
    const onConnectEnd = useCallback(
      (event: MouseEvent | TouchEvent) => {
        setIsErrorConnectionDrag(false)

        const source = connectionSourceRef.current
        if (!source?.nodeId) {
          connectionSourceRef.current = null
          return
        }

        // If onConnect already handled this connection, skip (handle-to-handle case)
        if (connectionCompletedRef.current) {
          connectionSourceRef.current = null
          return
        }

        // Find node under cursor using DOM hit-testing
        const clientPos = 'changedTouches' in event ? event.changedTouches[0] : event
        const targetNode = findNodeAtScreenPosition(clientPos.clientX, clientPos.clientY)

        // Create connection if valid target found (handle-to-body case)
        if (targetNode && targetNode.id !== source.nodeId) {
          if (isContentReferenceSourceHandle(source.handleId)) {
            createContentReferenceFromHandleDrag(
              source.nodeId,
              targetNode.id,
              getContentReferenceSourceAnchorFromHandle(source.handleId)
            )
            connectionSourceRef.current = null
            return
          }

          onConnect({
            source: source.nodeId,
            sourceHandle: source.handleId,
            target: targetNode.id,
            targetHandle: 'target',
          })
        }

        connectionSourceRef.current = null
      },
      [createContentReferenceFromHandleDrag, findNodeAtScreenPosition, onConnect]
    )

    /** Handles node drag to detect container intersections and update highlighting. */
    const onNodeDrag = useCallback(
      (_event: React.MouseEvent, node: any) => {
        // Note: We don't emit position updates during drag to avoid flooding socket events.
        // The final position is sent in onNodeDragStop for collaborative updates.

        // Get the current parent ID of the node being dragged
        const currentParentId = blocks[node.id]?.data?.parentId || null

        // If the node is inside a container, update container dimensions during drag
        if (currentParentId) {
          updateContainerDimensionsDuringMove(node.id, node.position)
        }

        // Check if this is a starter block - starter blocks should never be in containers
        const isStarterBlock = node.data?.type === 'starter'
        if (isStarterBlock) {
          // If it's a starter block, remove any highlighting and don't allow it to be dragged into containers
          if (potentialParentId) {
            resetDragHighlights()
            setPotentialParentId(null)
          }
          return // Exit early - don't process any container intersections for starter blocks
        }

        const geometrySnapshot = createNodeGeometrySnapshot(getNodes(), blocks)
        const allNodes = Array.from(geometrySnapshot.nodeById.values())

        // Get the node's absolute position to properly calculate intersections
        const nodeAbsolutePos = geometrySnapshot.getNodeAbsolutePosition(node.id)

        // Find intersections with container nodes using absolute coordinates
        const intersectingNodes = allNodes
          .filter((n) => {
            // Only consider container nodes that aren't the dragged node
            if (n.type !== 'subflowNode' || n.id === node.id) return false

            // Don't allow dropping into locked containers
            if (blocks[n.id]?.locked) return false

            // Get the container's absolute position
            const containerAbsolutePos = geometrySnapshot.getNodeAbsolutePosition(n.id)

            // Get dimensions based on node type (must match actual rendered dimensions)
            const nodeWidth =
              node.type === 'subflowNode'
                ? node.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH
                : BLOCK_DIMENSIONS.FIXED_WIDTH

            const nodeHeight =
              node.type === 'subflowNode'
                ? node.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT
                : Math.max(node.height || BLOCK_DIMENSIONS.MIN_HEIGHT, BLOCK_DIMENSIONS.MIN_HEIGHT)

            // Check intersection using absolute coordinates
            const nodeRect = {
              left: nodeAbsolutePos.x,
              right: nodeAbsolutePos.x + nodeWidth,
              top: nodeAbsolutePos.y,
              bottom: nodeAbsolutePos.y + nodeHeight,
            }

            const containerRect = {
              left: containerAbsolutePos.x,
              right: containerAbsolutePos.x + (n.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH),
              top: containerAbsolutePos.y,
              bottom:
                containerAbsolutePos.y + (n.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
            }

            // Check intersection with absolute coordinates for accurate detection
            return (
              nodeRect.left < containerRect.right &&
              nodeRect.right > containerRect.left &&
              nodeRect.top < containerRect.bottom &&
              nodeRect.bottom > containerRect.top
            )
          })
          // Add more information for sorting
          .map((n) => ({
            id: n.id,
            container: n,
            depth: geometrySnapshot.getNodeDepth(n.id),
            // Calculate size for secondary sorting
            size:
              (n.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH) *
              (n.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
          }))

        // Update potential parent if there's at least one intersecting container node
        if (intersectingNodes.length > 0) {
          const bestContainerMatch = pickBestContainerMatch(
            intersectingNodes,
            node.id,
            geometrySnapshot.isDescendantOf
          )

          if (bestContainerMatch) {
            if (bestContainerMatch.container.id !== potentialParentId) {
              setPotentialParentId(bestContainerMatch.container.id)
            }

            // Add highlight class and change cursor
            const kind = (bestContainerMatch.container.data as SubflowNodeData)?.kind
            if (kind === 'loop' || kind === 'parallel') {
              highlightContainerNode(bestContainerMatch.container.id, kind)
            }
          } else {
            resetDragHighlights()
            if (potentialParentId) {
              setPotentialParentId(null)
            }
          }
        } else {
          // Remove highlighting if no longer over a container
          if (potentialParentId || highlightedContainerRef.current) {
            resetDragHighlights()
            setPotentialParentId(null)
          }
        }
      },
      [
        getNodes,
        potentialParentId,
        blocks,
        updateContainerDimensionsDuringMove,
        highlightContainerNode,
        resetDragHighlights,
      ]
    )

    /** Captures initial parent ID and position when drag starts. */
    const onNodeDragStart = useCallback(
      (_event: React.MouseEvent, node: any) => {
        // Note: Protected blocks are already non-draggable via the `draggable` node property

        // Store the original parent ID when starting to drag
        const currentParentId = blocks[node.id]?.data?.parentId || null
        setDragStartParentId(currentParentId)
        // Initialize potentialParentId to the current parent so a click without movement doesn't remove from subflow
        setPotentialParentId(currentParentId)
        // Store starting position for undo/redo move entry
        setDragStartPosition({
          id: node.id,
          x: node.position.x,
          y: node.position.y,
          parentId: currentParentId,
        })

        // Capture all selected nodes' positions for multi-node undo/redo.
        // Also include the dragged node itself - during shift+click+drag, ReactFlow
        // may have toggled (deselected) the node before drag starts, so it might not
        // appear in the selected set yet.
        const allNodes = getNodes()
        const selectedNodes = allNodes.filter((n) => n.selected)
        multiNodeDragStartRef.current.clear()
        selectedNodes.forEach((n) => {
          const block = blocks[n.id]
          if (block) {
            multiNodeDragStartRef.current.set(n.id, {
              x: n.position.x,
              y: n.position.y,
              parentId: block.data?.parentId,
            })
          }
        })
        if (!multiNodeDragStartRef.current.has(node.id)) {
          multiNodeDragStartRef.current.set(node.id, {
            x: node.position.x,
            y: node.position.y,
            parentId: currentParentId ?? undefined,
          })
        }

        // When shift+clicking an already-selected node, ReactFlow toggles (deselects)
        // it via onNodesChange before drag starts. Re-select the dragged node so all
        // previously selected nodes move together as a group - but only if the
        // deselection wasn't from a parent-child conflict (e.g. dragging a child
        // when its parent subflow is selected).
        const draggedNodeInSelected = allNodes.find((n) => n.id === node.id)
        if (draggedNodeInSelected && !draggedNodeInSelected.selected && selectedNodes.length > 0) {
          const draggedParentId = blocks[node.id]?.data?.parentId
          const parentIsSelected =
            draggedParentId && selectedNodes.some((n) => n.id === draggedParentId)
          const contextMismatch =
            getNodeSelectionContextId(draggedNodeInSelected, blocks) !==
            getNodeSelectionContextId(selectedNodes[0], blocks)
          if (!parentIsSelected && !contextMismatch) {
            setDisplayNodes((currentNodes) =>
              currentNodes.map((n) => (n.id === node.id ? { ...n, selected: true } : n))
            )
          }
        }
      },
      [blocks, setDragStartPosition, getNodes, setPotentialParentId]
    )

    /** Handles node drag stop to establish parent-child relationships. */
    const onNodeDragStop = useCallback(
      (_event: React.MouseEvent, node: any) => {
        resetDragHighlights()

        // Get all selected nodes to update their positions too
        const allNodes = getNodes()
        const selectedNodes = allNodes.filter((n) => n.selected)

        // If multiple nodes are selected, update all their positions
        if (selectedNodes.length > 1) {
          const positionUpdates = computeClampedPositionUpdates(selectedNodes, blocks, allNodes)
          collaborativeBatchUpdatePositions(positionUpdates, {
            previousPositions: multiNodeDragStartRef.current,
          })

          // Only reparent when an actual drag changed the target container.
          // onNodeDragStart sets both potentialParentId and dragStartParentId to the
          // clicked node's current parent; they only diverge when onNodeDrag detects
          // the selection being dragged over a different container.
          if (potentialParentId !== dragStartParentId) {
            executeBatchParentUpdate(
              selectedNodes,
              potentialParentId,
              'Batch moved nodes to new parent'
            )
          }

          // Clear drag start state
          setDragStartPosition(null)
          setPotentialParentId(null)
          multiNodeDragStartRef.current.clear()
          return
        }

        // Single node drag - original logic
        const finalPosition = getClampedPositionForNode(node.id, node.position, blocks, allNodes)

        updateBlockPosition(node.id, finalPosition)

        // Record single move entry on drag end to avoid micro-moves
        const start = getDragStartPosition()
        if (start && start.id === node.id) {
          const before = { x: start.x, y: start.y, parentId: start.parentId }
          const after = {
            x: finalPosition.x,
            y: finalPosition.y,
            parentId: node.parentId || blocks[node.id]?.data?.parentId,
          }
          const moved =
            before.x !== after.x || before.y !== after.y || before.parentId !== after.parentId
          if (moved) {
            window.dispatchEvent(
              new CustomEvent('workflow-record-move', {
                detail: { blockId: node.id, before, after },
              })
            )
          }
          setDragStartPosition(null)
        }

        // Don't process parent changes if the node hasn't actually changed parent or is being moved within same parent
        if (potentialParentId === dragStartParentId) return

        // Prevent moving locked blocks out of locked containers
        // Unlocked blocks (e.g., duplicates) can be moved out freely
        if (dragStartParentId && blocks[dragStartParentId]?.locked && blocks[node.id]?.locked) {
          addNotification({
            level: 'info',
            message: 'Cannot move locked blocks out of locked containers',
            workflowId: activeWorkflowId || undefined,
          })
          setPotentialParentId(dragStartParentId) // Reset to original parent
          return
        }

        // Check if this is a starter block - starter blocks should never be in containers
        const isStarterBlock = node.data?.type === 'starter'
        if (isStarterBlock) {
          logger.warn('Prevented starter block from being placed inside a container', {
            blockId: node.id,
            attemptedParentId: potentialParentId,
          })
          setPotentialParentId(null)
          return // Exit early - don't allow starter blocks to have parents
        }

        // Trigger blocks cannot be placed inside loop or parallel subflows
        if (potentialParentId) {
          const block = blocks[node.id]
          if (block && TriggerUtils.isTriggerBlock(block)) {
            addNotification({
              level: 'error',
              message: 'Triggers cannot be placed inside loop or parallel subflows.',
              workflowId: activeWorkflowId || undefined,
            })
            logger.warn('Prevented trigger block from being placed inside a container', {
              blockId: node.id,
              blockType: block.type,
              attemptedParentId: potentialParentId,
            })
            setPotentialParentId(null)
            return
          }
        }

        // Prevent placing a container inside one of its own nested containers (would create cycle)
        if (potentialParentId && isDescendantOf(node.id, potentialParentId)) {
          addNotification({
            level: 'info',
            message: 'Cannot place a container inside one of its own nested containers',
            workflowId: activeWorkflowId || undefined,
          })
          setPotentialParentId(null)
          return
        }

        // Update the node's parent relationship
        if (potentialParentId) {
          // Remove existing edges before moving into container
          const edgesToRemove = edgesForDisplay.filter(
            (e) => e.source === node.id || e.target === node.id
          )

          if (edgesToRemove.length > 0) {
            removeEdgesForNode(node.id, edgesToRemove)

            logger.info('Removed edges when moving node into subflow', {
              blockId: node.id,
              targetParentId: potentialParentId,
              edgeCount: edgesToRemove.length,
            })
          }

          // Compute relative position BEFORE updating parent to avoid stale state
          // Account for header (50px), left padding (16px), and top padding (16px)
          const containerAbsPosBefore = getNodeAbsolutePosition(potentialParentId)
          const nodeAbsPosBefore = getNodeAbsolutePosition(node.id)
          const headerHeight = 50
          const leftPadding = 16
          const topPadding = 16

          const relativePositionBefore = {
            x: nodeAbsPosBefore.x - containerAbsPosBefore.x - leftPadding,
            y: nodeAbsPosBefore.y - containerAbsPosBefore.y - headerHeight - topPadding,
          }

          // Auto-connect when moving an existing block into a container
          const existingChildBlocks = Object.values(blocks)
            .filter((b) => b.data?.parentId === potentialParentId && b.id !== node.id)
            .map((b) => ({ id: b.id, type: b.type, position: b.position }))

          const autoConnectEdge = tryCreateAutoConnectEdge(relativePositionBefore, node.id, {
            targetParentId: potentialParentId,
            existingChildBlocks,
            containerId: potentialParentId,
          })

          const edgesToAdd: Edge[] = autoConnectEdge ? [autoConnectEdge] : []

          // Moving to a new parent container - pass both removed and added edges for undo/redo
          const affectedEdges = [...edgesToRemove, ...edgesToAdd]
          updateNodeParent(node.id, potentialParentId, affectedEdges)

          setDisplayNodes((nodes) =>
            nodes.map((n) => {
              if (n.id === node.id) {
                return {
                  ...n,
                  position: relativePositionBefore,
                  parentId: potentialParentId,
                  extent: 'parent' as const,
                }
              }
              return n
            })
          )

          // Add edges after parent update (skip undo recording - it's part of parent update)
          if (edgesToAdd.length > 0) {
            collaborativeBatchAddEdges(edgesToAdd, { skipUndoRedo: true })
          }
        } else if (!potentialParentId && dragStartParentId) {
          // Moving OUT of a subflow to canvas
          // Get absolute position BEFORE removing from parent
          const absolutePosition = getNodeAbsolutePosition(node.id)

          // Remove edges connected to this node since it's leaving its parent
          const edgesToRemove = edgesForDisplay.filter(
            (e) => e.source === node.id || e.target === node.id
          )

          if (edgesToRemove.length > 0) {
            removeEdgesForNode(node.id, edgesToRemove)

            logger.info('Removed edges when moving node out of subflow', {
              blockId: node.id,
              sourceParentId: dragStartParentId,
              edgeCount: edgesToRemove.length,
            })
          }

          // Clear the parent relationship
          updateNodeParent(node.id, null, edgesToRemove)

          // Immediately update displayNodes to prevent React Flow from using stale parent data
          setDisplayNodes((nodes) =>
            nodes.map((n) => {
              if (n.id === node.id) {
                return {
                  ...n,
                  position: absolutePosition,
                  parentId: undefined,
                  extent: undefined,
                }
              }
              return n
            })
          )

          logger.info('Moved node out of subflow', {
            blockId: node.id,
            sourceParentId: dragStartParentId,
          })
        }

        // Reset state
        setPotentialParentId(null)
      },
      [
        getNodes,
        dragStartParentId,
        potentialParentId,
        isDescendantOf,
        updateNodeParent,
        updateBlockPosition,
        collaborativeBatchAddEdges,
        tryCreateAutoConnectEdge,
        blocks,
        edgesForDisplay,
        removeEdgesForNode,
        getNodeAbsolutePosition,
        getDragStartPosition,
        setDragStartPosition,
        addNotification,
        activeWorkflowId,
        collaborativeBatchUpdatePositions,
        executeBatchParentUpdate,
        resetDragHighlights,
      ]
    )

    /** Captures initial positions when selection drag starts (for marquee-selected nodes). */
    const onSelectionDragStart = useCallback(
      (_event: React.MouseEvent, nodes: Node[]) => {
        if (nodes.length > 0) {
          const firstNodeParentId = blocks[nodes[0].id]?.data?.parentId || null
          setDragStartParentId(firstNodeParentId)
        }

        // Filter to nodes that won't be deselected (exclude children whose parent is selected)
        const nodeIds = new Set(nodes.map((n) => n.id))
        const effectiveNodes = nodes.filter((n) => {
          const parentId = blocks[n.id]?.data?.parentId
          return !parentId || !nodeIds.has(parentId)
        })

        // Capture positions for undo/redo before applying display changes
        multiNodeDragStartRef.current.clear()
        effectiveNodes.forEach((n) => {
          const blk = blocks[n.id]
          if (blk) {
            multiNodeDragStartRef.current.set(n.id, {
              x: n.position.x,
              y: n.position.y,
              parentId: blk.data?.parentId,
            })
          }
        })

        // Apply visual deselection of children
        setDisplayNodes((allNodes) => resolveSelectionConflicts(allNodes, blocks))
      },
      [blocks]
    )

    /** Handles selection drag to detect potential parent containers for batch drops. */
    const onSelectionDrag = useCallback(
      (_event: React.MouseEvent, nodes: Node[]) => {
        if (nodes.length === 0) return

        // Filter out nodes that can't be placed in containers
        const eligibleNodes = nodes.filter(canNodeEnterContainer)

        // If no eligible nodes, clear any potential parent
        if (eligibleNodes.length === 0) {
          if (potentialParentId || highlightedContainerRef.current) {
            resetDragHighlights()
            setPotentialParentId(null)
          }
          return
        }

        const geometrySnapshot = createNodeGeometrySnapshot(getNodes(), blocks)
        const allNodes = Array.from(geometrySnapshot.nodeById.values())

        // Calculate bounding box of all dragged nodes using absolute positions
        let minX = Number.POSITIVE_INFINITY
        let minY = Number.POSITIVE_INFINITY
        let maxX = Number.NEGATIVE_INFINITY
        let maxY = Number.NEGATIVE_INFINITY

        eligibleNodes.forEach((node) => {
          const absolutePos = geometrySnapshot.getNodeAbsolutePosition(node.id)
          const width = BLOCK_DIMENSIONS.FIXED_WIDTH
          const height = Math.max(
            node.height || BLOCK_DIMENSIONS.MIN_HEIGHT,
            BLOCK_DIMENSIONS.MIN_HEIGHT
          )

          minX = Math.min(minX, absolutePos.x)
          minY = Math.min(minY, absolutePos.y)
          maxX = Math.max(maxX, absolutePos.x + width)
          maxY = Math.max(maxY, absolutePos.y + height)
        })

        // Use bounding box for intersection detection
        const selectionRect = { left: minX, right: maxX, top: minY, bottom: maxY }

        // Find containers that intersect with the selection bounding box
        const intersectingContainers = allNodes
          .filter((containerNode) => {
            if (containerNode.type !== 'subflowNode') return false
            // Skip if any dragged node is this container
            if (nodes.some((n) => n.id === containerNode.id)) return false

            const containerAbsolutePos = geometrySnapshot.getNodeAbsolutePosition(containerNode.id)
            const containerRect = {
              left: containerAbsolutePos.x,
              right:
                containerAbsolutePos.x +
                (containerNode.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH),
              top: containerAbsolutePos.y,
              bottom:
                containerAbsolutePos.y +
                (containerNode.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
            }

            // Check intersection
            return (
              selectionRect.left < containerRect.right &&
              selectionRect.right > containerRect.left &&
              selectionRect.top < containerRect.bottom &&
              selectionRect.bottom > containerRect.top
            )
          })
          .map((n) => ({
            id: n.id,
            container: n,
            depth: geometrySnapshot.getNodeDepth(n.id),
            size:
              (n.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH) *
              (n.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
          }))

        if (intersectingContainers.length > 0) {
          const bestMatch = pickBestContainerMatch(
            intersectingContainers,
            '__selection__',
            (_ancestorId, containerId) =>
              nodes.some((draggedNode) =>
                geometrySnapshot.isDescendantOf(draggedNode.id, containerId)
              )
          )

          if (bestMatch && bestMatch.container.id !== potentialParentId) {
            setPotentialParentId(bestMatch.container.id)
          }

          if (bestMatch) {
            const kind = (bestMatch.container.data as SubflowNodeData)?.kind
            if (kind === 'loop' || kind === 'parallel') {
              highlightContainerNode(bestMatch.container.id, kind)
            }
          }
        } else if (potentialParentId || highlightedContainerRef.current) {
          resetDragHighlights()
          setPotentialParentId(null)
        }
      },
      [
        canNodeEnterContainer,
        getNodes,
        potentialParentId,
        blocks,
        highlightContainerNode,
        resetDragHighlights,
      ]
    )

    const onSelectionDragStop = useCallback(
      (_event: React.MouseEvent, nodes: any[]) => {
        resetDragHighlights()
        if (nodes.length === 0) return

        const allNodes = getNodes()
        const positionUpdates = computeClampedPositionUpdates(nodes, blocks, allNodes)
        collaborativeBatchUpdatePositions(positionUpdates, {
          previousPositions: multiNodeDragStartRef.current,
        })

        // Process parent updates using shared helper
        executeBatchParentUpdate(nodes, potentialParentId, 'Batch moved selection to new parent')

        // Clear drag state
        setDragStartPosition(null)
        setPotentialParentId(null)
        multiNodeDragStartRef.current.clear()
      },
      [
        blocks,
        getNodes,
        collaborativeBatchUpdatePositions,
        potentialParentId,
        executeBatchParentUpdate,
        resetDragHighlights,
      ]
    )

    const resolveLiveContentFileSnapshot = useCallback(
      (blockId: string, node: Node): UploadedFileSnapshot | null => {
        const storeValues = activeWorkflowId
          ? useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[blockId]
          : undefined
        const liveFile = storeValues?.file
        if (hasUploadedFileSnapshot(liveFile)) {
          return liveFile
        }

        const nodeSubBlockValues =
          node.data && typeof node.data === 'object' && 'subBlockValues' in node.data
            ? ((node.data as { subBlockValues?: Record<string, unknown> }).subBlockValues ??
              undefined)
            : undefined
        const previewFile = getStoredSubBlockValue(nodeSubBlockValues, 'file')
        if (hasUploadedFileSnapshot(previewFile)) {
          return previewFile
        }

        const blockFile = blocks[blockId]?.subBlocks?.file?.value
        return hasUploadedFileSnapshot(blockFile) ? blockFile : null
      },
      [activeWorkflowId, blocks]
    )

    const resolveLiveContentVariant = useCallback(
      (
        blockId: string,
        node: Node,
        fileSnapshot: UploadedFileSnapshot | null
      ): ContentVariant | null => {
        const block = blocks[blockId]
        if (block?.type !== 'content') {
          return null
        }

        const storeValues = activeWorkflowId
          ? useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[blockId]
          : undefined
        return (
          normalizeContentVariant(storeValues?.contentVariant) ||
          normalizeContentVariant(
            (node.data as { contentVariant?: unknown } | undefined)?.contentVariant
          ) ||
          normalizeContentVariant(
            getStoredSubBlockValue(block.subBlocks as Record<string, unknown>, 'contentVariant')
          ) ||
          inferContentVariantFromSnapshot(fileSnapshot)
        )
      },
      [activeWorkflowId, blocks]
    )

    const buildContentReferenceHandles = useCallback(
      (params: { sourceX: number; targetX: number; sourceAnchor?: 'left' | 'right' }) => {
        const sourceAnchor =
          params.sourceAnchor ?? (params.targetX >= params.sourceX ? 'right' : 'left')
        const targetAnchor = getContentReferenceAnchorForTarget({
          sourceX: params.sourceX,
          targetX: params.targetX,
        })

        return {
          sourceHandle: getContentReferenceSourceHandleId(sourceAnchor),
          targetHandle: getContentReferenceTargetHandleId(targetAnchor),
        }
      },
      []
    )

    const getCurrentContentReferences = useCallback(
      (blockId: string): ContentReferenceRecord[] => {
        const storeValues = activeWorkflowId
          ? useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[blockId]
          : undefined
        if (storeValues?.contentReferences !== undefined) {
          return normalizeContentReferences(storeValues.contentReferences)
        }
        return normalizeContentReferences(blocks[blockId]?.subBlocks?.contentReferences?.value)
      },
      [activeWorkflowId, blocks]
    )

    const setContentReferencesForBlock = useCallback(
      (blockId: string, references: ContentReferenceRecord[]) => {
        collaborativeSetSubblockValue(
          blockId,
          'contentReferences',
          normalizeContentReferences(references)
        )
      },
      [collaborativeSetSubblockValue]
    )

    const clearVideoFrameMediaForAutoLink = useCallback(
      (videoBlockId: string, autoLinkType: ContentReferenceAutoLinkType) => {
        const targetBlock = blocks[videoBlockId]
        if (!targetBlock || targetBlock.type !== 'content') return

        const targetStoreValues = activeWorkflowId
          ? useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[videoBlockId]
          : undefined
        const storedVideoMedia = normalizeVideoMediaSnapshots(targetStoreValues?.videoMedia)
        const currentVideoMedia =
          storedVideoMedia.length > 0
            ? storedVideoMedia
            : normalizeVideoMediaSnapshots(targetBlock.subBlocks?.videoMedia?.value)

        const nextVideoMedia = removeVideoMediaFileForType(
          currentVideoMedia,
          autoLinkType === 'video_first_frame' ? 'first_frame' : 'last_frame'
        )

        collaborativeSetSubblockValue(videoBlockId, 'videoMedia', nextVideoMedia)

        const nextReferences = getCurrentContentReferences(videoBlockId).filter(
          (reference) =>
            reference.role !==
            (autoLinkType === 'video_first_frame' ? 'video_first_frame' : 'video_last_frame')
        )
        setContentReferencesForBlock(videoBlockId, nextReferences)
      },
      [
        activeWorkflowId,
        blocks,
        collaborativeSetSubblockValue,
        getCurrentContentReferences,
        setContentReferencesForBlock,
      ]
    )

    const removeContentReferenceEdgeWithSync = useCallback(
      (edgeId: string) => {
        const edge = edges.find((candidate) => candidate.id === edgeId)
        if (!edge) return

        const autoLinkType = getContentReferenceAutoLinkType(edge)
        if (autoLinkType) {
          clearVideoFrameMediaForAutoLink(edge.target, autoLinkType)
        } else {
          const nextReferences = getCurrentContentReferences(edge.source).filter(
            (reference) => reference.sourceBlockId !== edge.target
          )
          setContentReferencesForBlock(edge.source, nextReferences)
        }

        collaborativeBatchRemoveEdges([edgeId])
      },
      [
        clearVideoFrameMediaForAutoLink,
        collaborativeBatchRemoveEdges,
        edges,
        getCurrentContentReferences,
        setContentReferencesForBlock,
      ]
    )

    const replaceVideoFrameAutoReferenceEdge = useCallback(
      (videoBlockId: string, imageBlockId: string, autoLinkType: ContentReferenceAutoLinkType) => {
        const previousEdge = findAutoVideoContentReferenceEdge(edges, videoBlockId, autoLinkType)
        const sourceX = blocks[imageBlockId]?.position.x ?? 0
        const targetX = blocks[videoBlockId]?.position.x ?? sourceX
        const { sourceHandle, targetHandle } = buildContentReferenceHandles({
          sourceX,
          targetX,
        })
        const edgeToAdd = createContentReferenceEdge({
          id: generateId(),
          source: imageBlockId,
          target: videoBlockId,
          sourceHandle,
          targetHandle,
          autoLinkType,
        })

        if (previousEdge?.id) {
          collaborativeBatchRemoveEdges([previousEdge.id], { skipUndoRedo: true })
        }

        collaborativeBatchAddEdges([edgeToAdd], { skipUndoRedo: true })
      },
      [
        blocks,
        buildContentReferenceHandles,
        collaborativeBatchAddEdges,
        collaborativeBatchRemoveEdges,
        edges,
      ]
    )

    const applyVideoFrameSelection = useCallback(
      async (node: Node) => {
        if (!frameSelection) return false

        const targetBlock = blocks[frameSelection.targetBlockId]
        if (!targetBlock || targetBlock.type !== 'content') {
          clearFrameSelection()
          return true
        }

        const fileSnapshot = resolveLiveContentFileSnapshot(node.id, node)
        const variant = resolveLiveContentVariant(node.id, node, fileSnapshot)

        if (variant !== 'image') {
          toast({ message: '只能选择图片内容节点作为首帧或尾帧。', duration: 2500 })
          return true
        }

        if (!fileSnapshot?.path || !fileSnapshot.key) {
          toast.error('该图片节点缺少可用文件，无法作为首帧或尾帧。', { duration: 3000 })
          return true
        }

        const inferredAspectRatio = await inferImageAspectRatioFromUrl(fileSnapshot.path)
        if (inferredAspectRatio !== frameSelection.requiredAspectRatioPreset) {
          toast.error(
            `所选图片比例不匹配，请选择 ${frameSelection.requiredAspectRatioPreset} 图片。`,
            {
              duration: 3200,
            }
          )
          return true
        }

        const targetStoreValues = activeWorkflowId
          ? useSubBlockStore.getState().workflowValues[activeWorkflowId]?.[
              frameSelection.targetBlockId
            ]
          : undefined
        const storedVideoMedia = normalizeVideoMediaSnapshots(targetStoreValues?.videoMedia)
        const currentVideoMedia =
          storedVideoMedia.length > 0
            ? storedVideoMedia
            : normalizeVideoMediaSnapshots(targetBlock.subBlocks?.videoMedia?.value)

        const nextVideoMedia = upsertVideoMediaFile(
          currentVideoMedia,
          frameSelection.slot === 'first' ? 'first_frame' : 'last_frame',
          { ...fileSnapshot }
        )
        const nextReferences = upsertContentReference(
          getCurrentContentReferences(frameSelection.targetBlockId),
          {
            sourceBlockId: node.id,
            sourceVariant: 'image',
            role: frameSelection.slot === 'first' ? 'video_first_frame' : 'video_last_frame',
          }
        )

        collaborativeSetSubblockValue(frameSelection.targetBlockId, 'videoMedia', nextVideoMedia)
        setContentReferencesForBlock(frameSelection.targetBlockId, nextReferences)
        replaceVideoFrameAutoReferenceEdge(
          frameSelection.targetBlockId,
          node.id,
          frameSelection.slot === 'first' ? 'video_first_frame' : 'video_last_frame'
        )
        clearFrameSelection()
        toast.success(frameSelection.slot === 'first' ? '首帧已更新。' : '尾帧已更新。', {
          duration: 2200,
        })
        return true
      },
      [
        activeWorkflowId,
        blocks,
        clearFrameSelection,
        collaborativeSetSubblockValue,
        frameSelection,
        getCurrentContentReferences,
        replaceVideoFrameAutoReferenceEdge,
        resolveLiveContentFileSnapshot,
        resolveLiveContentVariant,
        setContentReferencesForBlock,
      ]
    )

    useEffect(() => {
      if (!frameSelection) return

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        clearFrameSelection()
        toast({ message: '已取消画布选帧。', duration: 2000 })
      }

      window.addEventListener('keydown', handleKeyDown, true)
      return () => {
        window.removeEventListener('keydown', handleKeyDown, true)
      }
    }, [clearFrameSelection, frameSelection])

    useEffect(() => {
      if (!contentReferenceSelection) return

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        clearContentReferenceSelection()
        toast({ message: '已取消内容连线。', duration: 2000 })
      }

      window.addEventListener('keydown', handleKeyDown, true)
      return () => {
        window.removeEventListener('keydown', handleKeyDown, true)
      }
    }, [clearContentReferenceSelection, contentReferenceSelection])

    useEffect(() => {
      const handleClearVideoFrameAutoLink = (event: Event) => {
        const detail = (
          event as CustomEvent<{ blockId?: string; autoLinkType?: ContentReferenceAutoLinkType }>
        ).detail
        if (!detail?.blockId || !detail.autoLinkType) return

        const edge = findAutoVideoContentReferenceEdge(edges, detail.blockId, detail.autoLinkType)
        if (!edge?.id) return

        collaborativeBatchRemoveEdges([edge.id], { skipUndoRedo: true })
      }

      window.addEventListener(CLEAR_VIDEO_FRAME_AUTO_LINK_EVENT, handleClearVideoFrameAutoLink)
      return () => {
        window.removeEventListener(CLEAR_VIDEO_FRAME_AUTO_LINK_EVENT, handleClearVideoFrameAutoLink)
      }
    }, [collaborativeBatchRemoveEdges, edges])

    const handleCanvasPaneClick = useCallback(() => {
      if (frameSelection) {
        toast({ message: '请选择画布中的图片节点，按 Esc 取消。', duration: 2200 })
        return
      }

      if (contentReferenceSelection) {
        clearContentReferenceSelection()
        return
      }

      setSelectedEdges(new Map())
      setContentReferenceEdgeMenu(null)
      usePanelEditorStore.getState().clearCurrentBlock()
    }, [clearContentReferenceSelection, contentReferenceSelection, frameSelection])

    /**
     * Handles node click to select the node in ReactFlow.
     * Uses the controlled display node state so parent-child conflicts are resolved
     * consistently for click, shift-click, and marquee selection.
     */
    const handleNodeClick = useCallback(
      async (event: React.MouseEvent, node: Node) => {
        if (frameSelection) {
          event.preventDefault()
          event.stopPropagation()
          await applyVideoFrameSelection(node)
          return
        }

        if (contentReferenceSelection) {
          event.preventDefault()
          event.stopPropagation()

          const targetBlock = blocks[node.id]
          if (!isContentBlockState(targetBlock)) {
            toast({ message: 'Only content nodes can be referenced.', duration: 2200 })
            return
          }

          if (node.id === contentReferenceSelection.sourceBlockId) {
            toast({ message: 'Choose a different content node to reference.', duration: 2200 })
            return
          }

          const fileSnapshot = resolveLiveContentFileSnapshot(node.id, node)
          const targetVariant = resolveLiveContentVariant(node.id, node, fileSnapshot)
          if (!targetVariant) {
            return
          }

          if (!contentReferenceSelection.allowedSourceVariants.includes(targetVariant)) {
            return
          }

          const referenceRole = getDefaultReferenceRole({
            targetVariant: contentReferenceSelection.sourceVariant,
            model: contentReferenceSelection.sourceModel,
            sourceVariant: targetVariant,
          })
          if (!referenceRole) {
            return
          }

          const nextReferences = upsertContentReference(
            getCurrentContentReferences(contentReferenceSelection.sourceBlockId),
            {
              sourceBlockId: node.id,
              sourceVariant: targetVariant,
              role: referenceRole,
            }
          )
          setContentReferencesForBlock(contentReferenceSelection.sourceBlockId, nextReferences)

          const alreadyLinked = edges.some(
            (edge) =>
              isContentReferenceEdge(edge) &&
              !getContentReferenceAutoLinkType(edge) &&
              edge.source === contentReferenceSelection.sourceBlockId &&
              edge.target === node.id
          )

          if (!alreadyLinked) {
            collaborativeBatchAddEdges([
              createContentReferenceEdge({
                id: generateId(),
                source: contentReferenceSelection.sourceBlockId,
                target: node.id,
                ...buildContentReferenceHandles({
                  sourceX: blocks[contentReferenceSelection.sourceBlockId]?.position.x ?? 0,
                  targetX: blocks[node.id]?.position.x ?? 0,
                  sourceAnchor: contentReferenceSelection.sourceAnchor,
                }),
              }),
            ])
          }

          clearContentReferenceSelection()
          return
        }

        const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey

        // Ignore shift-clicks on nodes at a different nesting level
        if (isMultiSelect) {
          const clickedContext = getNodeSelectionContextId(node, blocks)
          const currentlySelected = getNodes().filter((n) => n.selected)
          if (currentlySelected.length > 0) {
            const selectionContext = getNodeSelectionContextId(currentlySelected[0], blocks)
            if (clickedContext !== selectionContext) {
              usePanelEditorStore.getState().clearCurrentBlock()
              return
            }
          }
        }

        setDisplayNodes((currentNodes) => {
          const updated = currentNodes.map((currentNode) => ({
            ...currentNode,
            selected: isMultiSelect
              ? currentNode.id === node.id
                ? true
                : currentNode.selected
              : currentNode.id === node.id,
          }))
          return resolveSelectionConflicts(updated, blocks, isMultiSelect ? node.id : undefined)
        })
      },
      [
        applyVideoFrameSelection,
        blocks,
        buildContentReferenceHandles,
        clearContentReferenceSelection,
        collaborativeBatchAddEdges,
        contentReferenceSelection,
        edges,
        frameSelection,
        getCurrentContentReferences,
        getNodes,
        resolveLiveContentFileSnapshot,
        resolveLiveContentVariant,
        setContentReferencesForBlock,
      ]
    )

    /** Handles edge selection with container context tracking and Shift-click multi-selection. */
    const onEdgeClick = useCallback(
      (event: React.MouseEvent, edge: any) => {
        event.stopPropagation() // Prevent bubbling
        setContentReferenceEdgeMenu(null)

        const contextId = `${edge.id}${(() => {
          const selectionContextId = getEdgeSelectionContextId(edge, getNodes(), blocks)
          return selectionContextId ? `-${selectionContextId}` : ''
        })()}`

        if (event.shiftKey) {
          // Shift-click: toggle edge in selection
          setSelectedEdges((prev) => {
            const next = new Map(prev)
            if (next.has(contextId)) {
              next.delete(contextId)
            } else {
              next.set(contextId, edge.id)
            }
            return next
          })
        } else {
          // Normal click: replace selection with this edge
          setSelectedEdges(new Map([[contextId, edge.id]]))
        }
      },
      [blocks, getNodes]
    )

    const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: Edge) => {
      if (!isContentReferenceEdge(edge)) {
        setContentReferenceEdgeMenu(null)
        return
      }

      event.preventDefault()
      event.stopPropagation()
      setSelectedEdges(new Map([[edge.id, edge.id]]))
      setContentReferenceEdgeMenu({
        edgeId: edge.id,
        x: event.clientX,
        y: event.clientY,
      })
    }, [])

    useEffect(() => {
      if (!contentReferenceEdgeMenu) return

      const handlePointerDown = () => {
        setContentReferenceEdgeMenu(null)
      }

      window.addEventListener('pointerdown', handlePointerDown)
      return () => {
        window.removeEventListener('pointerdown', handlePointerDown)
      }
    }, [contentReferenceEdgeMenu])

    /** Stable delete handler to avoid creating new function references per edge. */
    const handleEdgeDelete = useCallback(
      (edgeId: string) => {
        // Prevent removing edges targeting protected blocks
        const edge = edges.find((e) => e.id === edgeId)
        if (edge && isEdgeProtected(edge, blocks)) {
          addNotification({
            level: 'info',
            message: 'Cannot remove connections to locked blocks',
            workflowId: activeWorkflowId || undefined,
          })
          return
        }
        removeContentReferenceEdgeWithSync(edgeId)
        // Remove this edge from selection (find by edge ID value)
        setSelectedEdges((prev) => {
          const next = new Map(prev)
          for (const [contextId, id] of next) {
            if (id === edgeId) {
              next.delete(contextId)
            }
          }
          return next
        })
        setContentReferenceEdgeMenu((current) => (current?.edgeId === edgeId ? null : current))
      },
      [removeContentReferenceEdgeWithSync, edges, blocks, addNotification, activeWorkflowId]
    )

    // Elevate nodes using React Flow's native zIndex so selected/recent blocks
    // always sit above edges and other blocks.
    //
    // Z-index layers (regular blocks):
    //   21 - default
    //   22 - last interacted (dragged/selected, now deselected) so it stays on
    //        top of siblings until another block is touched
    //   31 - currently selected (above connected edges at z-22 and handles at z-30)
    //
    // Subflow container nodes are skipped - they use depth-based zIndex for
    // correct parent/child layering and must not be bumped.
    // Child blocks inside containers already carry zIndex 1000 and are bumped by
    // +10 when selected so they stay above their sibling child blocks.
    const nodesForRender = useMemo(() => {
      return displayNodes.map((node) => {
        if (node.type === 'subflowNode') return node
        const base = node.zIndex ?? 21
        const target = node.selected
          ? base + 10
          : node.id === lastInteractedNodeId
            ? Math.max(base + 1, 22)
            : base
        if (target === (node.zIndex ?? 21)) return node
        return { ...node, zIndex: target }
      })
    }, [displayNodes, lastInteractedNodeId])

    /** Transforms edges to include selection state and delete handlers. Memoized to prevent re-renders. */
    const edgesWithSelection = useMemo(() => {
      const nodeMap = new Map(displayNodes.map((n) => [n.id, n]))
      const elevatedNodeIdSet = new Set(
        lastInteractedNodeId ? [...selectedNodeIds, lastInteractedNodeId] : selectedNodeIds
      )

      return edgesForDisplay.map((edge) => {
        const sourceNode = nodeMap.get(edge.source)
        const targetNode = nodeMap.get(edge.target)
        const parentLoopId = sourceNode?.parentId || targetNode?.parentId
        const edgeContextId = `${edge.id}${parentLoopId ? `-${parentLoopId}` : ''}`
        const connectedToElevated =
          elevatedNodeIdSet.has(edge.source) || elevatedNodeIdSet.has(edge.target)
        // Derive elevated z-index from connected nodes so edges inside subflows
        // (child nodes at z-1000) stay above their sibling child blocks.
        const elevatedZIndex = Math.max(
          22,
          (sourceNode?.zIndex ?? 21) + 1,
          (targetNode?.zIndex ?? 21) + 1
        )

        // Edges inside subflows need a z-index above the container's body area
        // (which has pointer-events: auto) so they're directly clickable.
        // Derive from the container's depth-based zIndex (+1) so the edge sits
        // just above its parent container but below canvas blocks (z-21+) and
        // child blocks (z-1000).
        const containerNode = parentLoopId ? nodeMap.get(parentLoopId) : null
        const baseZIndex = containerNode ? (containerNode.zIndex ?? 0) + 1 : 0

        return {
          ...edge,
          zIndex: connectedToElevated ? elevatedZIndex : baseZIndex,
          data: {
            ...edge.data,
            isContentReference: isContentReferenceEdge(edge),
            isSelected: selectedEdges.has(edgeContextId),
            isInsideLoop: Boolean(parentLoopId),
            parentLoopId,
            sourceHandle: edge.sourceHandle,
            onDelete: handleEdgeDelete,
          },
        }
      })
    }, [
      edgesForDisplay,
      displayNodes,
      selectedNodeIds,
      selectedEdges,
      handleEdgeDelete,
      lastInteractedNodeId,
    ])

    /** Handles Delete/Backspace to remove selected edges or blocks. */
    useEffect(() => {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Delete' && event.key !== 'Backspace') {
          return
        }

        // Ignore when typing/navigating inside editable inputs or editors
        if (isInEditableElement()) {
          return
        }

        // Handle edge deletion first (edges take priority if selected)
        if (selectedEdges.size > 0) {
          // Get all selected edge IDs and filter out edges targeting protected blocks
          const edgeIds = Array.from(selectedEdges.values()).filter((edgeId) => {
            const edge = edges.find((e) => e.id === edgeId)
            if (!edge) return true
            return !isEdgeProtected(edge, blocks)
          })
          if (edgeIds.length > 0) {
            edgeIds.forEach((edgeId) => {
              removeContentReferenceEdgeWithSync(edgeId)
            })
          }
          setSelectedEdges(new Map())
          setContentReferenceEdgeMenu(null)
          return
        }

        // Handle block deletion
        if (!effectivePermissions.canEdit) {
          return
        }

        const selectedNodes = getNodes().filter((node) => node.selected)
        if (selectedNodes.length === 0) {
          return
        }

        event.preventDefault()
        const selectedIds = selectedNodes.map((node) => node.id)
        const { deletableIds, protectedIds, allProtected } = filterProtectedBlocks(
          selectedIds,
          blocks
        )

        if (protectedIds.length > 0) {
          if (allProtected) {
            addNotification({
              level: 'info',
              message: 'Cannot delete locked blocks or blocks inside locked containers',
              workflowId: activeWorkflowId || undefined,
            })
            return
          }
          addNotification({
            level: 'info',
            message: `Skipped ${protectedIds.length} protected block(s)`,
            workflowId: activeWorkflowId || undefined,
          })
        }
        if (deletableIds.length > 0) {
          collaborativeBatchRemoveBlocks(deletableIds)
        }
      }

      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }, [
      selectedEdges,
      collaborativeBatchRemoveEdges,
      getNodes,
      collaborativeBatchRemoveBlocks,
      effectivePermissions.canEdit,
      blocks,
      edges,
      addNotification,
      activeWorkflowId,
      removeContentReferenceEdgeWithSync,
    ])

    useEffect(() => {
      if (!embedded || !isWorkflowReady) {
        return
      }

      const container = canvasContainerRef.current
      if (!container) {
        return
      }

      scheduleEmbeddedFit()

      const resizeObserver = new ResizeObserver(() => {
        scheduleEmbeddedFit()
      })

      resizeObserver.observe(container)

      return () => {
        resizeObserver.disconnect()

        if (embeddedFitFrameRef.current !== null) {
          cancelAnimationFrame(embeddedFitFrameRef.current)
          embeddedFitFrameRef.current = null
        }
      }
    }, [embedded, isWorkflowReady, scheduleEmbeddedFit])

    useEffect(() => {
      if (!embedded || !isWorkflowReady) {
        return
      }

      scheduleEmbeddedFit()
    }, [blocksStructureHash, embedded, isWorkflowReady, scheduleEmbeddedFit])

    const shouldRenderEditorPanel = embedded || sandbox || isHeavyEditorChromeLoaded
    const shouldRenderAuxiliaryEditorChrome = !IS_LOW_MEMORY_DEV || embedded || sandbox

    return (
      <div className='flex h-full w-full overflow-hidden'>
        <div className='flex min-w-0 flex-1 flex-col'>
          <div
            ref={canvasContainerRef}
            className='relative flex-1 overflow-hidden'
            data-tour='canvas'
          >
            {!isWorkflowReady && (
              <div className='absolute inset-0 z-[5] flex items-center justify-center bg-[var(--bg)]'>
                <div
                  className='h-[18px] w-[18px] animate-spin rounded-full'
                  style={{
                    background:
                      'conic-gradient(from 0deg, hsl(var(--muted-foreground)) 0deg 120deg, transparent 120deg 180deg, hsl(var(--muted-foreground)) 180deg 300deg, transparent 300deg 360deg)',
                    mask: 'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
                    WebkitMask:
                      'radial-gradient(farthest-side, transparent calc(100% - 1.5px), black calc(100% - 1.5px))',
                  }}
                />
              </div>
            )}

            {isWorkflowReady && (
              <>
                {!embedded && workflowMetadata && shouldRenderAuxiliaryEditorChrome && (
                  <Suspense fallback={null}>
                    <LazyWorkflowTrackBar
                      workspaceId={workspaceId}
                      workflowId={workflowIdParam}
                      workflow={workflowMetadata}
                      canPublish={canPublishToMainline}
                      organizationId={workspaceSettingsData?.settings.workspace.organizationId}
                      activeWorkgroupId={activeWorkgroupId}
                      onNotify={notifyTrackAction}
                    />
                  </Suspense>
                )}

                {!embedded && !sandbox && shouldRenderAuxiliaryEditorChrome && (
                  <ProductionTaskTimeline workspaceId={workspaceId} workflowId={workflowIdParam} />
                )}

                <ReactFlow
                  nodes={nodesForRender}
                  edges={edgesWithSelection}
                  onNodesChange={onNodesChange}
                  onEdgesChange={onEdgesChange}
                  onConnect={!embedded && effectivePermissions.canEdit ? onConnect : undefined}
                  onConnectStart={
                    !embedded && effectivePermissions.canEdit ? onConnectStart : undefined
                  }
                  onConnectEnd={
                    !embedded && effectivePermissions.canEdit ? onConnectEnd : undefined
                  }
                  nodeTypes={nodeTypesForRender}
                  edgeTypes={edgeTypesForRender}
                  onMouseDown={handleCanvasMouseDown}
                  onDrop={
                    effectivePermissions.canEdit
                      ? onDrop
                      : workflowReadOnly || workflowTrackReadOnly
                        ? onDropLocked
                        : undefined
                  }
                  onDragOver={
                    effectivePermissions.canEdit || workflowReadOnly || workflowTrackReadOnly
                      ? onDragOver
                      : undefined
                  }
                  onInit={(instance) => {
                    if (embedded) {
                      return
                    }

                    requestAnimationFrame(() => {
                      instance.fitView(reactFlowFitViewOptions)
                      setIsCanvasReady(true)
                    })
                  }}
                  fitViewOptions={embedded ? embeddedFitViewOptions : reactFlowFitViewOptions}
                  minZoom={0.1}
                  maxZoom={1.3}
                  panOnScroll
                  defaultEdgeOptions={defaultEdgeOptions}
                  proOptions={reactFlowProOptions}
                  connectionLineStyle={connectionLineStyle}
                  connectionLineType={ConnectionLineType.SmoothStep}
                  onPaneClick={handleCanvasPaneClick}
                  onEdgeClick={embedded ? undefined : onEdgeClick}
                  onEdgeContextMenu={embedded ? undefined : onEdgeContextMenu}
                  onNodeClick={handleNodeClick}
                  onPaneContextMenu={handlePaneContextMenu}
                  onNodeContextMenu={handleNodeContextMenu}
                  onSelectionContextMenu={handleSelectionContextMenu}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerLeave={handleCanvasPointerLeave}
                  elementsSelectable={!embedded && !frameSelection && !contentReferenceSelection}
                  selectionOnDrag={embedded ? false : selectionProps.selectionOnDrag}
                  selectionMode={SelectionMode.Partial}
                  panOnDrag={embedded ? true : selectionProps.panOnDrag}
                  selectionKeyCode={embedded ? null : selectionProps.selectionKeyCode}
                  multiSelectionKeyCode={embedded ? null : ['Meta', 'Control', 'Shift']}
                  nodesConnectable={
                    !embedded &&
                    effectivePermissions.canEdit &&
                    !frameSelection &&
                    !contentReferenceSelection
                  }
                  nodesDraggable={
                    !embedded &&
                    effectivePermissions.canEdit &&
                    !frameSelection &&
                    !contentReferenceSelection
                  }
                  draggable={false}
                  noWheelClassName='allow-scroll'
                  edgesFocusable={!embedded && !frameSelection && !contentReferenceSelection}
                  edgesUpdatable={
                    !embedded &&
                    effectivePermissions.canEdit &&
                    !frameSelection &&
                    !contentReferenceSelection
                  }
                  className={`workflow-container h-full bg-[var(--bg)] transition-opacity duration-150 ${reactFlowStyles} ${canvasOpacityClass} ${isHandMode ? 'canvas-mode-hand' : 'canvas-mode-cursor'}`}
                  onNodeDrag={effectivePermissions.canEdit ? onNodeDrag : undefined}
                  onNodeDragStop={effectivePermissions.canEdit ? onNodeDragStop : undefined}
                  onSelectionDragStart={
                    effectivePermissions.canEdit ? onSelectionDragStart : undefined
                  }
                  onSelectionDrag={effectivePermissions.canEdit ? onSelectionDrag : undefined}
                  onSelectionDragStop={
                    effectivePermissions.canEdit ? onSelectionDragStop : undefined
                  }
                  onNodeDragStart={effectivePermissions.canEdit ? onNodeDragStart : undefined}
                  snapToGrid={snapToGrid}
                  snapGrid={snapGrid}
                  elevateEdgesOnSelect={false}
                  onlyRenderVisibleElements={false}
                  deleteKeyCode={null}
                  elevateNodesOnSelect={false}
                  autoPanOnConnect={effectivePermissions.canEdit}
                  autoPanOnNodeDrag={effectivePermissions.canEdit}
                />

                {(contentReferenceSelection || frameSelection) && !embedded && (
                  <div className='pointer-events-none fixed top-5 left-1/2 z-[1150] -translate-x-1/2'>
                    <div className='rounded-2xl border border-white/10 bg-[#11161F]/95 px-4 py-3 text-white shadow-2xl backdrop-blur'>
                      <div className='font-medium text-sm'>
                        {frameSelection ? '正在选择视频参考帧' : '正在选择引用节点'}
                      </div>
                      <div className='mt-1 text-[12px] text-white/75'>
                        {frameSelection
                          ? `请点击一张图片作为${frameSelection.slot === 'first' ? '首帧' : '尾帧'}，按 Esc 取消。`
                          : '请点击画布上可引用的节点完成添加，按 Esc 取消。'}
                      </div>
                    </div>
                  </div>
                )}

                <Cursors />

                {!embedded && (
                  <>
                    {contentReferenceEdgeMenu && (
                      <div
                        className='fixed z-[1200]'
                        style={{
                          left: contentReferenceEdgeMenu.x,
                          top: contentReferenceEdgeMenu.y,
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation()
                        }}
                      >
                        <button
                          type='button'
                          className='flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[var(--text-primary)] text-xs shadow-lg hover-hover:bg-[var(--surface-3)]'
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            handleEdgeDelete(contentReferenceEdgeMenu.edgeId)
                          }}
                        >
                          <Scissors className='h-3.5 w-3.5 text-[var(--text-error)]' />
                          <span>删除连线</span>
                        </button>
                      </div>
                    )}

                    {!IS_LOW_MEMORY_DEV && (
                      <Suspense fallback={null}>
                        <LazyWorkflowControls />
                      </Suspense>
                    )}
                    {shouldRenderAuxiliaryEditorChrome && (
                      <Suspense fallback={null}>
                        <LazyChat />
                      </Suspense>
                    )}

                    <BlockMenu
                      isOpen={isBlockMenuOpen}
                      position={contextMenuPosition}
                      menuRef={contextMenuRef}
                      onClose={closeContextMenu}
                      selectedBlocks={contextMenuBlocks}
                      onCopy={handleContextCopy}
                      onCut={handleContextCut}
                      onPaste={handleContextPaste}
                      onDuplicate={handleContextDuplicate}
                      onCopyToCanvas={handleContextCopyToCanvas}
                      onDelete={handleContextDelete}
                      onToggleEnabled={handleContextToggleEnabled}
                      onToggleHandles={handleContextToggleHandles}
                      onRemoveFromSubflow={handleContextRemoveFromSubflow}
                      onOpenEditor={handleContextOpenEditor}
                      onRename={handleContextRename}
                      onRunFromBlock={handleContextRunFromBlock}
                      onRunUntilBlock={handleContextRunUntilBlock}
                      hasClipboard={hasClipboard()}
                      showRemoveFromSubflow={contextMenuBlocks.some(
                        (b) =>
                          b.parentId && (b.parentType === 'loop' || b.parentType === 'parallel')
                      )}
                      canRunFromBlock={runFromBlockState.canRun}
                      canCopyToCanvas={canCopySelectionToCanvas}
                      copyToCanvasLabel={copyTargetDescriptor?.label}
                      copyToCanvasDisabledReason={copyToCanvasDisabledReason}
                      isCopyingToCanvas={isCopyingSelection}
                      disableEdit={
                        !effectivePermissions.canEdit ||
                        contextMenuBlocks.some((b) => b.locked || b.isParentLocked)
                      }
                      userCanEdit={effectivePermissions.canEdit}
                      isExecuting={isExecuting}
                      isPositionalTrigger={
                        contextMenuBlocks.length === 1 &&
                        edges.filter((e) => e.target === contextMenuBlocks[0]?.id).length === 0
                      }
                      onToggleLocked={handleContextToggleLocked}
                      canAdmin={
                        effectivePermissions.canAdmin &&
                        !(workflowReadOnly || workflowTrackReadOnly)
                      }
                    />

                    <CanvasMenu
                      isOpen={isPaneMenuOpen}
                      position={contextMenuPosition}
                      menuRef={contextMenuRef}
                      onClose={closeContextMenu}
                      onUndo={undo}
                      onRedo={redo}
                      onPaste={handleContextPaste}
                      onAddContentNode={handleContextAddContentNode}
                      onAutoLayout={handleAutoLayout}
                      onFitToView={() => fitViewToBounds({ padding: 0.1, duration: 300 })}
                      onOpenLogs={handleContextOpenLogs}
                      onOpenSearchReplace={handleContextOpenSearchReplace}
                      onToggleVariables={handleContextToggleVariables}
                      onToggleChat={handleContextToggleChat}
                      isVariablesOpen={isVariablesOpen}
                      isChatOpen={isChatOpen}
                      hasClipboard={hasClipboard()}
                      disableEdit={!effectivePermissions.canEdit}
                      canUndo={canUndo}
                      canRedo={canRedo}
                      hasLockedBlocks={hasLockedBlocks}
                      onToggleWorkflowLock={handleToggleWorkflowLock}
                      allBlocksLocked={allBlocksLocked}
                      canAdmin={
                        effectivePermissions.canAdmin &&
                        !(workflowReadOnly || workflowTrackReadOnly)
                      }
                      hasBlocks={hasBlocks}
                    />
                  </>
                )}
              </>
            )}

            <Notifications embedded={embedded} />
            {!embedded && isWorkflowSearchReplaceOpen && (
              <Suspense fallback={null}>
                <LazyWorkflowSearchReplace />
              </Suspense>
            )}

            {!embedded &&
              isWorkflowReady &&
              isWorkflowEmpty &&
              effectivePermissions.canEdit &&
              shouldRenderAuxiliaryEditorChrome && (
                <Suspense fallback={null}>
                  <LazyCommandList />
                </Suspense>
              )}

            {!embedded && shouldRenderAuxiliaryEditorChrome && (
              <Suspense fallback={null}>
                <LazyDiffControls />
              </Suspense>
            )}
          </div>

          {shouldRenderAuxiliaryEditorChrome && (
            <Suspense fallback={null}>
              <LazyTerminal />
            </Suspense>
          )}
        </div>

        {!embedded && IS_LOW_MEMORY_DEV && !isHeavyEditorChromeLoaded && (
          <button
            type='button'
            className='absolute top-3 right-3 z-20 rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2 text-[12px] text-[var(--text-muted)] shadow-sm'
            onClick={() => {
              usePanelStore.getState().setActiveTab('toolbar')
              setIsHeavyEditorChromeLoaded(true)
            }}
          >
            Load editor panels
          </button>
        )}

        {(!embedded || sandbox) && shouldRenderEditorPanel && (
          <Suspense fallback={null}>
            <LazyPanel workspaceId={sandbox ? workspaceId : undefined} />
          </Suspense>
        )}

        {!embedded && !sandbox && oauthModal && (
          <OAuthModal
            mode='reauthorize'
            isOpen={true}
            onClose={() => {
              consumeOAuthReturnContext()
              setOauthModal(null)
            }}
            provider={oauthModal.provider}
            toolName={oauthModal.providerName}
            serviceId={oauthModal.serviceId}
            requiredScopes={oauthModal.requiredScopes}
            newScopes={oauthModal.newScopes}
          />
        )}
      </div>
    )
  }
)

WorkflowContent.displayName = 'WorkflowContent'

interface WorkflowProps {
  workspaceId?: string
  workflowId?: string
  embedded?: boolean
  /** Sandbox mode: full editing enabled but no workspace API calls (used by Sim Academy). */
  sandbox?: boolean
}

/** Workflow page with ReactFlowProvider and error boundary wrapper. */
const Workflow = React.memo(
  ({ workspaceId, workflowId, embedded, sandbox }: WorkflowProps = {}) => {
    return (
      <ReactFlowProvider>
        <ErrorBoundary>
          <WorkflowContent
            workspaceId={workspaceId}
            workflowId={workflowId}
            embedded={embedded}
            sandbox={sandbox}
          />
        </ErrorBoundary>
      </ReactFlowProvider>
    )
  }
)

Workflow.displayName = 'Workflow'

export default Workflow
