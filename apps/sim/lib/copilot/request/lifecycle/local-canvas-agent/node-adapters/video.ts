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
  'file',
  'videoPrompt',
  'videoModelFamily',
  'videoMedia',
  'videoParameters',
  'videoFrameAspectRatioPreset',
  'contentReferences',
] as const

export const videoNodeAdapter: CanvasNodeAdapter = {
  kind: 'video',
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
        getValue<string>(node.values, 'videoPrompt', '') ||
        (typeof file?.name === 'string' ? file.name : '') ||
        'Video node without a file',
    })
  },
  readDetail(node, selected) {
    const file = getFileValue(node.values)
    return createDetail({
      node,
      selected,
      capabilities: this.capabilities,
      summary:
        getValue<string>(node.values, 'videoPrompt', '') ||
        (typeof file?.name === 'string' ? file.name : '') ||
        'Video node without a file',
      fields: {
        file,
        videoPrompt: getValue(node.values, 'videoPrompt', ''),
        videoModelFamily: getValue(node.values, 'videoModelFamily', 'wan2.7'),
        videoMedia: getValue(node.values, 'videoMedia', []),
        videoParameters: getObjectValue(node.values, 'videoParameters', {
          resolution: '720P',
          duration: 5,
        }),
        videoFrameAspectRatioPreset: getValue(node.values, 'videoFrameAspectRatioPreset', '16:9'),
        contentReferences: getValue(node.values, 'contentReferences', []),
      },
      file,
    })
  },
  getEditableFields() {
    return [
      { id: 'file', type: 'file' },
      { id: 'videoPrompt', type: 'string' },
      { id: 'videoModelFamily', type: 'string' },
      { id: 'videoMedia', type: 'array' },
      { id: 'videoParameters', type: 'object' },
      { id: 'videoFrameAspectRatioPreset', type: 'string' },
      { id: 'contentReferences', type: 'array' },
    ]
  },
  buildCreateOperation(input) {
    return buildContentCreateOperation(input, {
      contentVariant: 'video',
      file: null,
      videoPrompt: '',
      videoModelFamily: 'wan2.7',
      videoMedia: [],
      videoParameters: { resolution: '720P', duration: 5 },
      videoFrameAspectRatioPreset: '16:9',
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
