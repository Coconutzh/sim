const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi
const SENSITIVE_FIELD_PATTERN =
  /\b((?:storageKey|storage_key|storagePath|storage_path|key|path|url)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi
const URL_PATTERN = /https?:\/\/[^\s'"<>)]+/gi
const FILE_SERVE_PATH_PATTERN = /\/api\/files\/serve\/[^\s'"<>)]+/gi
const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\[^\s'"<>)]+/g
const ABSOLUTE_STORAGE_PATH_PATTERN =
  /(^|[\s'"])(\/(?:mnt|var|tmp|storage|uploads|private|files)\/[^\s'"<>)]+)/gi
const STORAGE_KEY_PATTERN = /\b(?:uploads|private|storage)\/[^\s'"<>)]+/gi

/**
 * Redacts agent-visible file context so internal storage identifiers do not
 * leak through prompts, tool observations, or final answers.
 */
export function redactAgentVisibleFileContext(value: string): string {
  return value
    .replace(PRIVATE_KEY_BLOCK_PATTERN, '[redacted-private-key]')
    .replace(SENSITIVE_FIELD_PATTERN, '$1[redacted]')
    .replace(URL_PATTERN, '[redacted-url]')
    .replace(FILE_SERVE_PATH_PATTERN, '[redacted-file-url]')
    .replace(WINDOWS_PATH_PATTERN, '[redacted-path]')
    .replace(ABSOLUTE_STORAGE_PATH_PATTERN, '$1[redacted-path]')
    .replace(STORAGE_KEY_PATTERN, '[redacted-storage-key]')
}
