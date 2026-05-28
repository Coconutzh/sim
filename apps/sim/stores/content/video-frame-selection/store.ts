import { create } from 'zustand'
import type {
  VideoFrameAspectRatioPreset,
  VideoModelFamily,
} from '@/lib/generated-media/video/video-generation-utils'

export interface VideoFrameSelectionSession {
  targetBlockId: string
  slot: 'first' | 'last'
  modelFamily: VideoModelFamily
  requiredAspectRatioPreset: VideoFrameAspectRatioPreset
}

interface VideoFrameSelectionStore {
  selection: VideoFrameSelectionSession | null
  beginSelection: (selection: VideoFrameSelectionSession) => void
  clearSelection: () => void
}

export const useVideoFrameSelectionStore = create<VideoFrameSelectionStore>((set) => ({
  selection: null,
  beginSelection: (selection) => set({ selection }),
  clearSelection: () => set({ selection: null }),
}))
