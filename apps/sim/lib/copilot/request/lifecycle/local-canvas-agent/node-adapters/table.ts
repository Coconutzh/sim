import {
  createDetail,
  createSummary,
  getValue,
  READONLY_CAPABILITIES,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import type { CanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

function getArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

export const tableNodeAdapter: CanvasNodeAdapter = {
  kind: 'table',
  blockType: 'table',
  capabilities: READONLY_CAPABILITIES,
  summarize(node, selected) {
    const columns = getValue<unknown[]>(node.values, 'columns', [])
    const rows = getValue<unknown[]>(node.values, 'rows', [])
    return createSummary({
      node,
      selected,
      capabilities: this.capabilities,
      summary: `Table node with ${getArrayLength(columns)} column(s) and ${getArrayLength(
        rows
      )} row(s). Read-only in this agent version.`,
    })
  },
  readDetail(node, selected) {
    const columns = getValue<unknown[]>(node.values, 'columns', [])
    const rows = getValue<unknown[]>(node.values, 'rows', [])
    return createDetail({
      node,
      selected,
      capabilities: this.capabilities,
      summary: `Table node with ${getArrayLength(columns)} column(s) and ${getArrayLength(
        rows
      )} row(s). Read-only in this agent version.`,
      fields: {
        columns,
        rowCount: getArrayLength(rows),
        sampleRows: rows.slice(0, 5),
      },
    })
  },
  getEditableFields() {
    return []
  },
  buildCreateOperation() {
    throw new Error('table nodes are read-only for the local canvas agent')
  },
  buildUpdateOperation() {
    throw new Error('table nodes are read-only for the local canvas agent')
  },
  validatePatch(operation) {
    if (operation.type === 'create_node' || operation.type === 'update_node') {
      return { valid: false, errors: ['table nodes are read-only'] }
    }
    return { valid: true, errors: [] }
  },
}
