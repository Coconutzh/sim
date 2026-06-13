#!/usr/bin/env bun

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseDotEnv } from './check-hermes-local-preflight'

interface SetupOptions {
  dryRun: boolean
  help: boolean
  hermesApiUrl: string
  hermesEnvFile: string
  hermesHome: string
  hermesRepoPath: string
  simEnvFile: string
  simInternalApiUrl?: string
}

interface SetupIo {
  readText: (filePath: string) => Promise<string | null>
  writeText: (filePath: string, content: string) => Promise<void>
  mkdirp: (dirPath: string) => Promise<void>
  stdout: (message: string) => void
  stderr: (message: string) => void
}

interface EnvFileUpdate {
  content: string
  changedKeys: string[]
}

interface HermesModelPreference {
  envKey?: string
  envValue?: string
  model: string
  provider: string
}

interface LlmProviderMapping {
  defaultModel: string
  hermesEnvKey: string
  provider: string
  providerAliases: readonly string[]
  simEnvKeys: readonly string[]
}

const DEFAULT_HERMES_API_URL = 'http://127.0.0.1:8642'
const DEFAULT_SIM_INTERNAL_API_URL = 'http://127.0.0.1:3000'
const DEFAULT_SIM_ENV_FILE = path.join('apps', 'sim', '.env')
const MIN_TOKEN_LENGTH = 32
const HERMES_LLM_ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'DEEPSEEK_API_KEY',
  'DASHSCOPE_API_KEY',
  'ALIBABA_CODING_PLAN_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'KIMI_API_KEY',
  'GLM_API_KEY',
  'ZAI_API_KEY',
  'Z_AI_API_KEY',
  'OLLAMA_API_KEY',
  'NOVITA_API_KEY',
  'ARCEEAI_API_KEY',
  'MINIMAX_API_KEY',
  'MINIMAX_CN_API_KEY',
  'XAI_API_KEY',
] as const
const LLM_PROVIDER_MAPPINGS = [
  {
    defaultModel: 'deepseek-chat',
    hermesEnvKey: 'DEEPSEEK_API_KEY',
    provider: 'deepseek',
    providerAliases: ['deepseek', 'deep-seek'],
    simEnvKeys: ['DEEPSEEK_API_KEY'],
  },
  {
    defaultModel: 'qwen3.5-plus',
    hermesEnvKey: 'DASHSCOPE_API_KEY',
    provider: 'alibaba',
    providerAliases: ['alibaba', 'dashscope', 'aliyun', 'qwen'],
    simEnvKeys: ['DASHSCOPE_API_KEY'],
  },
  {
    defaultModel: 'gemini-2.5-flash',
    hermesEnvKey: 'GEMINI_API_KEY',
    provider: 'gemini',
    providerAliases: ['gemini', 'google', 'google-gemini', 'google-ai-studio'],
    simEnvKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'CONTENT_TEXT_GEMINI_API_KEY'],
  },
  {
    defaultModel: 'glm-4.6',
    hermesEnvKey: 'GLM_API_KEY',
    provider: 'zai',
    providerAliases: ['zai', 'z.ai', 'glm', 'zhipu', 'zhipuai'],
    simEnvKeys: ['GLM_API_KEY', 'ZAI_API_KEY', 'Z_AI_API_KEY', 'ZHIPU_API_KEY'],
  },
] as const satisfies readonly LlmProviderMapping[]

function usage(): string {
  return [
    'Usage: bun run scripts/setup-hermes-local-env.ts [options]',
    '',
    'Creates missing local SIM/Hermes env entries with matching generated tokens.',
    'Existing values are preserved; mismatched existing cross-service tokens fail safely.',
    '',
    'Options:',
    '  --sim-env <path>          SIM env file, defaults to apps/sim/.env.',
    '  --hermes-repo <path>      Hermes fork checkout, defaults to ../hermes-agent-sim.',
    '  --hermes-env <path>       Hermes env file, defaults to <hermes-repo>/.env.',
    '  --hermes-home <path>      HERMES_HOME, defaults to ../.hermes-sim-local.',
    '  --hermes-api-url <url>    SIM -> Hermes URL, defaults to http://127.0.0.1:8642.',
    '  --sim-url <url>           Hermes -> SIM URL, defaults to SIM env app URL or http://127.0.0.1:3000.',
    '  --dry-run                 Print planned changes without writing files.',
    '  --help                    Show this help message.',
  ].join('\n')
}

function readNext(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function resolvePath(value: string, cwd: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd, value)
}

function defaultHermesRepoPath(cwd: string): string {
  return path.resolve(path.dirname(cwd), 'hermes-agent-sim')
}

function defaultHermesHome(cwd: string): string {
  return path.resolve(path.dirname(cwd), '.hermes-sim-local')
}

export function parseArgs(argv: string[], cwd = process.cwd()): SetupOptions {
  let hermesRepoPath = defaultHermesRepoPath(cwd)
  const options: SetupOptions = {
    dryRun: false,
    help: false,
    hermesApiUrl: DEFAULT_HERMES_API_URL,
    hermesEnvFile: path.join(hermesRepoPath, '.env'),
    hermesHome: defaultHermesHome(cwd),
    hermesRepoPath,
    simEnvFile: resolvePath(DEFAULT_SIM_ENV_FILE, cwd),
  }
  let hermesEnvFromArg = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--sim-env':
        options.simEnvFile = resolvePath(readNext(argv, index, arg), cwd)
        index += 1
        break
      case '--hermes-repo':
        hermesRepoPath = resolvePath(readNext(argv, index, arg), cwd)
        options.hermesRepoPath = hermesRepoPath
        if (!hermesEnvFromArg) options.hermesEnvFile = path.join(hermesRepoPath, '.env')
        index += 1
        break
      case '--hermes-env':
        options.hermesEnvFile = resolvePath(readNext(argv, index, arg), cwd)
        hermesEnvFromArg = true
        index += 1
        break
      case '--hermes-home':
        options.hermesHome = resolvePath(readNext(argv, index, arg), cwd)
        index += 1
        break
      case '--hermes-api-url':
        options.hermesApiUrl = readNext(argv, index, arg)
        index += 1
        break
      case '--sim-url':
        options.simInternalApiUrl = readNext(argv, index, arg)
        index += 1
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

function generateToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('hex')}`
}

function assertUrl(value: string, label: string): void {
  try {
    new URL(value)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }
}

function envValue(env: Record<string, string>, key: string): string | undefined {
  const value = env[key]?.trim()
  return value || undefined
}

function normalizeProvider(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized || undefined
}

function normalizeLocalModel(provider: string, model: string | undefined): string | undefined {
  const normalized = model?.trim()
  if (!normalized) return undefined

  const prefixByProvider: Record<string, string[]> = {
    alibaba: ['alibaba/', 'qwen/'],
    deepseek: ['deepseek/'],
    gemini: ['gemini/', 'google/'],
    zai: ['zai/', 'z-ai/', 'glm/'],
  }
  for (const prefix of prefixByProvider[provider] ?? []) {
    if (normalized.toLowerCase().startsWith(prefix)) return normalized.slice(prefix.length)
  }
  return normalized.includes('/') ? undefined : normalized
}

function mappingMatchesProvider(
  mapping: LlmProviderMapping,
  provider: string | undefined
): boolean {
  return Boolean(provider && mapping.providerAliases.includes(provider))
}

function hasHermesLlmProvider(hermesEnv: Record<string, string>): boolean {
  return (
    HERMES_LLM_ENV_KEYS.some((key) => Boolean(envValue(hermesEnv, key))) ||
    LLM_PROVIDER_MAPPINGS.some((mapping) => Boolean(envValue(hermesEnv, mapping.hermesEnvKey)))
  )
}

function selectHermesModelPreference(
  simEnv: Record<string, string>,
  hermesEnv: Record<string, string>
): HermesModelPreference | undefined {
  const localProvider = normalizeProvider(envValue(simEnv, 'LOCAL_COPILOT_PROVIDER'))
  const localModel = envValue(simEnv, 'LOCAL_COPILOT_MODEL')
  const existingHermesMapping = LLM_PROVIDER_MAPPINGS.find((mapping) =>
    Boolean(envValue(hermesEnv, mapping.hermesEnvKey))
  )
  if (existingHermesMapping) {
    return {
      model:
        mappingMatchesProvider(existingHermesMapping, localProvider) &&
        normalizeLocalModel(existingHermesMapping.provider, localModel)
          ? (normalizeLocalModel(existingHermesMapping.provider, localModel) ??
            existingHermesMapping.defaultModel)
          : existingHermesMapping.defaultModel,
      provider: existingHermesMapping.provider,
    }
  }

  const orderedMappings = [...LLM_PROVIDER_MAPPINGS].sort((left, right) => {
    const leftMatches = mappingMatchesProvider(left, localProvider) ? 0 : 1
    const rightMatches = mappingMatchesProvider(right, localProvider) ? 0 : 1
    return leftMatches - rightMatches
  })

  for (const mapping of orderedMappings) {
    const simKey = mapping.simEnvKeys.find((key) => Boolean(envValue(simEnv, key)))
    const simValue = simKey ? envValue(simEnv, simKey) : undefined
    if (!simValue) continue
    const model = mappingMatchesProvider(mapping, localProvider)
      ? (normalizeLocalModel(mapping.provider, localModel) ?? mapping.defaultModel)
      : mapping.defaultModel
    return {
      envKey: mapping.hermesEnvKey,
      envValue: simValue,
      model,
      provider: mapping.provider,
    }
  }

  return undefined
}

function pickSharedSecret(params: {
  leftEnv: Record<string, string>
  leftKey: string
  rightEnv: Record<string, string>
  rightKey: string
  prefix: string
}): string {
  const left = envValue(params.leftEnv, params.leftKey)
  const right = envValue(params.rightEnv, params.rightKey)
  if (left && right && left !== right) {
    throw new Error(`${params.leftKey} and ${params.rightKey} are both set but do not match`)
  }
  const value = left ?? right ?? generateToken(params.prefix)
  if (value.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `${params.leftKey}/${params.rightKey} must be at least ${MIN_TOKEN_LENGTH} chars`
    )
  }
  return value
}

function simAppUrl(simEnv: Record<string, string>): string | undefined {
  return (
    envValue(simEnv, 'SIM_BASE_URL') ??
    envValue(simEnv, 'NEXT_PUBLIC_APP_URL') ??
    envValue(simEnv, 'BETTER_AUTH_URL')
  )
}

function appendMissingEnvValues(
  originalContent: string | null,
  existing: Record<string, string>,
  values: Record<string, string>
): EnvFileUpdate {
  const additions = Object.entries(values).filter(([key]) => !envValue(existing, key))
  if (additions.length === 0) {
    return { content: originalContent ?? '', changedKeys: [] }
  }

  const base = originalContent ?? ''
  const lines: string[] = []
  if (base.trim().length > 0) lines.push('')
  lines.push('# SIM Hermes local integration')
  for (const [key, value] of additions) {
    lines.push(`${key}=${value}`)
  }

  const separator = base.endsWith('\n') || base.length === 0 ? '' : '\n'
  return {
    content: `${base}${separator}${lines.join('\n')}\n`,
    changedKeys: additions.map(([key]) => key),
  }
}

function buildHermesModelConfig(preference: HermesModelPreference): string {
  return [
    'model:',
    `  provider: ${preference.provider}`,
    `  default: ${preference.model}`,
    "  base_url: ''",
    '  api_mode: chat_completions',
  ].join('\n')
}

function appendMissingHermesModelConfig(
  originalContent: string,
  preference: HermesModelPreference | undefined
): EnvFileUpdate {
  if (!preference || /^\s*model\s*:/m.test(originalContent)) {
    return { content: originalContent, changedKeys: [] }
  }

  const separator = originalContent.endsWith('\n') || originalContent.length === 0 ? '' : '\n'
  return {
    content: `${originalContent}${separator}\n${buildHermesModelConfig(preference)}\n`,
    changedKeys: ['model.provider', 'model.default'],
  }
}

function buildHermesConfig(preference?: HermesModelPreference): string {
  return [
    ...(preference ? [buildHermesModelConfig(preference), ''] : []),
    'plugins:',
    '  enabled:',
    '    - sim',
    '',
    'memory:',
    '  provider: sim',
    '  memory_enabled: true',
    '  user_profile_enabled: true',
    '',
    'platform_toolsets:',
    '  api_server:',
    '    - sim',
    '    - memory',
    '    - skills',
    '    - session_search',
    '',
  ].join('\n')
}

async function defaultReadText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function defaultWriteText(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

async function defaultMkdirp(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true })
}

function printPlannedFile(
  io: SetupIo,
  filePath: string,
  changedKeys: string[],
  dryRun: boolean
): void {
  if (changedKeys.length === 0) {
    io.stdout(`- KEEP ${filePath}: no missing keys\n`)
    return
  }
  io.stdout(`- ${dryRun ? 'PLAN' : 'WRITE'} ${filePath}: add ${changedKeys.join(', ')}\n`)
}

function printPlannedConfig(
  io: SetupIo,
  filePath: string,
  action: 'create' | 'update' | 'keep',
  changedKeys: string[],
  dryRun: boolean
): void {
  if (action === 'keep') {
    io.stdout(`- KEEP ${filePath}: already exists\n`)
    return
  }
  const label = dryRun ? 'PLAN' : 'WRITE'
  const detail = action === 'create' ? 'create safe SIM config' : `add ${changedKeys.join(', ')}`
  io.stdout(`- ${label} ${filePath}: ${detail}\n`)
}

export async function runHermesLocalEnvSetup(
  argv: string[],
  cwd = process.cwd(),
  io: SetupIo = {
    readText: defaultReadText,
    writeText: defaultWriteText,
    mkdirp: defaultMkdirp,
    stderr: (message) => process.stderr.write(message),
    stdout: (message) => process.stdout.write(message),
  }
): Promise<number> {
  let options: SetupOptions
  try {
    options = parseArgs(argv, cwd)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`)
    return 2
  }

  if (options.help) {
    io.stdout(`${usage()}\n`)
    return 0
  }

  try {
    assertUrl(options.hermesApiUrl, 'HERMES_API_URL')

    const simContent = await io.readText(options.simEnvFile)
    const hermesContent = await io.readText(options.hermesEnvFile)
    const simEnv = parseDotEnv(simContent ?? '')
    const hermesEnv = parseDotEnv(hermesContent ?? '')
    const simUrl = options.simInternalApiUrl ?? simAppUrl(simEnv) ?? DEFAULT_SIM_INTERNAL_API_URL
    assertUrl(simUrl, 'SIM_INTERNAL_API_URL')

    const apiKey = pickSharedSecret({
      leftEnv: simEnv,
      leftKey: 'HERMES_API_KEY',
      rightEnv: hermesEnv,
      rightKey: 'API_SERVER_KEY',
      prefix: 'hermes_api',
    })
    const serviceToken = pickSharedSecret({
      leftEnv: simEnv,
      leftKey: 'HERMES_SERVICE_TOKEN',
      rightEnv: hermesEnv,
      rightKey: 'SIM_SERVICE_TOKEN',
      prefix: 'sim_service',
    })
    const modelPreference = selectHermesModelPreference(simEnv, hermesEnv)
    const shouldCopyLlmKey =
      Boolean(modelPreference?.envKey && modelPreference.envValue) &&
      !hasHermesLlmProvider(hermesEnv)

    const simUpdate = appendMissingEnvValues(simContent, simEnv, {
      HERMES_API_URL: options.hermesApiUrl,
      HERMES_API_KEY: apiKey,
      HERMES_SERVICE_TOKEN: serviceToken,
    })
    const hermesUpdate = appendMissingEnvValues(hermesContent, hermesEnv, {
      API_SERVER_ENABLED: 'true',
      API_SERVER_HOST: '127.0.0.1',
      API_SERVER_PORT: '8642',
      API_SERVER_KEY: apiKey,
      SIM_INTERNAL_API_URL: simUrl,
      SIM_SERVICE_TOKEN: serviceToken,
      HERMES_HOME: options.hermesHome,
      ...(shouldCopyLlmKey && modelPreference?.envKey && modelPreference.envValue
        ? { [modelPreference.envKey]: modelPreference.envValue }
        : {}),
    })

    const configFile = path.join(options.hermesHome, 'config.yaml')
    const configContent = await io.readText(configFile)
    const shouldCreateConfig = configContent === null
    const configUpdate = shouldCreateConfig
      ? {
          content: buildHermesConfig(modelPreference),
          changedKeys: modelPreference ? ['model.provider', 'model.default'] : [],
        }
      : appendMissingHermesModelConfig(configContent, modelPreference)
    const shouldUpdateConfig = !shouldCreateConfig && configUpdate.changedKeys.length > 0

    io.stdout(`SIM Hermes local env setup: ${options.dryRun ? 'DRY RUN' : 'WRITE'}\n`)
    printPlannedFile(io, options.simEnvFile, simUpdate.changedKeys, options.dryRun)
    printPlannedFile(io, options.hermesEnvFile, hermesUpdate.changedKeys, options.dryRun)
    printPlannedConfig(
      io,
      configFile,
      shouldCreateConfig ? 'create' : shouldUpdateConfig ? 'update' : 'keep',
      configUpdate.changedKeys,
      options.dryRun
    )
    io.stdout('- NOTE generated secrets are written only to env files and are not printed\n')

    if (!options.dryRun) {
      await io.writeText(options.simEnvFile, simUpdate.content)
      await io.writeText(options.hermesEnvFile, hermesUpdate.content)
      await io.mkdirp(options.hermesHome)
      if (shouldCreateConfig || shouldUpdateConfig)
        await io.writeText(configFile, configUpdate.content)
    }

    return 0
  } catch (error) {
    io.stderr(
      `SIM Hermes local env setup failed: ${error instanceof Error ? error.message : String(error)}\n`
    )
    return 1
  }
}

if (import.meta.main) {
  const exitCode = await runHermesLocalEnvSetup(process.argv.slice(2))
  process.exit(exitCode)
}
