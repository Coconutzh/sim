import { create } from 'zustand'

interface ContentCanvasSelectionState {
  selectionByWorkflow: Record<string, string[]>
  setSelection: (workflowId: string, blockIds: string[]) => void
  clearSelection: (workflowId: string) => void
}

export const useContentCanvasSelectionStore = create<ContentCanvasSelectionState>((set) => ({
  selectionByWorkflow: {},
  setSelection: (workflowId, blockIds) =>
    set((state) => ({
      selectionByWorkflow: {
        ...state.selectionByWorkflow,
        [workflowId]: blockIds,
      },
    })),
  clearSelection: (workflowId) =>
    set((state) => {
      if (!state.selectionByWorkflow[workflowId]) {
        return state
      }

      const next = { ...state.selectionByWorkflow }
      delete next[workflowId]
      return { selectionByWorkflow: next }
    }),
}))
