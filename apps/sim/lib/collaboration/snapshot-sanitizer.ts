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

/** Removes sensitive fields before workflow state is stored as a publication snapshot. */
export function sanitizeWorkflowSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeWorkflowSnapshot(item))
  if (!value || typeof value !== 'object') return value

  const sanitized: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalized = key.toLowerCase()
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
