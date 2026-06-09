import type {
  CanvasNodeAdapter,
  CanvasNodeCapabilities,
  CanvasNodeDetail,
  CanvasNodeRecord,
  CanvasNodeSummary,
  CanvasPatchValidationResult,
  LocalCanvasCreateNodeOperation,
  LocalCanvasNodeKind,
  LocalCanvasPatchOperation,
  LocalCanvasUpdateNodeOperation,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'
import type { EditWorkflowOperation } from '@/lib/copilot/tools/server/workflow/edit-workflow/types'
import { getContentNodePreset } from '@/lib/product/content-node-presets'

export const READONLY_CAPABILITIES: CanvasNodeCapabilities = {
  canRead: true,
  canWrite: false,
  canGenerate: false,
  canReferenceFile: false,
}

export function stripHtml(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getValue<T>(values: Record<string, unknown>, key: string, fallback: T): T {
  const raw = values[key]
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return ((raw as { value?: T }).value ?? fallback) as T
  }
  return (raw ?? fallback) as T
}

export function getObjectValue<T extends object>(
  values: Record<string, unknown>,
  key: string,
  fallback: T
): T {
  const raw = getValue<unknown>(values, key, fallback)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as T
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as T
    } catch {}
  }
  return fallback
}

export function getFileValue(values: Record<string, unknown>): Record<string, unknown> | null {
  const file = getValue<Record<string, unknown> | null>(values, 'file', null)
  return file && typeof file === 'object' ? file : null
}

export function createSummary(params: {
  node: CanvasNodeRecord
  selected: boolean
  capabilities: CanvasNodeCapabilities
  summary: string
}): CanvasNodeSummary {
  return {
    id: params.node.id,
    name: params.node.name,
    blockType: params.node.blockType,
    kind: params.node.kind,
    position: params.node.position,
    selected: params.selected,
    summary: params.summary,
    capabilities: params.capabilities,
  }
}

export function createDetail(params: {
  node: CanvasNodeRecord
  selected: boolean
  capabilities: CanvasNodeCapabilities
  summary: string
  fields: Record<string, unknown>
  textContent?: string
  file?: Record<string, unknown> | null
}): CanvasNodeDetail {
  return {
    ...createSummary(params),
    fields: params.fields,
    textContent: params.textContent,
    file: params.file,
  }
}

export function validateWritableFields(
  operation: LocalCanvasPatchOperation,
  allowedFields: string[]
): CanvasPatchValidationResult {
  if (operation.type !== 'create_node' && operation.type !== 'update_node') {
    return { valid: true, errors: [] }
  }
  const fieldNames = Object.keys(operation.fields ?? {})
  const invalid = fieldNames.filter((field) => !allowedFields.includes(field))
  return {
    valid: invalid.length === 0,
    errors: invalid.map((field) => `Field "${field}" is not writable`),
  }
}

export function buildContentCreateOperation(
  input: LocalCanvasCreateNodeOperation,
  defaults: Record<string, unknown>
): EditWorkflowOperation {
  const preset = getContentNodePreset(
    input.kind as Exclude<LocalCanvasNodeKind, 'generic_workflow_block'>
  )
  return {
    operation_type: 'add',
    block_id: input.nodeId ?? input.clientNodeId ?? '',
    params: {
      type: preset?.blockType ?? 'content',
      name: input.title,
      dedupeName: true,
      position: input.position ?? { x: 0, y: 0 },
      inputs: {
        ...normalizeStructuredContentFields(defaults),
        ...(preset?.presetSubBlockValues ?? {}),
        contentVariant: input.kind,
        ...normalizeStructuredContentFields(input.fields ?? {}),
      },
    },
  }
}

function normalizeStructuredContentFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      (key === 'videoParameters' || key === 'audioParameters') && value && typeof value === 'object'
        ? JSON.stringify(value)
        : value,
    ])
  )
}

export function buildContentUpdateOperation(
  input: LocalCanvasUpdateNodeOperation
): EditWorkflowOperation {
  return {
    operation_type: 'edit',
    block_id: input.nodeId,
    params: {
      inputs: normalizeStructuredContentFields(input.fields),
    },
  }
}

export function createReadonlyAdapter(
  kind: LocalCanvasNodeKind,
  blockType: string
): CanvasNodeAdapter {
  return {
    kind,
    blockType,
    capabilities: READONLY_CAPABILITIES,
    summarize(node, selected) {
      return createSummary({
        node,
        selected,
        capabilities: READONLY_CAPABILITIES,
        summary: `${node.name} is a ${kind} node. It is currently read-only for the local agent.`,
      })
    },
    readDetail(node, selected) {
      return createDetail({
        node,
        selected,
        capabilities: READONLY_CAPABILITIES,
        summary: `${node.name} is a ${kind} node. It is currently read-only for the local agent.`,
        fields: node.values,
      })
    },
    getEditableFields() {
      return []
    },
    buildCreateOperation() {
      throw new Error(`${kind} nodes are read-only for the local canvas agent`)
    },
    buildUpdateOperation() {
      throw new Error(`${kind} nodes are read-only for the local canvas agent`)
    },
    validatePatch(operation) {
      if (operation.type === 'create_node' || operation.type === 'update_node') {
        return { valid: false, errors: [`${kind} nodes are read-only`] }
      }
      return { valid: true, errors: [] }
    },
  }
}
