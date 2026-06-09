import {
  buildContentCreateOperation,
  buildContentUpdateOperation,
  createDetail,
  createSummary,
  getValue,
  stripHtml,
  validateWritableFields,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import type { CanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const WRITABLE_FIELDS = [
  'contentHtml',
  'blockStyle',
  'backgroundColor',
  'fontSize',
  'width',
  'height',
  'aiPrompt',
  'aiModel',
  'contentReferences',
] as const

export const textNodeAdapter: CanvasNodeAdapter = {
  kind: 'text',
  blockType: 'content',
  capabilities: {
    canRead: true,
    canWrite: true,
    canGenerate: true,
    canReferenceFile: false,
  },
  summarize(node, selected) {
    return createSummary({
      node,
      selected,
      capabilities: this.capabilities,
      summary:
        stripHtml(getValue<string>(node.values, 'contentHtml', '')).slice(0, 500) ||
        getValue<string>(node.values, 'aiPrompt', '') ||
        'Empty text node',
    })
  },
  readDetail(node, selected) {
    const contentHtml = getValue<string>(node.values, 'contentHtml', '')
    return createDetail({
      node,
      selected,
      capabilities: this.capabilities,
      summary: stripHtml(contentHtml).slice(0, 500) || 'Empty text node',
      textContent: stripHtml(contentHtml),
      fields: {
        contentHtml,
        blockStyle: getValue(node.values, 'blockStyle', 'paragraph'),
        backgroundColor: getValue(node.values, 'backgroundColor', '#FFF8C5'),
        fontSize: getValue(node.values, 'fontSize', 16),
        width: getValue(node.values, 'width', 320),
        height: getValue(node.values, 'height', 160),
        aiPrompt: getValue(node.values, 'aiPrompt', ''),
        aiModel: getValue(node.values, 'aiModel', 'gemini-3.1-flash-lite-preview'),
        contentReferences: getValue(node.values, 'contentReferences', []),
      },
    })
  },
  getEditableFields() {
    return WRITABLE_FIELDS.map((id) => ({
      id,
      type: id === 'fontSize' || id === 'width' || id === 'height' ? 'number' : 'string',
    }))
  },
  buildCreateOperation(input) {
    return buildContentCreateOperation(input, {
      contentVariant: 'text',
      contentHtml: '<p></p>',
      blockStyle: 'paragraph',
      backgroundColor: '#FFF8C5',
      fontSize: 16,
      width: 320,
      height: 160,
      aiPrompt: '',
      aiModel: 'gemini-3.1-flash-lite-preview',
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
