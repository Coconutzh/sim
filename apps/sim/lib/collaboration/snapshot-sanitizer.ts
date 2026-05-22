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

const REDACTED_FILE_VALUE = { type: 'file', label: '已隐藏文件' } as const

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

/** Removes sensitive fields before workflow state is stored as a publication snapshot. */
export function sanitizeWorkflowSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeWorkflowSnapshot(item))
  if (!value || typeof value !== 'object') return value

  if (isUserFileLike(value as Record<string, unknown>)) {
    return REDACTED_FILE_VALUE
  }

  const sanitized: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalized = key.toLowerCase()
    if (isFileFieldKey(key)) {
      sanitized[key] = REDACTED_FILE_VALUE
      continue
    }
    if (normalized.includes('credential')) {
      sanitized[key] = { type: 'credential', label: '已配置凭证' }
      continue
    }
    if (SENSITIVE_KEY_PARTS.some((needle) => normalized.includes(needle))) {
      sanitized[key] = { type: 'redacted', label: '已隐藏' }
      continue
    }
    if (normalized.includes('log') || normalized.includes('debug')) continue
    sanitized[key] = sanitizeWorkflowSnapshot(nestedValue)
  }

  return sanitized
}
