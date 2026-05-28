import { create } from 'zustand'
import type { ContentReferenceSelectionSession } from '@/lib/workflows/content-reference-edges'

interface ContentReferenceSelectionStore {
  selection: ContentReferenceSelectionSession | null
  beginSelection: (selection: ContentReferenceSelectionSession) => void
  clearSelection: () => void
}

export const useContentReferenceSelectionStore = create<ContentReferenceSelectionStore>((set) => ({
  selection: null,
  beginSelection: (selection) => set({ selection }),
  clearSelection: () => set({ selection: null }),
}))
