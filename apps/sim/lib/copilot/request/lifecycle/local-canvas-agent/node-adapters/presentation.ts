import {
  buildContentCreateOperation,
  buildContentUpdateOperation,
  createDetail,
  createSummary,
  getFileValue,
  getObjectValue,
  getValue,
  validateWritableFields,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import type { CanvasNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const WRITABLE_FIELDS = [
  'presentationPrompt',
  'presentationSlideCountMode',
  'presentationSlideCount',
  'presentationStatus',
  'presentationError',
  'presentationArtifact',
  'file',
  'contentReferences',
] as const

export const presentationNodeAdapter: CanvasNodeAdapter = {
  kind: 'presentation',
  blockType: 'content',
  capabilities: {
    canRead: true,
    canWrite: true,
    canGenerate: false,
    canReferenceFile: true,
  },
  summarize(node, selected) {
    const artifact = getObjectValue<Record<string, unknown>>(
      node.values,
      'presentationArtifact',
      {}
    )
    const manifest = getObjectValue<Record<string, unknown>>(artifact, 'manifest', {})
    const file = getFileValue(node.values)
    const title =
      (typeof manifest.title === 'string' && manifest.title) ||
      (typeof file?.name === 'string' && file.name) ||
      node.name
    return createSummary({
      node,
      selected,
      capabilities: this.capabilities,
      summary: `${title} · ${getValue(node.values, 'presentationStatus', 'idle')}`,
    })
  },
  readDetail(node, selected) {
    const artifact = getObjectValue<Record<string, unknown>>(
      node.values,
      'presentationArtifact',
      {}
    )
    const file = getFileValue(node.values)
    return createDetail({
      node,
      selected,
      capabilities: this.capabilities,
      summary:
        getValue<string>(node.values, 'presentationPrompt', '') ||
        (typeof file?.name === 'string' ? file.name : '') ||
        'PPT node without a generated artifact',
      fields: {
        presentationPrompt: getValue(node.values, 'presentationPrompt', ''),
        presentationSlideCountMode: getValue(node.values, 'presentationSlideCountMode', 'auto'),
        presentationSlideCount: getValue(node.values, 'presentationSlideCount', 8),
        presentationStatus: getValue(node.values, 'presentationStatus', 'idle'),
        presentationError: getValue(node.values, 'presentationError', null),
        presentationArtifact: artifact,
        file,
        contentReferences: getValue(node.values, 'contentReferences', []),
      },
      file,
    })
  },
  getEditableFields() {
    return [
      { id: 'presentationPrompt', type: 'string' },
      { id: 'presentationSlideCountMode', type: 'string' },
      { id: 'presentationSlideCount', type: 'number' },
      { id: 'presentationStatus', type: 'string' },
      { id: 'presentationError', type: 'string' },
      { id: 'presentationArtifact', type: 'object' },
      { id: 'file', type: 'file' },
      { id: 'contentReferences', type: 'array' },
    ]
  },
  buildCreateOperation(input) {
    return buildContentCreateOperation(input, {
      contentVariant: 'presentation',
      presentationPrompt: '',
      presentationSlideCountMode: 'auto',
      presentationSlideCount: 8,
      presentationStatus: 'idle',
      presentationArtifact: null,
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
