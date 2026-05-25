/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { validateGeneratedWorkspaceFileName } from './generate-image'

describe('validateGeneratedWorkspaceFileName for generated images', () => {
  it('returns canvas file wording for nested image paths', () => {
    expect(validateGeneratedWorkspaceFileName('images/generated-image.png')).toBe(
      'Canvas files use a flat namespace. Use a plain file name like "generated-image.png", not a path like "images/generated-image.png".'
    )
  })
})
