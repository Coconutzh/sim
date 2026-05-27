'use client'

import type { EdgeProps, EdgeTypes, NodeProps, NodeTypes } from 'reactflow'
import { getBezierPath, Handle, Position } from 'reactflow'

function getNodeLabel(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const record = data as Record<string, unknown>
  const directName = record.name
  if (typeof directName === 'string' && directName.trim()) return directName
  const config = record.config
  if (config && typeof config === 'object') {
    const configName = (config as Record<string, unknown>).name
    if (typeof configName === 'string' && configName.trim()) return configName
  }
  const type = record.type
  if (typeof type === 'string' && type.trim()) return type
  return fallback
}

function LiteNode({ data, selected }: NodeProps) {
  const label = getNodeLabel(data, 'Block')
  return (
    <div
      className={[
        'min-w-[180px] rounded-[10px] border bg-[var(--surface-1)] px-3 py-2 shadow-sm',
        selected ? 'border-[var(--brand-primary)]' : 'border-[var(--border)]',
      ].join(' ')}
    >
      <Handle type='target' position={Position.Left} className='!h-3 !w-2 !border-0' />
      <div className='truncate font-medium text-[13px] text-[var(--text-primary)]'>{label}</div>
      <div className='mt-1 text-[11px] text-[var(--text-tertiary)]'>Lite preview</div>
      <Handle type='source' position={Position.Right} className='!h-3 !w-2 !border-0' />
    </div>
  )
}

function LiteSubflowNode({ data, selected }: NodeProps) {
  const label = getNodeLabel(data, 'Subflow')
  return (
    <div
      className={[
        'min-h-[160px] min-w-[260px] rounded-[12px] border border-dashed bg-[var(--surface-1)]/70 p-3',
        selected ? 'border-[var(--brand-primary)]' : 'border-[var(--border)]',
      ].join(' ')}
    >
      <Handle type='target' position={Position.Left} className='!h-3 !w-2 !border-0' />
      <div className='font-medium text-[13px] text-[var(--text-primary)]'>{label}</div>
      <div className='mt-1 text-[11px] text-[var(--text-tertiary)]'>Lite subflow preview</div>
      <Handle type='source' position={Position.Right} className='!h-3 !w-2 !border-0' />
    </div>
  )
}

function LiteEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  return (
    <path
      id={id}
      d={edgePath}
      className='react-flow__edge-path fill-none stroke-[var(--workflow-edge)]'
    />
  )
}

export const liteNodeTypes: NodeTypes = {
  workflowBlock: LiteNode,
  noteBlock: LiteNode,
  contentBlock: LiteNode,
  subflowNode: LiteSubflowNode,
}

export const liteEdgeTypes: EdgeTypes = {
  custom: LiteEdge,
  default: LiteEdge,
  workflowEdge: LiteEdge,
}
