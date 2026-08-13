const SENSITIVE_KEY_PARTS = [
  'apikey',
  'accesstoken',
  'refreshtoken',
  'token',
  'secret',
  'password',
  'authorization',
  'privatekey',
  'clientsecret',
  'bearer',
  'oauth',
] as const

const REDACTED_FILE_VALUE = { type: 'file', label: 'Redacted file' } as const
const REDACTED_CREDENTIAL_VALUE = { type: 'credential', label: 'Configured credential' } as const
const REDACTED_SECRET_VALUE = { type: 'redacted', label: 'Redacted value' } as const

type RedactedValue =
  | typeof REDACTED_FILE_VALUE
  | typeof REDACTED_CREDENTIAL_VALUE
  | typeof REDACTED_SECRET_VALUE

function isUserFileLike(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.key === 'string' &&
    typeof value.url === 'string' &&
    typeof value.name === 'string'
  )
}

function isFileFieldKey(key: string): boolean {
  return key === 'file' || key === 'files' || /(^|[_-])files?$/i.test(key) || /Files?$/u.test(key)
}

function containsUserFile(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsUserFile)
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return isUserFileLike(record) || containsUserFile(record.value)
}

function redactWorkflowSubBlock(key: string, value: unknown, redactedValue: RedactedValue) {
  const original =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  return {
    ...original,
    id: typeof original.id === 'string' ? original.id : key,
    type: typeof original.type === 'string' ? original.type : redactedValue.type,
    value: redactedValue,
  }
}

function sanitizeWorkflowSnapshotValue(
  value: unknown,
  options?: { insideSubBlocks?: boolean; preserveWorkspaceFiles?: boolean }
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeWorkflowSnapshotValue(item, options))
  }
  if (!value || typeof value !== 'object') return value

  if (isUserFileLike(value as Record<string, unknown>) && !options?.preserveWorkspaceFiles) {
    return REDACTED_FILE_VALUE
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalized = key.toLowerCase()
    if (isFileFieldKey(key)) {
      if (options?.preserveWorkspaceFiles && containsUserFile(nestedValue)) {
        sanitized[key] = sanitizeWorkflowSnapshotValue(nestedValue, options)
        continue
      }
      sanitized[key] = options?.insideSubBlocks
        ? redactWorkflowSubBlock(key, nestedValue, REDACTED_FILE_VALUE)
        : REDACTED_FILE_VALUE
      continue
    }
    if (normalized.includes('credential')) {
      sanitized[key] = options?.insideSubBlocks
        ? redactWorkflowSubBlock(key, nestedValue, REDACTED_CREDENTIAL_VALUE)
        : REDACTED_CREDENTIAL_VALUE
      continue
    }
    if (SENSITIVE_KEY_PARTS.some((needle) => normalized.includes(needle))) {
      sanitized[key] = options?.insideSubBlocks
        ? redactWorkflowSubBlock(key, nestedValue, REDACTED_SECRET_VALUE)
        : REDACTED_SECRET_VALUE
      continue
    }
    if (normalized.includes('log') || normalized.includes('debug')) continue
    sanitized[key] = sanitizeWorkflowSnapshotValue(nestedValue, {
      insideSubBlocks: key === 'subBlocks',
      preserveWorkspaceFiles: options?.preserveWorkspaceFiles,
    })
  }

  return sanitized
}

/** Removes sensitive fields before workflow state is stored as a publication snapshot. */
export function sanitizeWorkflowSnapshot(
  value: unknown,
  options?: { preserveWorkspaceFiles?: boolean }
): unknown {
  return sanitizeWorkflowSnapshotValue(value, options)
}
