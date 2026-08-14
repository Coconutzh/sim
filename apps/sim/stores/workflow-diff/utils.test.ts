/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useVariablesStore } from '@/stores/variables/store'
import {
  applyWorkflowStateToStores,
  applyWorkflowVariablesToStore,
} from '@/stores/workflow-diff/utils'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

describe('applyWorkflowVariablesToStore', () => {
  beforeEach(() => {
    useVariablesStore.setState({
      variables: {},
      isLoading: false,
      error: null,
      isEditing: null,
    })
    useWorkflowStore.setState({
      currentWorkflowId: null,
      blocks: {},
      edges: [],
      loops: {},
      parallels: {},
      lastSaved: 0,
    })
    useSubBlockStore.setState({ workflowValues: {} })
  })

  it('hydrates variables for the target workflow and preserves other workflows', () => {
    useVariablesStore.setState({
      variables: {
        old: {
          id: 'old',
          workflowId: 'workflow-a',
          name: 'oldValue',
          type: 'plain',
          value: 'stale',
        },
        other: {
          id: 'other',
          workflowId: 'workflow-b',
          name: 'otherValue',
          type: 'plain',
          value: 'kept',
        },
      },
    })

    applyWorkflowVariablesToStore('workflow-a', {
      next: {
        id: 'next',
        name: 'nextValue',
        type: 'number',
        value: 42,
      },
    })

    expect(useVariablesStore.getState().variables).toEqual({
      other: {
        id: 'other',
        workflowId: 'workflow-b',
        name: 'otherValue',
        type: 'plain',
        value: 'kept',
      },
      next: {
        id: 'next',
        workflowId: 'workflow-a',
        name: 'nextValue',
        type: 'number',
        value: 42,
      },
    })
  })

  it('preserves null variable values from persisted workflow state', () => {
    applyWorkflowVariablesToStore('workflow-a', {
      next: {
        id: 'next',
        name: 'nullableValue',
        type: 'object',
        value: null,
      },
    })

    expect(useVariablesStore.getState().variables.next.value).toBeNull()
  })

  it('applies blocks, edges, positions, subblocks, and variables in place', () => {
    const makeBlock = (
      id: string,
      position: { x: number; y: number },
      subblockValue: string
    ): BlockState => ({
      id,
      type: 'agent',
      name: id,
      position,
      subBlocks: {
        prompt: { id: 'prompt', type: 'short-input', value: subblockValue },
      },
      outputs: {},
      enabled: true,
    })
    const workflowState: WorkflowState = {
      currentWorkflowId: 'workflow-a',
      blocks: {
        source: makeBlock('source', { x: 320, y: 180 }, 'latest prompt'),
        target: makeBlock('target', { x: 640, y: 180 }, 'target prompt'),
      },
      edges: [{ id: 'edge-1', source: 'source', target: 'target' }],
      loops: {},
      parallels: {},
      variables: {
        answer: { id: 'answer', name: 'answer', type: 'number', value: 42 },
      },
      lastSaved: 123,
    }

    applyWorkflowStateToStores('workflow-a', workflowState)

    const appliedWorkflow = useWorkflowStore.getState()
    expect(appliedWorkflow.currentWorkflowId).toBe('workflow-a')
    expect(appliedWorkflow.blocks.source.position).toEqual({ x: 320, y: 180 })
    expect(appliedWorkflow.edges).toEqual([
      expect.objectContaining({ id: 'edge-1', source: 'source', target: 'target' }),
    ])
    expect(useSubBlockStore.getState().workflowValues['workflow-a']).toEqual({
      source: { prompt: 'latest prompt' },
      target: { prompt: 'target prompt' },
    })
    expect(useVariablesStore.getState().variables.answer).toEqual({
      id: 'answer',
      workflowId: 'workflow-a',
      name: 'answer',
      type: 'number',
      value: 42,
    })
  })
})
