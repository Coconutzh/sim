#!/usr/bin/env bun

type NotifyOn = 'failure' | 'always' | 'never'

interface CheckOptions {
  apiKey?: string
  baseUrl?: string
  help: boolean
  json: boolean
  notifyOn: NotifyOn
  notifyUrl?: string
  timeoutMs: number
  url?: string
}

interface HealthProbeResult {
  checkedAt: string
  error?: string
  healthy: boolean
  payload: unknown
  status: number
  url: string
}

interface NotificationResult {
  attempted: boolean
  error?: string
  ok: boolean
  status?: number
}

interface CheckRunResult extends HealthProbeResult {
  notification: NotificationResult
}

interface CheckIo {
  stderr: (message: string) => void
  stdout: (message: string) => void
}

const DEFAULT_TIMEOUT_MS = 10_000
const HEALTH_PATH = '/api/internal/hermes/health'

function usage(): string {
  return [
    'Usage: bun run scripts/check-hermes-health.ts [options]',
    '',
    'Options:',
    '  --url <url>             Full SIM Hermes health URL.',
    '  --base-url <url>        SIM app base URL; the script appends /api/internal/hermes/health.',
    '  --api-key <key>         Internal API key; defaults to INTERNAL_API_SECRET.',
    '  --timeout-ms <ms>       Request timeout; defaults to 10000.',
    '  --notify-url <url>      Optional webhook URL for release-gate health alerts.',
    '  --notify-on <mode>      Alert mode: failure, always, or never; defaults to failure.',
    '  --json                  Print structured probe output.',
    '  --help                  Show this help message.',
    '',
    'Environment fallbacks:',
    '  SIM_HERMES_HEALTH_URL, SIM_APP_URL, NEXT_PUBLIC_APP_URL, BETTER_AUTH_URL, VERCEL_URL',
    '  INTERNAL_API_SECRET, HERMES_HEALTH_TIMEOUT_MS',
    '  HERMES_HEALTH_NOTIFY_URL, HERMES_HEALTH_NOTIFY_ON',
  ].join('\n')
}

function readNext(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return value
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function normalizeNotifyOn(value: string | undefined): NotifyOn {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'always' || normalized === 'never' || normalized === 'failure') {
    return normalized
  }
  return 'failure'
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.endsWith('/') ? withProtocol.slice(0, -1) : withProtocol
}

export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): CheckOptions {
  const options: CheckOptions = {
    apiKey: env.INTERNAL_API_SECRET,
    baseUrl: env.SIM_APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? env.BETTER_AUTH_URL ?? env.VERCEL_URL,
    help: false,
    json: false,
    notifyOn: normalizeNotifyOn(env.HERMES_HEALTH_NOTIFY_ON),
    notifyUrl: env.HERMES_HEALTH_NOTIFY_URL,
    timeoutMs: parsePositiveInt(env.HERMES_HEALTH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    url: env.SIM_HERMES_HEALTH_URL,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--api-key':
        options.apiKey = readNext(argv, index, arg)
        index += 1
        break
      case '--base-url':
        options.baseUrl = readNext(argv, index, arg)
        index += 1
        break
      case '--help':
      case '-h':
        options.help = true
        break
      case '--json':
        options.json = true
        break
      case '--notify-on':
        options.notifyOn = normalizeNotifyOn(readNext(argv, index, arg))
        index += 1
        break
      case '--notify-url':
        options.notifyUrl = readNext(argv, index, arg)
        index += 1
        break
      case '--timeout-ms':
        options.timeoutMs = parsePositiveInt(readNext(argv, index, arg), DEFAULT_TIMEOUT_MS)
        index += 1
        break
      case '--url':
        options.url = readNext(argv, index, arg)
        index += 1
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function resolveHealthUrl(options: CheckOptions): string {
  if (options.url?.trim()) return options.url.trim()
  if (!options.baseUrl?.trim()) return ''
  return `${normalizeBaseUrl(options.baseUrl)}${HEALTH_PATH}`
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { raw: text }
  }
}

export async function probeHermesHealth(options: CheckOptions): Promise<HealthProbeResult> {
  const healthUrl = resolveHealthUrl(options)
  const checkedAt = new Date().toISOString()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

  try {
    const response = await fetch(healthUrl, {
      headers: {
        accept: 'application/json',
        'x-api-key': options.apiKey ?? '',
      },
      signal: controller.signal,
    })
    const payload = await readJson(response)
    const record = asRecord(payload)
    const healthy = response.status === 200 && record?.ok === true
    return {
      checkedAt,
      error: healthy ? undefined : String(record?.error ?? 'not reported'),
      healthy,
      payload,
      status: response.status,
      url: healthUrl,
    }
  } catch (error) {
    return {
      checkedAt,
      error: error instanceof Error ? error.message : String(error),
      healthy: false,
      payload: {},
      status: 0,
      url: healthUrl,
    }
  } finally {
    clearTimeout(timeout)
  }
}

function shouldNotify(options: CheckOptions, result: HealthProbeResult): boolean {
  if (!options.notifyUrl?.trim() || options.notifyOn === 'never') return false
  return options.notifyOn === 'always' || !result.healthy
}

export async function notifyHermesHealth(
  options: CheckOptions,
  result: HealthProbeResult
): Promise<NotificationResult> {
  if (!shouldNotify(options, result)) return { attempted: false, ok: true }

  try {
    const response = await fetch(options.notifyUrl as string, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'sim-hermes-health',
        healthy: result.healthy,
        status: result.status,
        url: result.url,
        checkedAt: result.checkedAt,
        error: result.error,
        payload: result.payload,
      }),
    })
    return { attempted: true, ok: response.ok, status: response.status }
  } catch (error) {
    return {
      attempted: true,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    }
  }
}

export async function runHermesHealthCheck(
  argv: string[],
  io: CheckIo = {
    stderr: (message) => process.stderr.write(message),
    stdout: (message) => process.stdout.write(message),
  }
): Promise<number> {
  let options: CheckOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`)
    return 2
  }

  if (options.help) {
    io.stdout(`${usage()}\n`)
    return 0
  }

  const healthUrl = resolveHealthUrl(options)
  if (!healthUrl) {
    io.stderr(`Missing SIM health URL.\n\n${usage()}\n`)
    return 2
  }
  if (!options.apiKey?.trim()) {
    io.stderr(`Missing INTERNAL_API_SECRET or --api-key.\n\n${usage()}\n`)
    return 2
  }

  const result = await probeHermesHealth(options)
  const notification = await notifyHermesHealth(options, result)
  const output: CheckRunResult = { ...result, notification }

  if (options.json) {
    io.stdout(`${JSON.stringify(output, null, 2)}\n`)
  } else if (result.healthy) {
    const record = asRecord(result.payload)
    io.stdout(`Hermes health check passed: ${record?.status ?? 'healthy'} at ${healthUrl}\n`)
  } else if (result.status === 0) {
    io.stderr(`Hermes health check request failed: ${result.error ?? 'unknown error'}\n`)
  } else {
    const record = asRecord(result.payload)
    io.stderr(
      `Hermes health check failed: HTTP ${result.status}, status=${String(
        record?.status ?? 'unknown'
      )}, error=${String(record?.error ?? 'not reported')}\n`
    )
  }

  if (notification.attempted && !notification.ok) {
    io.stderr(
      `Hermes health notification failed: ${notification.status ?? 'request error'}${
        notification.error ? `, error=${notification.error}` : ''
      }\n`
    )
  }

  return result.healthy ? 0 : 1
}

async function main(): Promise<void> {
  const exitCode = await runHermesHealthCheck(process.argv.slice(2))
  if (exitCode !== 0) process.exit(exitCode)
}

if (import.meta.main) {
  void main()
}
