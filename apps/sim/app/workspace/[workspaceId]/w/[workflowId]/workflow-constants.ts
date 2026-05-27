/** ReactFlow configuration constants. */
export const defaultEdgeOptions = { type: 'custom' } as const

export const reactFlowStyles = [
  '[&_.react-flow__handle]:!z-[30]',
  '[&_.react-flow__edge-labels]:!z-[1001]',
  '[&_.react-flow__pane]:select-none',
  '[&_.react-flow__selectionpane]:select-none',
  '[&_.react-flow__background]:hidden',
  '[&_.react-flow__node-subflowNode.selected]:!shadow-none',
].join(' ')

export const reactFlowFitViewOptions = { padding: 0.6, maxZoom: 1.0 } as const
export const embeddedFitViewOptions = { padding: 0.15, maxZoom: 0.85, minZoom: 0.1 } as const
export const embeddedResizeFitViewOptions = { ...embeddedFitViewOptions, duration: 0 } as const
export const reactFlowProOptions = { hideAttribution: true } as const
