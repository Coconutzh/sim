/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { validateGeneratedWorkspaceFileName } from './generate-visualization'

describe('validateGeneratedWorkspaceFileName for generated visualizations', () => {
  it('returns canvas file wording for nested chart paths', () => {
    expect(validateGeneratedWorkspaceFileName('charts/chart.png')).toBe(
      'Canvas files use a flat namespace. Use a plain file name like "chart.png", not a path like "charts/chart.png".'
    )
  })
})
