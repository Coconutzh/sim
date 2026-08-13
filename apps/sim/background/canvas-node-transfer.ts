import { task } from '@trigger.dev/sdk'
import type { CopySelectionBody } from '@/lib/api/contracts/collaboration'
import { copyWorkflowSelection } from '@/lib/workflows/copy-selection-service'

interface CanvasNodeTransferPayload {
  actorUserId: string
  sourceWorkflowId: string
  body: CopySelectionBody
}

/** Executes a queued personal-content copy when Trigger.dev is enabled. */
export const canvasNodeTransferTask = task({
  id: 'canvas-node-transfer',
  machine: 'small-1x',
  run: (payload: CanvasNodeTransferPayload) => copyWorkflowSelection(payload),
})
