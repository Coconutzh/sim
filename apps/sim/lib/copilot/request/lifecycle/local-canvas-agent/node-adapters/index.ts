import { audioNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/audio'
import { documentNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/document'
import { imageNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/image'
import { imageEditorNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/image-editor'
import { presentationNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/presentation'
import { createReadonlyAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/shared'
import { tableNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/table'
import { textNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/text'
import { videoNodeAdapter } from '@/lib/copilot/request/lifecycle/local-canvas-agent/node-adapters/video'
import type {
  CanvasNodeAdapter,
  LocalCanvasNodeKind,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const readonlyGenericAdapter = createReadonlyAdapter('generic_workflow_block', '*')

const ADAPTERS: Record<LocalCanvasNodeKind, CanvasNodeAdapter> = {
  text: textNodeAdapter,
  image: imageNodeAdapter,
  video: videoNodeAdapter,
  audio: audioNodeAdapter,
  presentation: presentationNodeAdapter,
  document: documentNodeAdapter,
  table: tableNodeAdapter,
  image_editor: imageEditorNodeAdapter,
  generic_workflow_block: readonlyGenericAdapter,
}

export function getCanvasNodeAdapter(kind: LocalCanvasNodeKind): CanvasNodeAdapter {
  return ADAPTERS[kind] ?? readonlyGenericAdapter
}

export function getCanvasNodeAdapters(): CanvasNodeAdapter[] {
  return Object.values(ADAPTERS)
}
