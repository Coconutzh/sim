import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { memory } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
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

export interface CanvasSummaryCache {
  version: 1
  workspaceId: string
  workflowId: string
  workflowHash: string
  nodeCount: number
  edgeCount: number
  nodes: CanvasNodeSummary[]
  edges: CanvasSnapshot['edges']
  summaryText: string
  updatedAt: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function asNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`
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

export function buildCanvasSnapshotHash(snapshot: CanvasSnapshot): string {
  return createHash('sha256')
    .update(
      stableStringify({
        workflowId: snapshot.workflowId,
        workspaceId: snapshot.workspaceId,
        nodes: snapshot.nodes.map((node) => ({
          id: node.id,
          name: node.name,
          blockType: node.blockType,
          kind: node.kind,
          position: node.position,
          values: node.values,
        })),
        edges: snapshot.edges,
      })
    )
    .digest('hex')
}

export function buildLocalCanvasSummaryCacheKey(params: {
  workspaceId: string
  workflowId: string
  workflowHash: string
}): string {
  return [
    'local-canvas-agent',
    'v2',
    'canvas-summary',
    params.workspaceId,
    params.workflowId,
    params.workflowHash,
  ].join(':')
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
  return buildCanvasSummaryTextFromParts({
    workflowId: snapshot.workflowId,
    nodes,
    edges: snapshot.edges,
  })
}

export function buildCanvasSummaryTextFromParts(params: {
  workflowId: string
  nodes: CanvasNodeSummary[]
  edges: CanvasSnapshot['edges']
}): string {
  const nodeLines = params.nodes.map(
    (node) =>
      `- ${node.id} "${node.name}" kind=${node.kind} selected=${node.selected} summary=${node.summary.slice(0, 200)}`
  )
  const edgeLines = params.edges.map((edge) => `- ${edge.source} -> ${edge.target}`)
  return [
    `Workflow ${params.workflowId} has ${params.nodes.length} nodes and ${params.edges.length} edges.`,
    'Nodes:',
    ...(nodeLines.length ? nodeLines : ['- none']),
    'Edges:',
    ...(edgeLines.length ? edgeLines : ['- none']),
  ].join('\n')
}

function buildCanvasSummaryCache(snapshot: CanvasSnapshot): CanvasSummaryCache {
  const nodes = summarizeCanvas(snapshot, [])
  const workflowHash = buildCanvasSnapshotHash(snapshot)
  return {
    version: 1,
    workspaceId: snapshot.workspaceId,
    workflowId: snapshot.workflowId,
    workflowHash,
    nodeCount: nodes.length,
    edgeCount: snapshot.edges.length,
    nodes,
    edges: snapshot.edges,
    summaryText: buildCanvasSummaryTextFromParts({
      workflowId: snapshot.workflowId,
      nodes,
      edges: snapshot.edges,
    }),
    updatedAt: new Date().toISOString(),
  }
}

function parseCanvasSummaryCache(value: unknown): CanvasSummaryCache | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<CanvasSummaryCache>
  if (
    record.version !== 1 ||
    typeof record.workspaceId !== 'string' ||
    typeof record.workflowId !== 'string' ||
    typeof record.workflowHash !== 'string' ||
    !Array.isArray(record.nodes) ||
    !Array.isArray(record.edges) ||
    typeof record.summaryText !== 'string' ||
    typeof record.updatedAt !== 'string'
  ) {
    return null
  }
  return {
    version: 1,
    workspaceId: record.workspaceId,
    workflowId: record.workflowId,
    workflowHash: record.workflowHash,
    nodeCount: typeof record.nodeCount === 'number' ? record.nodeCount : record.nodes.length,
    edgeCount: typeof record.edgeCount === 'number' ? record.edgeCount : record.edges.length,
    nodes: record.nodes,
    edges: record.edges,
    summaryText: record.summaryText,
    updatedAt: record.updatedAt,
  }
}

export function applyCanvasSummaryCacheSelection(
  cache: CanvasSummaryCache,
  selectedNodeIds: string[]
): CanvasNodeSummary[] {
  const selected = new Set(selectedNodeIds)
  return cache.nodes.map((node) => ({ ...node, selected: selected.has(node.id) }))
}

export async function loadOrCreateCanvasSummaryCache(
  snapshot: CanvasSnapshot
): Promise<CanvasSummaryCache> {
  const workflowHash = buildCanvasSnapshotHash(snapshot)
  const summary = buildCanvasSummaryCache(snapshot)
  const key = buildLocalCanvasSummaryCacheKey({
    workspaceId: snapshot.workspaceId,
    workflowId: snapshot.workflowId,
    workflowHash,
  })
  try {
    const [row] = await db
      .select({ data: memory.data })
      .from(memory)
      .where(
        and(
          eq(memory.workspaceId, snapshot.workspaceId),
          eq(memory.key, key),
          isNull(memory.deletedAt)
        )
      )
      .limit(1)
    const cached = parseCanvasSummaryCache(row?.data)
    if (cached?.workflowHash === workflowHash) return cached
    const now = new Date()
    await db
      .insert(memory)
      .values({
        id: generateId(),
        workspaceId: snapshot.workspaceId,
        key,
        data: summary,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [memory.workspaceId, memory.key],
        set: {
          data: sql`${JSON.stringify(summary)}::jsonb`,
          updatedAt: now,
          deletedAt: null,
        },
      })
  } catch {
    return summary
  }
  return summary
}
