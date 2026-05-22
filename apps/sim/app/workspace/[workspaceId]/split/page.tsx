import type { Metadata } from 'next'
import { SplitCanvasWorkbench } from '@/app/workspace/[workspaceId]/split/split-canvas-workbench'

export const metadata: Metadata = {
  title: 'Split View',
}

export default function SplitCanvasPage() {
  return <SplitCanvasWorkbench />
}
