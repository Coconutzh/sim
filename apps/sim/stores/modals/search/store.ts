import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SearchData, SearchModalState } from '@/stores/modals/search/types'

const initialData: SearchData = {
  blocks: [],
  tools: [],
  triggers: [],
  toolOperations: [],
  docs: [],
  isInitialized: false,
}

export const useSearchModalStore = create<SearchModalState>()(
  devtools(
    (set, _) => ({
      isOpen: false,
      data: initialData,

      setOpen: (open: boolean) => {
        set({ isOpen: open })
      },

      open: () => {
        set({ isOpen: true })
      },

      close: () => {
        set({ isOpen: false })
      },

      initializeData: async (filterBlocks) => {
        const { buildSearchData } = await import('@/stores/modals/search/search-data')
        set({ data: buildSearchData(filterBlocks) })
      },
    }),
    { name: 'search-modal-store' }
  )
)
