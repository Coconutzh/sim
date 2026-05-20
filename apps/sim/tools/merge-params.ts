import { isEmptyTagValue } from '@/tools/shared/tags'

function isNonEmpty(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

/**
 * Deep merges inputMapping objects, where LLM values fill in empty/missing user values.
 * User-provided non-empty values take precedence.
 */
export function deepMergeInputMapping(
  llmInputMapping: Record<string, unknown> | undefined,
  userInputMapping: Record<string, unknown> | string | undefined
): Record<string, unknown> {
  let parsedUserMapping: Record<string, unknown> = {}
  if (typeof userInputMapping === 'string') {
    try {
      const parsed = JSON.parse(userInputMapping)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        parsedUserMapping = parsed
      }
    } catch {}
  } else if (
    typeof userInputMapping === 'object' &&
    userInputMapping !== null &&
    !Array.isArray(userInputMapping)
  ) {
    parsedUserMapping = userInputMapping
  }

  if (!llmInputMapping || typeof llmInputMapping !== 'object') {
    return parsedUserMapping
  }

  const merged: Record<string, unknown> = { ...llmInputMapping }
  for (const [key, userValue] of Object.entries(parsedUserMapping)) {
    if (isNonEmpty(userValue)) {
      merged[key] = userValue
    }
  }

  return merged
}

/**
 * Merges user-provided parameters with LLM-generated parameters.
 */
export function mergeToolParameters(
  userProvidedParams: Record<string, unknown>,
  llmGeneratedParams: Record<string, unknown>
): Record<string, unknown> {
  const filteredUserParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(userProvidedParams)) {
    if (isNonEmpty(value)) {
      if ((key === 'documentTags' || key === 'tagFilters') && isEmptyTagValue(value)) {
        continue
      }
      filteredUserParams[key] = value
    }
  }

  const result: Record<string, unknown> = { ...llmGeneratedParams }

  for (const [key, userValue] of Object.entries(filteredUserParams)) {
    if (key === 'inputMapping') {
      const llmInputMapping = llmGeneratedParams.inputMapping as Record<string, unknown> | undefined
      result.inputMapping = deepMergeInputMapping(
        llmInputMapping,
        userValue as Record<string, unknown> | string | undefined
      )
    } else {
      result[key] = userValue
    }
  }

  if (llmGeneratedParams.inputMapping && !filteredUserParams.inputMapping) {
    result.inputMapping = llmGeneratedParams.inputMapping
  }

  return result
}
