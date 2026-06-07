import {
  createDetail,
  createSummary,
  getFileValue,
  getValue,
  READONLY_CAPABILITIES,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import type { CanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

export const imageEditorNodeAdapter: CanvasNodeAdapter = {
  kind: 'image_editor',
  blockType: 'content',
  capabilities: {
    ...READONLY_CAPABILITIES,
    canReferenceFile: true,
  },
  summarize(node, selected) {
    const sourceFile = getFileValue(node.values)
    const editPrompt = getValue<string>(node.values, 'editPrompt', '')
    return createSummary({
      node,
      selected,
      capabilities: this.capabilities,
      summary: `Image editor node${editPrompt ? ` with edit prompt: ${editPrompt}` : ''}${
        sourceFile && typeof sourceFile.name === 'string' ? `, source file ${sourceFile.name}` : ''
      }. Read-only in this agent version.`,
    })
  },
  readDetail(node, selected) {
    const sourceFile = getFileValue(node.values)
    const editPrompt = getValue<string>(node.values, 'editPrompt', '')
    return createDetail({
      node,
      selected,
      capabilities: this.capabilities,
      summary: `Image editor node${
        editPrompt ? ` with edit prompt: ${editPrompt}` : ''
      }. Read-only in this agent version.`,
      fields: {
        editPrompt,
        file: sourceFile && typeof sourceFile.name === 'string' ? { name: sourceFile.name } : null,
      },
      file: sourceFile && typeof sourceFile.name === 'string' ? { name: sourceFile.name } : null,
    })
  },
  getEditableFields() {
    return []
  },
  buildCreateOperation() {
    throw new Error('image_editor nodes are read-only for the local canvas agent')
  },
  buildUpdateOperation() {
    throw new Error('image_editor nodes are read-only for the local canvas agent')
  },
  validatePatch(operation) {
    if (operation.type === 'create_node' || operation.type === 'update_node') {
      return { valid: false, errors: ['image_editor nodes are read-only'] }
    }
    return { valid: true, errors: [] }
  },
}
