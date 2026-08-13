import { task } from '@trigger.dev/sdk'
import {
  type EditablePresentationRebuildPayload,
  rebuildPresentationAsEditable,
} from '@/lib/presentation/presentation-generation'

/** Executes an editable PPT rebuild when the async queue is backed by Trigger.dev. */
export const editablePresentationRebuildTask = task({
  id: 'editable-presentation-rebuild',
  machine: 'large-1x',
  run: (payload: EditablePresentationRebuildPayload) => rebuildPresentationAsEditable(payload),
})
