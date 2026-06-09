import {
  buildContentCreateOperation,
  buildContentUpdateOperation,
  createDetail,
  createSummary,
  getFileValue,
  getValue,
  validateWritableFields,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import type { CanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const WRITABLE_FIELDS = [
  'file',
  'aiPrompt',
  'aiModel',
  'aiAspectRatio',
  'contentReferences',
] as const

export const imageNodeAdapter: CanvasNodeAdapter = {
  kind: 'image',
  blockType: 'content',
  capabilities: {
    canRead: true,
    canWrite: true,
    canGenerate: true,
    canReferenceFile: true,
  },
  summarize(node, selected) {
    const file = getFileValue(node.values)
    return createSummary({
      node,
      selected,
      capabilities: this.capabilities,
      summary:
        getValue<string>(node.values, 'aiPrompt', '') ||
        (typeof file?.name === 'string' ? file.name : '') ||
        'Image node without a file',
    })
  },
  readDetail(node, selected) {
    const file = getFileValue(node.values)
    return createDetail({
      node,
      selected,
      capabilities: this.capabilities,
      summary:
        getValue<string>(node.values, 'aiPrompt', '') ||
        (typeof file?.name === 'string' ? file.name : '') ||
        'Image node without a file',
      fields: {
        file,
        aiPrompt: getValue(node.values, 'aiPrompt', ''),
        aiModel: getValue(node.values, 'aiModel', 'jimeng-4.5'),
        aiAspectRatio: getValue(node.values, 'aiAspectRatio', 'auto'),
        contentReferences: getValue(node.values, 'contentReferences', []),
      },
      file,
    })
  },
  getEditableFields() {
    return [
      { id: 'file', type: 'file' },
      { id: 'aiPrompt', type: 'string' },
      { id: 'aiModel', type: 'string' },
      { id: 'aiAspectRatio', type: 'string' },
      { id: 'contentReferences', type: 'array' },
    ]
  },
  buildCreateOperation(input) {
    return buildContentCreateOperation(input, {
      contentVariant: 'image',
      aiPrompt: '',
      aiModel: 'jimeng-4.5',
      aiAspectRatio: 'auto',
      file: null,
      contentReferences: [],
    })
  },
  buildUpdateOperation(input) {
    return buildContentUpdateOperation(input)
  },
  validatePatch(operation) {
    return validateWritableFields(operation, [...WRITABLE_FIELDS])
  },
}
