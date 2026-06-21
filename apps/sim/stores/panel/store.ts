import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PANEL_WIDTH } from '@/stores/constants'
import type { PanelState, PanelTab } from '@/stores/panel/types'

/**
 * Default panel tab
 */
const DEFAULT_TAB: PanelTab = 'copilot'

function syncPanelWidth(width: number, isCollapsed: boolean) {
  if (typeof window === 'undefined') return
  const effectiveWidth = isCollapsed ? PANEL_WIDTH.COLLAPSED : width
  document.documentElement.style.setProperty('--panel-width', `${effectiveWidth}px`)
}

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      panelWidth: PANEL_WIDTH.DEFAULT,
      setPanelWidth: (width) => {
        const clampedWidth = Math.max(PANEL_WIDTH.MIN, width)
        set((state) => {
          syncPanelWidth(clampedWidth, state.isCollapsed)
          return { panelWidth: clampedWidth }
        })
      },
      activeTab: DEFAULT_TAB,
      setActiveTab: (tab) => {
        set({ activeTab: tab })
        if (typeof document !== 'undefined') {
          document.documentElement.removeAttribute('data-panel-active-tab')
        }
      },
      isCollapsed: false,
      setCollapsed: (isCollapsed) => {
        set((state) => {
          syncPanelWidth(state.panelWidth, isCollapsed)
          return { isCollapsed }
        })
      },
      toggleCollapsed: () => {
        set((state) => {
          const isCollapsed = !state.isCollapsed
          syncPanelWidth(state.panelWidth, isCollapsed)
          return { isCollapsed }
        })
      },
      isResizing: false,
      setIsResizing: (isResizing) => {
        set({ isResizing })
      },
      _hasHydrated: false,
      setHasHydrated: (hasHydrated) => {
        set({ _hasHydrated: hasHydrated })
      },
    }),
    {
      name: 'panel-state',
      partialize: (state) => ({
        panelWidth: state.panelWidth,
        activeTab: state.activeTab,
        isCollapsed: state.isCollapsed,
      }),
      merge: (persistedState, currentState) => {
        const persisted =
          persistedState && typeof persistedState === 'object'
            ? (persistedState as Partial<PanelState>)
            : {}
        return {
          ...currentState,
          ...persisted,
          activeTab: DEFAULT_TAB,
          isCollapsed: persisted.isCollapsed ?? false,
          isResizing: false,
          _hasHydrated: false,
        }
      },
      onRehydrateStorage: () => (state) => {
        if (state && typeof window !== 'undefined') {
          syncPanelWidth(state.panelWidth, state.isCollapsed)
          document.documentElement.removeAttribute('data-panel-active-tab')
        }
      },
    }
  )
)
