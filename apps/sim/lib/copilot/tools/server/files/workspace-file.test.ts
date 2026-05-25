/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { validateFlatWorkspaceFileName } from './workspace-file'

describe('validateFlatWorkspaceFileName', () => {
  it('returns canvas file wording for nested file paths', () => {
    expect(validateFlatWorkspaceFileName('files/reports/report.csv')).toBe(
      'Canvas files use a flat namespace. Use a plain file name like "report.csv", not a path like "files/reports/report.csv".'
    )
  })
})
