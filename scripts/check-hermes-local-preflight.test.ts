import { describe, expect, it } from 'vitest'
import { parseArgs, parseDotEnv, runHermesLocalPreflight } from './check-hermes-local-preflight'

const HERMES_HOME = 'E:\\project\\.hermes-sim-dev'
const HERMES_CONFIG = `${HERMES_HOME}\\config.yaml`
const SAFE_HERMES_CONFIG = [
  'plugins:',
  '  enabled:',
  '    - sim',
  'memory:',
  '  provider: sim',
  'platform_toolsets:',
  '  api_server:',
  '    - sim',
  '    - memory',
  '    - skills',
  '    - session_search',
].join('\n')

function makeIo(params: {
  connections?: Record<string, boolean>
  existing?: string[]
  files?: Record<string, string>
}) {
  const stdout: string[] = []
  const stderr: string[] = []
  const existing = new Set(params.existing ?? [])
  const files = params.files ?? {}
  return {
    io: {
      canConnect: async (host: string, port: number) =>
        params.connections?.[`${host}:${port}`] ?? false,
      exists: async (filePath: string) => existing.has(filePath),
      readText: async (filePath: string) => files[filePath] ?? null,
      stderr: (message: string) => stderr.push(message),
      stdout: (message: string) => stdout.push(message),
    },
    stderr,
    stdout,
  }
}

describe('check-hermes-local-preflight', () => {
  it('parses dotenv files without exposing comments or invalid keys', () => {
    expect(
      parseDotEnv(`
        # ignored
        export HERMES_API_KEY="abc"
        SIM_SERVICE_TOKEN='token'
        invalid-key=value
      `)
    ).toEqual({
      HERMES_API_KEY: 'abc',
      SIM_SERVICE_TOKEN: 'token',
    })
  })

  it('derives default Hermes repo and env paths from the SIM checkout', () => {
    const options = parseArgs([], {}, 'E:\\project\\sim')

    expect(options.simEnvFile).toBe('E:\\project\\sim\\apps\\sim\\.env')
    expect(options.hermesRepoPath).toBe('E:\\project\\hermes-agent-sim')
    expect(options.hermesEnvFile).toBe('E:\\project\\hermes-agent-sim\\.env')
  })

  it('keeps an explicit Hermes env path when the repo flag is parsed later', () => {
    const options = parseArgs(
      ['--hermes-env', 'E:\\custom\\hermes.env', '--hermes-repo', 'E:\\project\\hermes-agent-sim'],
      {},
      'E:\\project\\sim'
    )

    expect(options.hermesRepoPath).toBe('E:\\project\\hermes-agent-sim')
    expect(options.hermesEnvFile).toBe('E:\\custom\\hermes.env')
  })

  it('passes when required env, token matches, plugin, and listeners are ready', async () => {
    const cwd = 'E:\\project\\sim'
    const simEnv = 'E:\\project\\sim\\apps\\sim\\.env'
    const hermesEnv = 'E:\\project\\hermes-agent-sim\\.env'
    const token = 's'.repeat(32)
    const apiKey = 'api-key'
    const { io, stdout, stderr } = makeIo({
      connections: {
        '127.0.0.1:3000': true,
        '127.0.0.1:8642': true,
      },
      existing: ['E:\\project\\hermes-agent-sim\\plugins\\sim\\tools.py'],
      files: {
        [simEnv]: [
          'DATABASE_URL=postgres://local',
          'INTERNAL_API_SECRET=internal',
          'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000',
          'HERMES_API_URL=http://127.0.0.1:8642',
          `HERMES_API_KEY=${apiKey}`,
          `HERMES_SERVICE_TOKEN=${token}`,
        ].join('\n'),
        [hermesEnv]: [
          'API_SERVER_ENABLED=true',
          `API_SERVER_KEY=${apiKey}`,
          'SIM_INTERNAL_API_URL=http://127.0.0.1:3000',
          `SIM_SERVICE_TOKEN=${token}`,
          `HERMES_HOME=${HERMES_HOME}`,
          'OPENROUTER_API_KEY=provider-key',
        ].join('\n'),
        [HERMES_CONFIG]: SAFE_HERMES_CONFIG,
      },
    })

    const exitCode = await runHermesLocalPreflight(['--require-services'], {}, cwd, io)

    expect(exitCode).toBe(0)
    expect(stdout.join('')).toContain('SIM Hermes local preflight: PASS')
    expect(stderr.join('')).toBe('')
  })

  it('fails on missing env, weak token, and auth mismatches without printing secrets', async () => {
    const cwd = 'E:\\project\\sim'
    const simEnv = 'E:\\project\\sim\\apps\\sim\\.env'
    const hermesEnv = 'E:\\project\\hermes-agent-sim\\.env'
    const { io, stdout } = makeIo({
      existing: ['E:\\project\\hermes-agent-sim\\plugins\\sim\\tools.py'],
      files: {
        [simEnv]: [
          'DATABASE_URL=postgres://local',
          'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000',
          'HERMES_API_URL=http://127.0.0.1:8642',
          'HERMES_API_KEY=sim-secret',
          'HERMES_SERVICE_TOKEN=short',
        ].join('\n'),
        [hermesEnv]: [
          'API_SERVER_ENABLED=false',
          'API_SERVER_KEY=hermes-secret',
          'SIM_INTERNAL_API_URL=http://127.0.0.1:3000',
          'SIM_SERVICE_TOKEN=different-service-token-with-enough-length',
        ].join('\n'),
      },
    })

    const exitCode = await runHermesLocalPreflight([], {}, cwd, io)
    const output = stdout.join('')

    expect(exitCode).toBe(1)
    expect(output).toContain('missing INTERNAL_API_SECRET')
    expect(output).toContain('HERMES_SERVICE_TOKEN must be at least 32 chars')
    expect(output).toContain('API_SERVER_ENABLED must be true, yes, on, or 1')
    expect(output).toContain('SIM HERMES_API_KEY and Hermes API_SERVER_KEY: mismatch')
    expect(output).not.toContain('sim-secret')
    expect(output).not.toContain('hermes-secret')
  })

  it('fails listener checks only when services are required', async () => {
    const cwd = 'E:\\project\\sim'
    const simEnv = 'E:\\project\\sim\\apps\\sim\\.env'
    const hermesEnv = 'E:\\project\\hermes-agent-sim\\.env'
    const token = 's'.repeat(32)
    const { io } = makeIo({
      connections: {
        '127.0.0.1:3000': false,
        '127.0.0.1:8642': false,
      },
      existing: ['E:\\project\\hermes-agent-sim\\plugins\\sim\\tools.py'],
      files: {
        [simEnv]: [
          'DATABASE_URL=postgres://local',
          'INTERNAL_API_SECRET=internal',
          'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000',
          'HERMES_API_URL=http://127.0.0.1:8642',
          'HERMES_API_KEY=api-key',
          `HERMES_SERVICE_TOKEN=${token}`,
        ].join('\n'),
        [hermesEnv]: [
          'API_SERVER_ENABLED=true',
          'API_SERVER_KEY=api-key',
          'SIM_INTERNAL_API_URL=http://127.0.0.1:3000',
          `SIM_SERVICE_TOKEN=${token}`,
          `HERMES_HOME=${HERMES_HOME}`,
        ].join('\n'),
        [HERMES_CONFIG]: SAFE_HERMES_CONFIG,
      },
    })

    await expect(runHermesLocalPreflight([], {}, cwd, io)).resolves.toBe(0)
    await expect(runHermesLocalPreflight(['--require-services'], {}, cwd, io)).resolves.toBe(1)
  })

  it('can require a Hermes LLM provider key for full E2E readiness', async () => {
    const cwd = 'E:\\project\\sim'
    const simEnv = 'E:\\project\\sim\\apps\\sim\\.env'
    const hermesEnv = 'E:\\project\\hermes-agent-sim\\.env'
    const token = 's'.repeat(32)
    const { io, stdout } = makeIo({
      existing: ['E:\\project\\hermes-agent-sim\\plugins\\sim\\tools.py'],
      files: {
        [simEnv]: [
          'DATABASE_URL=postgres://local',
          'INTERNAL_API_SECRET=internal',
          'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000',
          'HERMES_API_URL=http://127.0.0.1:8642',
          'HERMES_API_KEY=api-key',
          `HERMES_SERVICE_TOKEN=${token}`,
        ].join('\n'),
        [hermesEnv]: [
          'API_SERVER_ENABLED=true',
          'API_SERVER_KEY=api-key',
          'SIM_INTERNAL_API_URL=http://127.0.0.1:3000',
          `SIM_SERVICE_TOKEN=${token}`,
          `HERMES_HOME=${HERMES_HOME}`,
        ].join('\n'),
        [HERMES_CONFIG]: SAFE_HERMES_CONFIG,
      },
    })

    const exitCode = await runHermesLocalPreflight(['--require-llm'], {}, cwd, io)

    expect(exitCode).toBe(1)
    expect(stdout.join('')).toContain('missing one of OPENROUTER_API_KEY')
  })

  it('accepts direct-provider Hermes LLM keys for local E2E readiness', async () => {
    const cwd = 'E:\\project\\sim'
    const simEnv = 'E:\\project\\sim\\apps\\sim\\.env'
    const hermesEnv = 'E:\\project\\hermes-agent-sim\\.env'
    const token = 's'.repeat(32)
    const { io, stdout } = makeIo({
      existing: ['E:\\project\\hermes-agent-sim\\plugins\\sim\\tools.py'],
      files: {
        [simEnv]: [
          'DATABASE_URL=postgres://local',
          'INTERNAL_API_SECRET=internal',
          'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000',
          'HERMES_API_URL=http://127.0.0.1:8642',
          'HERMES_API_KEY=api-key',
          `HERMES_SERVICE_TOKEN=${token}`,
        ].join('\n'),
        [hermesEnv]: [
          'API_SERVER_ENABLED=true',
          'API_SERVER_KEY=api-key',
          'SIM_INTERNAL_API_URL=http://127.0.0.1:3000',
          `SIM_SERVICE_TOKEN=${token}`,
          `HERMES_HOME=${HERMES_HOME}`,
          'DEEPSEEK_API_KEY=provider-key',
        ].join('\n'),
        [HERMES_CONFIG]: SAFE_HERMES_CONFIG,
      },
    })

    const exitCode = await runHermesLocalPreflight(['--require-llm'], {}, cwd, io)

    expect(exitCode).toBe(0)
    expect(stdout.join('')).toContain('found DEEPSEEK_API_KEY')
  })

  it('fails when Hermes config omits the SIM plugin or exposes forbidden toolsets', async () => {
    const cwd = 'E:\\project\\sim'
    const simEnv = 'E:\\project\\sim\\apps\\sim\\.env'
    const hermesEnv = 'E:\\project\\hermes-agent-sim\\.env'
    const token = 's'.repeat(32)
    const { io, stdout } = makeIo({
      existing: ['E:\\project\\hermes-agent-sim\\plugins\\sim\\tools.py'],
      files: {
        [simEnv]: [
          'DATABASE_URL=postgres://local',
          'INTERNAL_API_SECRET=internal',
          'NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000',
          'HERMES_API_URL=http://127.0.0.1:8642',
          'HERMES_API_KEY=api-key',
          'HERMES_REQUIRED_TOOLSETS=sim,memory',
          `HERMES_SERVICE_TOKEN=${token}`,
        ].join('\n'),
        [hermesEnv]: [
          'API_SERVER_ENABLED=true',
          'API_SERVER_KEY=api-key',
          'SIM_INTERNAL_API_URL=http://127.0.0.1:3000',
          `SIM_SERVICE_TOKEN=${token}`,
          `HERMES_HOME=${HERMES_HOME}`,
          'OPENROUTER_API_KEY=provider-key',
        ].join('\n'),
        [HERMES_CONFIG]: [
          'plugins:',
          '  enabled:',
          '    - browser',
          'memory:',
          '  provider: local',
          'platform_toolsets:',
          '  api_server: [sim, terminal]',
        ].join('\n'),
      },
    })

    const exitCode = await runHermesLocalPreflight([], {}, cwd, io)
    const output = stdout.join('')

    expect(exitCode).toBe(1)
    expect(output).toContain('plugins.enabled missing sim')
    expect(output).toContain('memory.provider must be sim')
    expect(output).toContain('platform_toolsets.api_server missing memory')
    expect(output).toContain('forbidden toolsets enabled: terminal')
  })
})
