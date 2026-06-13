#!/usr/bin/env bun

interface CheckOptions {
  apiKey?: string
  baseUrl?: string
  help: boolean
  json: boolean
  timeoutMs: number
  url?: string
}

const DEFAULT_TIMEOUT_MS = 10_000
const HEALTH_PATH = '/api/internal/hermes/health'

function usage(): string {
  return [
    'Usage: bun run scripts/check-hermes-health.ts [options]',
    '',
    'Options:',
    '  --url <url>          Full SIM Hermes health URL.',
    '  --base-url <url>     SIM app base URL; the script appends /api/internal/hermes/health.',
    '  --api-key <key>      Internal API key; defaults to INTERNAL_API_SECRET.',
    '  --timeout-ms <ms>    Request timeout; defaults to 10000.',
    '  --json               Print structured probe output.',
    '  --help               Show this help message.',
    '',
    'Environment fallbacks:',
    '  SIM_HERMES_HEALTH_URL, SIM_APP_URL, NEXT_PUBLIC_APP_URL, BETTER_AUTH_URL, VERCEL_URL',
    '  INTERNAL_API_SECRET, HERMES_HEALTH_TIMEOUT_MS',
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

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withProtocol.endsWith('/') ? withProtocol.slice(0, -1) : withProtocol
}

function parseArgs(argv: string[]): CheckOptions {
  const options: CheckOptions = {
    apiKey: process.env.INTERNAL_API_SECRET,
    baseUrl:
      process.env.SIM_APP_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.BETTER_AUTH_URL ??
      process.env.VERCEL_URL,
    help: false,
    json: false,
    timeoutMs: parsePositiveInt(process.env.HERMES_HEALTH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    url: process.env.SIM_HERMES_HEALTH_URL,
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

async function main(): Promise<void> {
  let options: CheckOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`
    )
    process.exit(2)
  }

  if (options.help) {
    process.stdout.write(`${usage()}\n`)
    return
  }

  const healthUrl = resolveHealthUrl(options)
  if (!healthUrl) {
    process.stderr.write(`Missing SIM health URL.\n\n${usage()}\n`)
    process.exit(2)
  }
  if (!options.apiKey?.trim()) {
    process.stderr.write(`Missing INTERNAL_API_SECRET or --api-key.\n\n${usage()}\n`)
    process.exit(2)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await fetch(healthUrl, {
      headers: {
        accept: 'application/json',
        'x-api-key': options.apiKey,
      },
      signal: controller.signal,
    })
    const payload = await readJson(response)
    const record = asRecord(payload)
    const healthy = response.status === 200 && record?.ok === true

    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ healthy, status: response.status, url: healthUrl, payload }, null, 2)}\n`
      )
    } else if (healthy) {
      process.stdout.write(
        `Hermes health check passed: ${record?.status ?? 'healthy'} at ${healthUrl}\n`
      )
    } else {
      process.stderr.write(
        `Hermes health check failed: HTTP ${response.status}, status=${String(
          record?.status ?? 'unknown'
        )}, error=${String(record?.error ?? 'not reported')}\n`
      )
    }

    if (!healthy) process.exit(1)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`Hermes health check request failed: ${message}\n`)
    process.exit(1)
  } finally {
    clearTimeout(timeout)
  }
}

void main()
