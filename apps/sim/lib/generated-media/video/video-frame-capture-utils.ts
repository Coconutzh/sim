import type { CaptureWorkspaceVideoFrameBody } from '@/lib/api/contracts/media-videos'

export function getVideoFrameCaptureFileName(
  sourceName: string | undefined,
  mode: CaptureWorkspaceVideoFrameBody['mode']
): string {
  const baseName = (sourceName || 'video').replace(/\.[^.]+$/, '') || 'video'
  return `${baseName}-frame-${mode}.jpg`
}
