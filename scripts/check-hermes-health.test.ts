import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseArgs, runHermesHealthCheck } from './check-hermes-health'

const ENV_KEYS = [
  'BETTER_AUTH_URL',
  'HERMES_HEALTH_NOTIFY_ON',
  'HERMES_HEALTH_NOTIFY_URL',
  'HERMES_HEALTH_TIMEOUT_MS',
  'INTERNAL_API_SECRET',
  'NEXT_PUBLIC_APP_URL',
  'SIM_APP_URL',
  'SIM_HERMES_HEALTH_URL',
  'VERCEL_URL',
] as const

const originalEnv = new Map<string, string | undefined>()

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function captureIo() {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    io: {
      stderr: (message: string) => stderr.push(message),
      stdout: (message: string) => stdout.push(message),
    },
    stderr,
    stdout,
  }
}

describe('check-hermes-health', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    originalEnv.clear()
    for (const key of ENV_KEYS) {
      originalEnv.set(key, process.env[key])
      delete process.env[key]
    }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key)
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  it('parses notification options from flags and environment', () => {
    const options = parseArgs(['--notify-url', 'https://hooks.local/a', '--notify-on', 'always'], {
      HERMES_HEALTH_NOTIFY_ON: 'never',
      HERMES_HEALTH_NOTIFY_URL: 'https://hooks.local/env',
      INTERNAL_API_SECRET: 'secret',
      SIM_APP_URL: 'https://sim.local',
    })

    expect(options.notifyUrl).toBe('https://hooks.local/a')
    expect(options.notifyOn).toBe('always')
    expect(options.apiKey).toBe('secret')
  })

  it('sends a failure notification with sanitized health context', async () => {
    process.env.INTERNAL_API_SECRET = 'secret'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://sim.local/api/internal/hermes/health') {
        expect((init?.headers as Record<string, string>)['x-api-key']).toBe('secret')
        return jsonResponse({ ok: false, status: 'degraded', error: 'missing toolsets: sim' }, 503)
      }
      if (url === 'https://hooks.local/hermes') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(body.source).toBe('sim-hermes-health')
        expect(body.healthy).toBe(false)
        expect(body.status).toBe(503)
        expect(body.error).toBe('missing toolsets: sim')
        expect(JSON.stringify(body)).not.toContain('secret')
        return new Response(null, { status: 204 })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { io, stderr, stdout } = captureIo()

    const exitCode = await runHermesHealthCheck(
      ['--base-url', 'sim.local', '--notify-url', 'https://hooks.local/hermes', '--json'],
      io
    )

    expect(exitCode).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(stdout.join('')).toContain('"notification"')
    expect(stderr.join('')).toBe('')
  })

  it('does not notify on healthy checks when notify-on defaults to failure', async () => {
    process.env.INTERNAL_API_SECRET = 'secret'
    process.env.HERMES_HEALTH_NOTIFY_URL = 'https://hooks.local/hermes'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://sim.local/api/internal/hermes/health') {
        return jsonResponse({ ok: true, status: 'healthy' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { io } = captureIo()

    const exitCode = await runHermesHealthCheck(['--base-url', 'https://sim.local'], io)

    expect(exitCode).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('can notify on healthy checks when notify-on is always', async () => {
    process.env.INTERNAL_API_SECRET = 'secret'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === 'https://sim.local/api/internal/hermes/health') {
        return jsonResponse({ ok: true, status: 'healthy' })
      }
      if (url === 'https://hooks.local/hermes') return new Response(null, { status: 204 })
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { io } = captureIo()

    const exitCode = await runHermesHealthCheck(
      [
        '--base-url',
        'https://sim.local',
        '--notify-url',
        'https://hooks.local/hermes',
        '--notify-on',
        'always',
      ],
      io
    )

    expect(exitCode).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
