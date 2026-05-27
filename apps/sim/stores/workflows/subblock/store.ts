import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { SubBlockStore, SubBlockValue } from '@/stores/workflows/subblock/types'

const logger = createLogger('SubBlockStore')

/**
 * Stable empty fallback for `state.workflowValues[workflowId]` selectors.
 * Using a module-level constant avoids returning a fresh `{}` on every
 * selector call, which would defeat Zustand's `Object.is` equality.
 */
export const EMPTY_SUBBLOCK_VALUES: Record<string, Record<string, SubBlockValue>> = {}

/**
 * Stable empty fallback for a single block's sub-block values.
 */
export const EMPTY_BLOCK_SUBBLOCK_VALUES: Record<string, SubBlockValue> = {}

function mapLegacyTriggerConfigField(fieldName: string): string {
  const fieldMapping: Record<string, string> = {
    credentialId: 'triggerCredentials',
    includeCellValuesInFieldIds: 'includeCellValues',
  }
  return fieldMapping[fieldName] || fieldName
}

function normalizeLegacyTriggerConfigValue(
  subBlockId: string,
  value: SubBlockValue
): SubBlockValue {
  if (subBlockId !== 'labelIds' && subBlockId !== 'folderIds') {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return JSON.parse(value)
    } catch {
      return [value]
    }
  }

  if (!Array.isArray(value) && value !== null && value !== undefined) {
    return [value]
  }

  return value
}

/**
 * SubBlockState stores values for all subblocks in workflows
 *
 * Important implementation notes:
 * 1. Values are stored per workflow, per block, per subblock
 * 2. When workflows are synced to the database, the mergeSubblockState function
 *    in utils.ts combines the block structure with these values
 * 3. If a subblock value exists here but not in the block structure
 *    (e.g., inputFormat in starter block), the merge function will include it
 *    in the synchronized state to ensure persistence
 */

export const useSubBlockStore = create<SubBlockStore>()(
  devtools((set, get) => ({
    workflowValues: {},

    setValue: (blockId: string, subBlockId: string, value: any) => {
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!activeWorkflowId) return

      let validatedValue = value
      if (Array.isArray(value)) {
        const isTableData =
          value.length > 0 &&
          value.some((item) => item && typeof item === 'object' && 'cells' in item)

        if (isTableData) {
          logger.debug('Validating table data for subblock', { blockId, subBlockId })
          validatedValue = value.map((row: any) => {
            if (!row || typeof row !== 'object') {
              logger.warn('Fixing malformed table row', { blockId, subBlockId, row })
              return {
                id: generateId(),
                cells: { Key: '', Value: '' },
              }
            }

            if (!row.id) {
              row.id = generateId()
            }

            if (!row.cells || typeof row.cells !== 'object') {
              logger.warn('Fixing malformed table row cells', { blockId, subBlockId, row })
              row.cells = { Key: '', Value: '' }
            }

            return row
          })
        }
      }

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: {
            ...state.workflowValues[activeWorkflowId],
            [blockId]: {
              ...state.workflowValues[activeWorkflowId]?.[blockId],
              [subBlockId]: validatedValue,
            },
          },
        },
      }))
    },

    getValue: (blockId: string, subBlockId: string) => {
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!activeWorkflowId) return null

      return get().workflowValues[activeWorkflowId]?.[blockId]?.[subBlockId] ?? null
    },

    clear: () => {
      const activeWorkflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!activeWorkflowId) return

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [activeWorkflowId]: {},
        },
      }))
    },

    initializeFromWorkflow: (workflowId: string, blocks: Record<string, any>) => {
      const values: Record<string, Record<string, any>> = {}

      Object.entries(blocks).forEach(([blockId, block]) => {
        values[blockId] = {}
        Object.entries(block.subBlocks || {}).forEach(([subBlockId, subBlock]) => {
          values[blockId][subBlockId] = (subBlock as SubBlockConfig).value
        })

        const triggerConfig = values[blockId].triggerConfig
        if (triggerConfig && typeof triggerConfig === 'object' && !Array.isArray(triggerConfig)) {
          for (const [fieldName, fieldValue] of Object.entries(triggerConfig)) {
            const subBlockId = mapLegacyTriggerConfigField(fieldName)
            const currentValue = values[blockId][subBlockId]
            if (currentValue === null || currentValue === undefined || currentValue === '') {
              values[blockId][subBlockId] = normalizeLegacyTriggerConfigValue(
                subBlockId,
                fieldValue as SubBlockValue
              )
            }
          }
        }
      })

      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [workflowId]: values,
        },
      }))
    },
    setWorkflowValues: (workflowId: string, values: Record<string, Record<string, any>>) => {
      set((state) => ({
        workflowValues: {
          ...state.workflowValues,
          [workflowId]: values,
        },
      }))
    },
  }))
)
