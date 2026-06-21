import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDotEnv } from './check-hermes-local-preflight'
import { parseArgs, runHermesLocalEnvSetup } from './setup-hermes-local-env'

const tempRoots: string[] = []

async function tempWorkspace(): Promise<{ cwd: string; hermesRepo: string; simEnv: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sim-hermes-env-'))
  tempRoots.push(root)
  const cwd = path.join(root, 'sim')
  const hermesRepo = path.join(root, 'hermes-agent-sim')
  const simEnv = path.join(cwd, 'apps', 'sim', '.env')
  await mkdir(path.dirname(simEnv), { recursive: true })
  await writeFile(
    simEnv,
    [
      'DATABASE_URL=postgres://local',
      'INTERNAL_API_SECRET=internal-secret',
      'BETTER_AUTH_URL=http://127.0.0.1:3000',
    ].join('\n'),
    'utf8'
  )
  await mkdir(path.join(hermesRepo, 'plugins', 'sim'), { recursive: true })
  await writeFile(path.join(hermesRepo, 'plugins', 'sim', 'tools.py'), '# plugin', 'utf8')
  return { cwd, hermesRepo, simEnv }
}

afterEach(async () => {
  await Promise.allSettled(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  )
})

describe('Hermes local env setup', () => {
  it('uses repository-relative defaults', () => {
    const cwd = path.join('E:', 'project', 'sim')
    const options = parseArgs([], cwd)

    expect(options.simEnvFile).toBe(path.join(cwd, 'apps', 'sim', '.env'))
    expect(options.hermesRepoPath).toBe(path.join('E:', 'project', 'hermes-agent-sim'))
    expect(options.hermesEnvFile).toBe(path.join('E:', 'project', 'hermes-agent-sim', '.env'))
    expect(options.hermesHome).toBe(path.join('E:', 'project', '.hermes-sim-local'))
  })

  it('creates matching SIM and Hermes env values plus safe config', async () => {
    const { cwd, hermesRepo, simEnv } = await tempWorkspace()
    let stdout = ''

    const exitCode = await runHermesLocalEnvSetup(['--hermes-repo', hermesRepo], cwd, {
      mkdirp: async (dirPath) => {
        await mkdir(dirPath, { recursive: true })
      },
      readText: async (filePath) => readFile(filePath, 'utf8').catch(() => null),
      stderr: () => undefined,
      stdout: (message) => {
        stdout += message
      },
      writeText: async (filePath, content) => {
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, content, 'utf8')
      },
    })

    const hermesEnvFile = path.join(hermesRepo, '.env')
    const hermesHome = path.resolve(path.dirname(cwd), '.hermes-sim-local')
    const simValues = parseDotEnv(await readFile(simEnv, 'utf8'))
    const hermesValues = parseDotEnv(await readFile(hermesEnvFile, 'utf8'))
    const config = await readFile(path.join(hermesHome, 'config.yaml'), 'utf8')

    expect(exitCode).toBe(0)
    expect(simValues.HERMES_API_KEY).toBe(hermesValues.API_SERVER_KEY)
    expect(simValues.HERMES_SERVICE_TOKEN).toBe(hermesValues.SIM_SERVICE_TOKEN)
    expect(hermesValues.SIM_INTERNAL_API_URL).toBe('http://127.0.0.1:3000')
    expect(hermesValues.HERMES_HOME).toBe(hermesHome)
    expect(hermesValues.SIM_PPT_CODEX_SKILL_ROOT).toBe(
      path.resolve(path.dirname(cwd), 'codex-ppt-skill', 'skills', 'codex-ppt')
    )
    expect(config).toContain('provider: sim')
    expect(config).toContain('    - sim')
    expect(stdout).not.toContain(simValues.HERMES_API_KEY)
    expect(stdout).not.toContain(simValues.HERMES_SERVICE_TOKEN)
  })

  it('copies the SIM Evolink key for codex-ppt subprocesses without printing it', async () => {
    const { cwd, hermesRepo, simEnv } = await tempWorkspace()
    const evolinkKey = 'sk-evolink-local-key-that-is-not-printed'
    await writeFile(
      simEnv,
      [
        'DATABASE_URL=postgres://local',
        'INTERNAL_API_SECRET=internal-secret',
        'BETTER_AUTH_URL=http://127.0.0.1:3000',
        `EVOLINK_API_KEY=${evolinkKey}`,
      ].join('\n'),
      'utf8'
    )
    let stdout = ''

    const exitCode = await runHermesLocalEnvSetup(['--hermes-repo', hermesRepo], cwd, {
      mkdirp: async (dirPath) => {
        await mkdir(dirPath, { recursive: true })
      },
      readText: async (filePath) => readFile(filePath, 'utf8').catch(() => null),
      stderr: () => undefined,
      stdout: (message) => {
        stdout += message
      },
      writeText: async (filePath, content) => {
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, content, 'utf8')
      },
    })

    const hermesValues = parseDotEnv(await readFile(path.join(hermesRepo, '.env'), 'utf8'))

    expect(exitCode).toBe(0)
    expect(hermesValues.SIM_PPT_EVOLINK_API_KEY).toBe(evolinkKey)
    expect(stdout).toContain('SIM_PPT_EVOLINK_API_KEY')
    expect(stdout).not.toContain(evolinkKey)
  })

  it('copies a compatible local SIM LLM key and creates Hermes model config without printing it', async () => {
    const { cwd, hermesRepo, simEnv } = await tempWorkspace()
    const deepseekKey = 'sk-deepseek-local-key-that-is-not-printed'
    await writeFile(
      simEnv,
      [
        'DATABASE_URL=postgres://local',
        'INTERNAL_API_SECRET=internal-secret',
        'BETTER_AUTH_URL=http://127.0.0.1:3000',
        'LOCAL_COPILOT_PROVIDER=deepseek',
        'LOCAL_COPILOT_MODEL=deepseek-chat',
        `DEEPSEEK_API_KEY=${deepseekKey}`,
      ].join('\n'),
      'utf8'
    )
    let stdout = ''

    const exitCode = await runHermesLocalEnvSetup(['--hermes-repo', hermesRepo], cwd, {
      mkdirp: async (dirPath) => {
        await mkdir(dirPath, { recursive: true })
      },
      readText: async (filePath) => readFile(filePath, 'utf8').catch(() => null),
      stderr: () => undefined,
      stdout: (message) => {
        stdout += message
      },
      writeText: async (filePath, content) => {
        await mkdir(path.dirname(filePath), { recursive: true })
        await writeFile(filePath, content, 'utf8')
      },
    })

    const hermesEnvFile = path.join(hermesRepo, '.env')
    const hermesHome = path.resolve(path.dirname(cwd), '.hermes-sim-local')
    const hermesValues = parseDotEnv(await readFile(hermesEnvFile, 'utf8'))
    const config = await readFile(path.join(hermesHome, 'config.yaml'), 'utf8')

    expect(exitCode).toBe(0)
    expect(hermesValues.DEEPSEEK_API_KEY).toBe(deepseekKey)
    expect(config).toContain('model:')
    expect(config).toContain('  provider: deepseek')
    expect(config).toContain('  default: deepseek-chat')
    expect(stdout).toContain('DEEPSEEK_API_KEY')
    expect(stdout).not.toContain(deepseekKey)
  })

  it('fails safely when existing cross-service tokens conflict', async () => {
    const { cwd, hermesRepo, simEnv } = await tempWorkspace()
    await writeFile(
      simEnv,
      [
        'DATABASE_URL=postgres://local',
        'INTERNAL_API_SECRET=internal-secret',
        'BETTER_AUTH_URL=http://127.0.0.1:3000',
        'HERMES_API_KEY=sim_token_value_that_is_long_enough_123',
      ].join('\n'),
      'utf8'
    )
    await writeFile(
      path.join(hermesRepo, '.env'),
      'API_SERVER_KEY=hermes_token_value_that_is_long_enough_123\n',
      'utf8'
    )

    let stderr = ''
    const exitCode = await runHermesLocalEnvSetup(['--hermes-repo', hermesRepo], cwd, {
      mkdirp: async () => undefined,
      readText: async (filePath) => readFile(filePath, 'utf8').catch(() => null),
      stderr: (message) => {
        stderr += message
      },
      stdout: () => undefined,
      writeText: async () => {
        throw new Error('should not write')
      },
    })

    expect(exitCode).toBe(1)
    expect(stderr).toContain('HERMES_API_KEY and API_SERVER_KEY are both set but do not match')
  })
})
