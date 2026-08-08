import { useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type RebuildContentCanvasPresentationEditableBody,
  type RebuildContentCanvasPresentationEditableResponse,
  rebuildContentCanvasPresentationEditableContract,
} from '@/lib/api/contracts/content-canvas'

export const editablePresentationKeys = {
  all: ['editable-presentation'] as const,
  rebuilds: () => [...editablePresentationKeys.all, 'rebuild'] as const,
}

async function requestEditablePresentationRebuild(
  body: RebuildContentCanvasPresentationEditableBody
): Promise<RebuildContentCanvasPresentationEditableResponse> {
  return requestJson(rebuildContentCanvasPresentationEditableContract, { body })
}

/** Starts a resumable background conversion from image-based to editable PPT. */
export function useRebuildEditablePresentation() {
  return useMutation({ mutationFn: requestEditablePresentationRebuild })
}
