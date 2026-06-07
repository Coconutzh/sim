import {
  createDetail,
  createSummary,
  getFileValue,
  getValue,
  READONLY_CAPABILITIES,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import type { CanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export const documentNodeAdapter: CanvasNodeAdapter = {
  kind: 'document',
  blockType: 'file',
  capabilities: {
    ...READONLY_CAPABILITIES,
    canReferenceFile: true,
  },
  summarize(node, selected) {
    const file = getFileValue(node.values)
    const title = getValue<string>(node.values, 'title', node.name)
    return createSummary({
      node,
      selected,
      capabilities: this.capabilities,
      summary: `Document node "${title}"${
        file && typeof file.name === 'string' ? ` with file ${file.name}` : ''
      }. Read-only in this agent version.`,
    })
  },
  readDetail(node, selected) {
    const file = getFileValue(node.values)
    const title = getValue<string>(node.values, 'title', node.name)
    const description = getValue<string>(node.values, 'description', '')
    return createDetail({
      node,
      selected,
      capabilities: this.capabilities,
      summary: `Document node "${title}"${
        description ? `: ${description}` : ''
      }. Read-only in this agent version.`,
      fields: {
        title,
        description,
        file: file && typeof file.name === 'string' ? { name: file.name } : null,
      },
      file: file && typeof file.name === 'string' ? { name: file.name } : null,
    })
  },
  getEditableFields() {
    return []
  },
  buildCreateOperation() {
    throw new Error('document nodes are read-only for the local canvas agent')
  },
  buildUpdateOperation() {
    throw new Error('document nodes are read-only for the local canvas agent')
  },
  validatePatch(operation) {
    if (operation.type === 'create_node' || operation.type === 'update_node') {
      return { valid: false, errors: ['document nodes are read-only'] }
    }
    return { valid: true, errors: [] }
  },
}
