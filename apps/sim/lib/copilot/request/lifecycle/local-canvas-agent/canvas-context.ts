import { getCanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters'
import { getValue } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import type {
  CanvasNodeDetail,
  CanvasNodeRecord,
  CanvasNodeSummary,
  CanvasSnapshot,
  LocalCanvasNodeKind,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import { getContentNodePresetForBlockType } from '@/lib/product/content-node-presets'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/persistence/utils'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function inferContentKind(values: Record<string, unknown>): LocalCanvasNodeKind {
  const variant = getValue<string>(values, 'contentVariant', 'text')
  if (variant === 'text' || variant === 'image' || variant === 'video' || variant === 'audio') {
    return variant
  }
  if (variant === 'document' || variant === 'table' || variant === 'image_editor') {
    return variant
  }
  return 'generic_workflow_block'
}

function inferNodeKind(blockType: string, values: Record<string, unknown>): LocalCanvasNodeKind {
  if (blockType === 'content') return inferContentKind(values)
  const preset = getContentNodePresetForBlockType(blockType)
  return preset?.id ?? 'generic_workflow_block'
}

function normalizeBlock(id: string, rawBlock: unknown): CanvasNodeRecord | null {
  const block = asRecord(rawBlock)
  const type = typeof block.type === 'string' ? block.type : ''
  if (!type) return null
  const rawPosition = asRecord(block.position)
  const values = asRecord(block.subBlocks)
  const extractedValues = Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const subBlock = asRecord(value)
      return [key, 'value' in subBlock ? subBlock.value : value]
    })
  )
  return {
    id,
    name: typeof block.name === 'string' ? block.name : id,
    blockType: type,
    kind: inferNodeKind(type, extractedValues),
    position: {
      x: asNumber(rawPosition.x, 0),
      y: asNumber(rawPosition.y, 0),
    },
    values: extractedValues,
    raw: block,
  }
}

export async function loadCanvasSnapshot(params: {
  workflowId: string
  workspaceId: string
}): Promise<CanvasSnapshot> {
  const normalized = await loadWorkflowFromNormalizedTables(params.workflowId)
  const blocks = asRecord(normalized?.blocks)
  const edges = Array.isArray(normalized?.edges) ? normalized.edges : []
  return {
    workflowId: params.workflowId,
    workspaceId: params.workspaceId,
    nodes: Object.entries(blocks)
      .map(([id, block]) => normalizeBlock(id, block))
      .filter((node): node is CanvasNodeRecord => Boolean(node)),
    edges: edges.flatMap((edge) => {
      const record = asRecord(edge)
      const source = typeof record.source === 'string' ? record.source : ''
      const target = typeof record.target === 'string' ? record.target : ''
      if (!source || !target) return []
      return [
        {
          source,
          target,
          ...(typeof record.sourceHandle === 'string' ? { sourceHandle: record.sourceHandle } : {}),
          ...(typeof record.targetHandle === 'string' ? { targetHandle: record.targetHandle } : {}),
        },
      ]
    }),
  }
}

export function summarizeCanvas(
  snapshot: CanvasSnapshot,
  selectedNodeIds: string[]
): CanvasNodeSummary[] {
  const selectedSet = new Set(selectedNodeIds)
  return snapshot.nodes.map((node) =>
    getCanvasNodeAdapter(node.kind).summarize(node, selectedSet.has(node.id))
  )
}

export function readCanvasNodeDetail(
  snapshot: CanvasSnapshot,
  nodeId: string,
  selectedNodeIds: string[]
): CanvasNodeDetail | null {
  const node = snapshot.nodes.find((item) => item.id === nodeId)
  if (!node) return null
  return getCanvasNodeAdapter(node.kind).readDetail(node, selectedNodeIds.includes(node.id))
}

export function searchCanvasNodes(params: {
  snapshot: CanvasSnapshot
  query: string
  selectedNodeIds: string[]
}): CanvasNodeSummary[] {
  const normalizedQuery = params.query.trim().toLowerCase()
  if (!normalizedQuery) return summarizeCanvas(params.snapshot, params.selectedNodeIds)
  const quotedTerms = [...params.query.matchAll(/[“"']([^”"']{2,})[”"']/g)]
    .map((match) => match[1]?.trim().toLowerCase())
    .filter((term): term is string => Boolean(term))
  const fallbackTerms = normalizedQuery
    .split(/[\s,，。！？!?：:；;、]+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .filter(
      (term) =>
        ![
          '找到',
          '包含',
          '节点',
          '并说明',
          '连接',
          '到了',
          '哪里',
          '当前',
          '画布',
          '搜索',
          '找出',
        ].includes(term)
    )
  const terms = quotedTerms.length ? quotedTerms : fallbackTerms
  const summaries = summarizeCanvas(params.snapshot, params.selectedNodeIds)
  const rawById = new Map(params.snapshot.nodes.map((node) => [node.id, node]))
  return summaries.filter((node) => {
    const raw = rawById.get(node.id)
    const searchable = [
      node.id,
      node.name,
      node.kind,
      node.summary,
      raw ? JSON.stringify(raw.values) : '',
    ]
      .join(' ')
      .toLowerCase()
    return terms.some((term) => searchable.includes(term))
  })
}

export function buildCanvasSummaryText(
  snapshot: CanvasSnapshot,
  selectedNodeIds: string[]
): string {
  const nodes = summarizeCanvas(snapshot, selectedNodeIds)
  const nodeLines = nodes.map(
    (node) =>
      `- ${node.id} "${node.name}" kind=${node.kind} selected=${node.selected} summary=${node.summary.slice(0, 200)}`
  )
  const edgeLines = snapshot.edges.map((edge) => `- ${edge.source} -> ${edge.target}`)
  return [
    `Workflow ${snapshot.workflowId} has ${nodes.length} nodes and ${snapshot.edges.length} edges.`,
    'Nodes:',
    ...(nodeLines.length ? nodeLines : ['- none']),
    'Edges:',
    ...(edgeLines.length ? edgeLines : ['- none']),
  ].join('\n')
}
