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
import {
  DEFAULT_AUDIO_MODEL,
  DEFAULT_AUDIO_PARAMETERS,
} from '@/lib/generated-media/audio/audio-generation-utils'

const WRITABLE_FIELDS = [
  'file',
  'audioPrompt',
  'audioModel',
  'audioParameters',
  'contentReferences',
] as const

export const audioNodeAdapter: CanvasNodeAdapter = {
  kind: 'audio',
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
        getValue<string>(node.values, 'audioPrompt', '') ||
        (typeof file?.name === 'string' ? file.name : '') ||
        'Audio node without a file',
    })
  },
  readDetail(node, selected) {
    const file = getFileValue(node.values)
    return createDetail({
      node,
      selected,
      capabilities: this.capabilities,
      summary:
        getValue<string>(node.values, 'audioPrompt', '') ||
        (typeof file?.name === 'string' ? file.name : '') ||
        'Audio node without a file',
      fields: {
        file,
        audioPrompt: getValue(node.values, 'audioPrompt', ''),
        audioModel: getValue(node.values, 'audioModel', DEFAULT_AUDIO_MODEL),
        audioParameters: getObjectValue(node.values, 'audioParameters', DEFAULT_AUDIO_PARAMETERS),
      },
      file,
    })
  },
  getEditableFields() {
    return [
      { id: 'file', type: 'file' },
      { id: 'audioPrompt', type: 'string' },
      { id: 'audioModel', type: 'string' },
      { id: 'audioParameters', type: 'object' },
    ]
  },
  buildCreateOperation(input) {
    return buildContentCreateOperation(input, {
      contentVariant: 'audio',
      file: null,
      audioPrompt: '',
      audioModel: DEFAULT_AUDIO_MODEL,
      audioParameters: DEFAULT_AUDIO_PARAMETERS,
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
