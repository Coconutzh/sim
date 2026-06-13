#!/usr/bin/env bun

import { access, readFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'

type CheckStatus = 'pass' | 'fail' | 'skip'

export interface PreflightCheck {
  name: string
  status: CheckStatus
  detail?: string
}

interface PreflightOptions {
  hermesConfigFile?: string
  help: boolean
  hermesEnvFile: string
  hermesRepoPath: string
  json: boolean
  requireLlm: boolean
  requireServices: boolean
  simEnvFile: string
  timeoutMs: number
}

interface PreflightSummary {
  checks: PreflightCheck[]
  hermesConfigFile?: string
  hermesEnvFile: string
  hermesRepoPath: string
  ok: boolean
  requireLlm: boolean
  requireServices: boolean
  simEnvFile: string
}

interface PreflightIo {
  canConnect: (host: string, port: number, timeoutMs: number) => Promise<boolean>
  exists: (filePath: string) => Promise<boolean>
  readText: (filePath: string) => Promise<string | null>
  stderr: (message: string) => void
  stdout: (message: string) => void
}

const DEFAULT_TIMEOUT_MS = 2000
const DEFAULT_SIM_ENV_FILE = path.join('apps', 'sim', '.env')
const REQUIRED_SIM_ENV = [
  'DATABASE_URL',
  'INTERNAL_API_SECRET',
  'HERMES_API_URL',
  'HERMES_API_KEY',
  'HERMES_SERVICE_TOKEN',
] as const
const REQUIRED_HERMES_ENV = [
  'API_SERVER_ENABLED',
  'API_SERVER_KEY',
  'SIM_INTERNAL_API_URL',
  'SIM_SERVICE_TOKEN',
  'HERMES_HOME',
] as const
const LLM_PROVIDER_ENV = [
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
  'XAI_API_KEY',
  'OLLAMA_API_KEY',
  'NOVITA_API_KEY',
  'ARCEEAI_API_KEY',
  'MINIMAX_API_KEY',
  'MINIMAX_CN_API_KEY',
] as const
const DEFAULT_FORBIDDEN_TOOLSETS = [
  'browser',
  'code_execution',
  'computer_use',
  'cronjob',
  'delegation',
  'file',
  'terminal',
] as const

function usage(): string {
  return [
    'Usage: bun run scripts/check-hermes-local-preflight.ts [options]',
    '',
    'Options:',
    '  --sim-env <path>        SIM env file, defaults to apps/sim/.env.',
    '  --hermes-repo <path>    Hermes fork checkout, defaults to ../hermes-agent-sim.',
    '  --hermes-env <path>     Hermes env file, defaults to <hermes-repo>/.env.',
    '  --hermes-config <path>  Hermes config.yaml; defaults to HERMES_HOME/config.yaml.',
    '  --require-llm           Fail when no known Hermes LLM provider API key is configured.',
    '  --require-services      Fail when SIM or Hermes local listeners are not reachable.',
    '  --timeout-ms <ms>       Listener timeout, defaults to 2000.',
    '  --json                  Print structured preflight output.',
    '  --help                  Show this help message.',
    '',
    'Environment fallbacks:',
    '  SIM_ENV_FILE, HERMES_REPO_PATH, HERMES_ENV_FILE, HERMES_CONFIG_FILE, HERMES_PREFLIGHT_TIMEOUT_MS',
  ].join('\n')
}

function readNext(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function resolvePath(value: string, cwd: string): string {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd, value)
}

function defaultHermesRepoPath(env: Record<string, string | undefined>, cwd: string): string {
  const configured = env.HERMES_REPO_PATH?.trim()
  if (configured) return resolvePath(configured, cwd)
  return path.resolve(path.dirname(cwd), 'hermes-agent-sim')
}

export function parseArgs(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd()
): PreflightOptions {
  let hermesRepoPath = defaultHermesRepoPath(env, cwd)
  let simEnvFile = resolvePath(env.SIM_ENV_FILE?.trim() || DEFAULT_SIM_ENV_FILE, cwd)
  let hermesEnvFile = env.HERMES_ENV_FILE?.trim()
    ? resolvePath(env.HERMES_ENV_FILE.trim(), cwd)
    : path.join(hermesRepoPath, '.env')
  let hermesEnvFileFromArg = false

  const options: PreflightOptions = {
    hermesConfigFile: env.HERMES_CONFIG_FILE?.trim()
      ? resolvePath(env.HERMES_CONFIG_FILE.trim(), cwd)
      : undefined,
    help: false,
    hermesEnvFile,
    hermesRepoPath,
    json: false,
    requireLlm: false,
    requireServices: false,
    simEnvFile,
    timeoutMs: parsePositiveInt(env.HERMES_PREFLIGHT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true
        break
      case '--hermes-env':
        hermesEnvFile = resolvePath(readNext(argv, index, arg), cwd)
        options.hermesEnvFile = hermesEnvFile
        hermesEnvFileFromArg = true
        index += 1
        break
      case '--hermes-config':
        options.hermesConfigFile = resolvePath(readNext(argv, index, arg), cwd)
        index += 1
        break
      case '--hermes-repo':
        hermesRepoPath = resolvePath(readNext(argv, index, arg), cwd)
        options.hermesRepoPath = hermesRepoPath
        if (!env.HERMES_ENV_FILE?.trim() && !hermesEnvFileFromArg) {
          options.hermesEnvFile = path.join(hermesRepoPath, '.env')
        }
        index += 1
        break
      case '--json':
        options.json = true
        break
      case '--require-llm':
        options.requireLlm = true
        break
      case '--require-services':
        options.requireServices = true
        break
      case '--sim-env':
        simEnvFile = resolvePath(readNext(argv, index, arg), cwd)
        options.simEnvFile = simEnvFile
        index += 1
        break
      case '--timeout-ms':
        options.timeoutMs = parsePositiveInt(readNext(argv, index, arg), DEFAULT_TIMEOUT_MS)
        index += 1
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

export function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const separatorIndex = normalized.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = normalized.slice(0, separatorIndex).trim()
    let value = normalized.slice(separatorIndex + 1).trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1)
    }
    if (/^[A-Z0-9_]+$/.test(key)) values[key] = value
  }
  return values
}

function mergeEnv(
  fileEnv: Record<string, string>,
  processEnv: Record<string, string | undefined>
): Record<string, string | undefined> {
  return { ...fileEnv, ...processEnv }
}

function valueFor(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim()
  return value || undefined
}

function envListValue(
  env: Record<string, string | undefined>,
  key: string,
  fallback: string[]
): string[] {
  const raw = valueFor(env, key)
  if (!raw) return fallback
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function missingKeys(env: Record<string, string | undefined>, keys: readonly string[]): string[] {
  return keys.filter((key) => !valueFor(env, key))
}

function addRequiredEnvCheck(
  checks: PreflightCheck[],
  name: string,
  env: Record<string, string | undefined>,
  keys: readonly string[]
): void {
  const missing = missingKeys(env, keys)
  checks.push({
    name,
    status: missing.length === 0 ? 'pass' : 'fail',
    detail:
      missing.length === 0 ? 'all required variables are present' : `missing ${missing.join(', ')}`,
  })
}

function addTokenLengthCheck(
  checks: PreflightCheck[],
  name: string,
  env: Record<string, string | undefined>,
  key: string
): void {
  const value = valueFor(env, key)
  if (!value) {
    checks.push({ name, status: 'skip', detail: `${key} is missing` })
    return
  }
  checks.push({
    name,
    status: value.length >= 32 ? 'pass' : 'fail',
    detail: value.length >= 32 ? `${key} length is acceptable` : `${key} must be at least 32 chars`,
  })
}

function isTruthyEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '')
}

function addTruthyEnvCheck(
  checks: PreflightCheck[],
  name: string,
  env: Record<string, string | undefined>,
  key: string
): void {
  const value = valueFor(env, key)
  if (!value) {
    checks.push({ name, status: 'skip', detail: `${key} is missing` })
    return
  }
  checks.push({
    name,
    status: isTruthyEnv(value) ? 'pass' : 'fail',
    detail: isTruthyEnv(value) ? `${key} is enabled` : `${key} must be true, yes, on, or 1`,
  })
}

function addLlmProviderCheck(
  checks: PreflightCheck[],
  env: Record<string, string | undefined>,
  requireLlm: boolean
): void {
  const present = LLM_PROVIDER_ENV.filter((key) => Boolean(valueFor(env, key)))
  checks.push({
    name: 'hermes.llm-provider-env',
    status: present.length > 0 ? 'pass' : requireLlm ? 'fail' : 'skip',
    detail:
      present.length > 0
        ? `found ${present.join(', ')}`
        : requireLlm
          ? `missing one of ${LLM_PROVIDER_ENV.join(', ')}`
          : 'no common provider key found; use --require-llm for full chat/tool E2E readiness',
  })
}

interface ConfigLine {
  indent: number
  text: string
}

function stripYamlComment(line: string): string {
  const index = line.indexOf('#')
  return (index >= 0 ? line.slice(0, index) : line).trimEnd()
}

function yamlLines(source: string): ConfigLine[] {
  return source
    .split(/\r?\n/)
    .map(stripYamlComment)
    .map((line) => ({
      indent: line.match(/^\s*/)?.[0].length ?? 0,
      text: line.trim(),
    }))
    .filter((line) => line.text.length > 0)
}

function findYamlKeyBlock(lines: ConfigLine[], key: string): ConfigLine[] | null {
  const headerIndex = lines.findIndex(
    (line) => line.text === `${key}:` || line.text.startsWith(`${key}: `)
  )
  if (headerIndex < 0) return null
  const headerIndent = lines[headerIndex].indent
  const block: ConfigLine[] = []
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.indent <= headerIndent) break
    block.push({ ...line, indent: line.indent - headerIndent - 1 })
  }
  return block
}

function yamlInlineValue(lines: ConfigLine[], key: string): string | undefined {
  const line = lines.find((item) => item.text.startsWith(`${key}:`))
  if (!line) return undefined
  const value = line.text.slice(key.length + 1).trim()
  return value || undefined
}

function yamlListFromValue(value: string | undefined): string[] {
  if (!value) return []
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
  }
  return []
}

function yamlListAtPath(source: string, pathParts: string[]): string[] | null {
  let block = yamlLines(source)
  for (let index = 0; index < pathParts.length; index += 1) {
    const key = pathParts[index]
    const inlineList = yamlListFromValue(yamlInlineValue(block, key))
    if (inlineList.length > 0 && index === pathParts.length - 1) return inlineList

    const nextBlock = findYamlKeyBlock(block, key)
    if (!nextBlock) return null
    block = nextBlock
  }

  const items = block
    .map((line) =>
      line.text
        .match(/^-\s+(.+)$/)?.[1]
        ?.trim()
        .replace(/^['"]|['"]$/g, '')
    )
    .filter((item): item is string => Boolean(item))
  return items
}

function yamlScalarAtPath(source: string, pathParts: string[]): string | null {
  let block = yamlLines(source)
  for (let index = 0; index < pathParts.length; index += 1) {
    const key = pathParts[index]
    const value = yamlInlineValue(block, key)
    if (index === pathParts.length - 1) return value?.replace(/^['"]|['"]$/g, '') ?? null

    const nextBlock = findYamlKeyBlock(block, key)
    if (!nextBlock) return null
    block = nextBlock
  }
  return null
}

function addConfigListIncludesCheck(
  checks: PreflightCheck[],
  name: string,
  items: string[] | null,
  required: string[],
  pathLabel: string
): void {
  if (!items) {
    checks.push({ name, status: 'fail', detail: `${pathLabel} is missing from Hermes config` })
    return
  }
  const missing = required.filter((item) => !items.includes(item))
  checks.push({
    name,
    status: missing.length === 0 ? 'pass' : 'fail',
    detail:
      missing.length === 0
        ? `${pathLabel} includes ${required.join(', ')}`
        : `${pathLabel} missing ${missing.join(', ')}`,
  })
}

function addConfigForbiddenToolsetsCheck(
  checks: PreflightCheck[],
  items: string[] | null,
  forbidden: string[]
): void {
  if (!items) {
    checks.push({
      name: 'hermes.config-forbidden-toolsets',
      status: 'skip',
      detail: 'platform_toolsets.api_server is missing',
    })
    return
  }
  const present = forbidden.filter((item) => items.includes(item))
  checks.push({
    name: 'hermes.config-forbidden-toolsets',
    status: present.length === 0 ? 'pass' : 'fail',
    detail:
      present.length === 0
        ? 'no forbidden SIM production toolsets in platform_toolsets.api_server'
        : `forbidden toolsets enabled: ${present.join(', ')}`,
  })
}

function addMemoryProviderCheck(checks: PreflightCheck[], source: string): void {
  const provider = yamlScalarAtPath(source, ['memory', 'provider'])
  checks.push({
    name: 'hermes.config-memory-provider',
    status: provider === 'sim' ? 'pass' : 'fail',
    detail: provider === 'sim' ? 'memory.provider is sim' : 'memory.provider must be sim',
  })
}

function addMatchCheck(
  checks: PreflightCheck[],
  name: string,
  left: string | undefined,
  right: string | undefined,
  detail: string
): void {
  if (!left || !right) {
    checks.push({ name, status: 'skip', detail: `${detail}: missing value` })
    return
  }
  checks.push({
    name,
    status: left === right ? 'pass' : 'fail',
    detail: left === right ? `${detail}: matched` : `${detail}: mismatch`,
  })
}

function addUrlCheck(
  checks: PreflightCheck[],
  name: string,
  value: string | undefined,
  label: string
): URL | null {
  if (!value) {
    checks.push({ name, status: 'skip', detail: `${label} is missing` })
    return null
  }
  try {
    const url = new URL(value)
    checks.push({ name, status: 'pass', detail: `${label} is a valid URL` })
    return url
  } catch {
    checks.push({ name, status: 'fail', detail: `${label} must be a valid URL` })
    return null
  }
}

function listenerTarget(url: URL): { host: string; port: number } {
  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80
  return { host: url.hostname, port }
}

async function addListenerCheck(
  checks: PreflightCheck[],
  params: {
    io: PreflightIo
    name: string
    requireServices: boolean
    timeoutMs: number
    url: URL | null
  }
): Promise<void> {
  if (!params.url) {
    checks.push({ name: params.name, status: 'skip', detail: 'URL is missing or invalid' })
    return
  }
  if (!params.requireServices) {
    checks.push({
      name: params.name,
      status: 'skip',
      detail: 'use --require-services to require a live listener',
    })
    return
  }

  const target = listenerTarget(params.url)
  const reachable = await params.io.canConnect(target.host, target.port, params.timeoutMs)
  checks.push({
    name: params.name,
    status: reachable ? 'pass' : 'fail',
    detail: reachable
      ? `${target.host}:${target.port} is reachable`
      : `${target.host}:${target.port} is not reachable`,
  })
}

async function loadEnvFile(
  io: PreflightIo,
  checks: PreflightCheck[],
  name: string,
  filePath: string
): Promise<Record<string, string>> {
  const content = await io.readText(filePath)
  if (content === null) {
    checks.push({ name, status: 'skip', detail: `${filePath} not found` })
    return {}
  }
  checks.push({ name, status: 'pass', detail: `${filePath} loaded` })
  return parseDotEnv(content)
}

function resolveHermesConfigFile(
  options: PreflightOptions,
  hermesEnv: Record<string, string | undefined>
): string | null {
  if (options.hermesConfigFile) return options.hermesConfigFile
  const hermesHome = valueFor(hermesEnv, 'HERMES_HOME')
  return hermesHome ? path.join(hermesHome, 'config.yaml') : null
}

async function addHermesConfigChecks(params: {
  checks: PreflightCheck[]
  configFile: string | null
  forbiddenToolsets: string[]
  io: PreflightIo
  requiredToolsets: string[]
}): Promise<void> {
  if (!params.configFile) {
    params.checks.push({
      name: 'hermes.config-file',
      status: 'skip',
      detail: 'HERMES_HOME or --hermes-config is required to locate config.yaml',
    })
    return
  }

  const source = await params.io.readText(params.configFile)
  if (source === null) {
    params.checks.push({
      name: 'hermes.config-file',
      status: 'fail',
      detail: `${params.configFile} not found`,
    })
    return
  }

  params.checks.push({
    name: 'hermes.config-file',
    status: 'pass',
    detail: `${params.configFile} loaded`,
  })
  addConfigListIncludesCheck(
    params.checks,
    'hermes.config-plugin-sim',
    yamlListAtPath(source, ['plugins', 'enabled']),
    ['sim'],
    'plugins.enabled'
  )
  addMemoryProviderCheck(params.checks, source)

  const apiServerToolsets = yamlListAtPath(source, ['platform_toolsets', 'api_server'])
  addConfigListIncludesCheck(
    params.checks,
    'hermes.config-required-toolsets',
    apiServerToolsets,
    params.requiredToolsets,
    'platform_toolsets.api_server'
  )
  addConfigForbiddenToolsetsCheck(params.checks, apiServerToolsets, params.forbiddenToolsets)
}

function printHuman(summary: PreflightSummary, io: PreflightIo): void {
  io.stdout(`SIM Hermes local preflight: ${summary.ok ? 'PASS' : 'FAIL'}\n`)
  for (const check of summary.checks) {
    const marker = check.status === 'pass' ? 'PASS' : check.status === 'fail' ? 'FAIL' : 'SKIP'
    io.stdout(`- ${marker} ${check.name}${check.detail ? `: ${check.detail}` : ''}\n`)
  }
}

async function defaultExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function defaultReadText(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

async function defaultCanConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (reachable: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(reachable)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function runHermesLocalPreflight(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
  io: PreflightIo = {
    canConnect: defaultCanConnect,
    exists: defaultExists,
    readText: defaultReadText,
    stderr: (message) => process.stderr.write(message),
    stdout: (message) => process.stdout.write(message),
  }
): Promise<number> {
  let options: PreflightOptions
  try {
    options = parseArgs(argv, env, cwd)
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`)
    return 2
  }

  if (options.help) {
    io.stdout(`${usage()}\n`)
    return 0
  }

  const checks: PreflightCheck[] = []
  const simFileEnv = await loadEnvFile(io, checks, 'sim.env-file', options.simEnvFile)
  const hermesFileEnv = await loadEnvFile(io, checks, 'hermes.env-file', options.hermesEnvFile)
  const simEnv = mergeEnv(simFileEnv, env)
  const hermesEnv = mergeEnv(hermesFileEnv, env)
  const hermesConfigFile = resolveHermesConfigFile(options, hermesEnv)

  const simAppUrl =
    valueFor(simEnv, 'SIM_BASE_URL') ??
    valueFor(simEnv, 'NEXT_PUBLIC_APP_URL') ??
    valueFor(simEnv, 'BETTER_AUTH_URL')
  const hermesApiUrl = valueFor(simEnv, 'HERMES_API_URL')
  const simInternalApiUrl = valueFor(hermesEnv, 'SIM_INTERNAL_API_URL')

  const hermesPluginPath = path.join(options.hermesRepoPath, 'plugins', 'sim', 'tools.py')
  const hasHermesPlugin = await io.exists(hermesPluginPath)
  checks.push({
    name: 'hermes.repo-plugin',
    status: hasHermesPlugin ? 'pass' : 'fail',
    detail: hasHermesPlugin
      ? `${hermesPluginPath} found`
      : `${options.hermesRepoPath} must contain plugins/sim/tools.py`,
  })
  addRequiredEnvCheck(checks, 'sim.required-env', simEnv, REQUIRED_SIM_ENV)
  checks.push({
    name: 'sim.app-url',
    status: simAppUrl ? 'pass' : 'fail',
    detail: simAppUrl
      ? 'SIM_BASE_URL, NEXT_PUBLIC_APP_URL, or BETTER_AUTH_URL is present'
      : 'set SIM_BASE_URL, NEXT_PUBLIC_APP_URL, or BETTER_AUTH_URL',
  })
  addTokenLengthCheck(checks, 'sim.service-token-strength', simEnv, 'HERMES_SERVICE_TOKEN')
  addRequiredEnvCheck(checks, 'hermes.required-env', hermesEnv, REQUIRED_HERMES_ENV)
  addTruthyEnvCheck(checks, 'hermes.api-server-enabled', hermesEnv, 'API_SERVER_ENABLED')
  addTokenLengthCheck(checks, 'hermes.service-token-strength', hermesEnv, 'SIM_SERVICE_TOKEN')
  addLlmProviderCheck(checks, hermesEnv, options.requireLlm)
  await addHermesConfigChecks({
    checks,
    configFile: hermesConfigFile,
    forbiddenToolsets: envListValue(simEnv, 'HERMES_FORBIDDEN_TOOLSETS', [
      ...DEFAULT_FORBIDDEN_TOOLSETS,
    ]),
    io,
    requiredToolsets: envListValue(simEnv, 'HERMES_REQUIRED_TOOLSETS', ['sim']),
  })
  addMatchCheck(
    checks,
    'auth.api-key-match',
    valueFor(simEnv, 'HERMES_API_KEY'),
    valueFor(hermesEnv, 'API_SERVER_KEY'),
    'SIM HERMES_API_KEY and Hermes API_SERVER_KEY'
  )
  addMatchCheck(
    checks,
    'auth.service-token-match',
    valueFor(simEnv, 'HERMES_SERVICE_TOKEN'),
    valueFor(hermesEnv, 'SIM_SERVICE_TOKEN'),
    'SIM HERMES_SERVICE_TOKEN and Hermes SIM_SERVICE_TOKEN'
  )

  const simUrl = addUrlCheck(checks, 'sim.url-format', simAppUrl, 'SIM app URL')
  const hermesUrl = addUrlCheck(checks, 'hermes.url-format', hermesApiUrl, 'HERMES_API_URL')
  addUrlCheck(checks, 'hermes.sim-internal-url-format', simInternalApiUrl, 'SIM_INTERNAL_API_URL')
  await addListenerCheck(checks, {
    io,
    name: 'sim.listener',
    requireServices: options.requireServices,
    timeoutMs: options.timeoutMs,
    url: simUrl,
  })
  await addListenerCheck(checks, {
    io,
    name: 'hermes.listener',
    requireServices: options.requireServices,
    timeoutMs: options.timeoutMs,
    url: hermesUrl,
  })

  const summary: PreflightSummary = {
    checks,
    hermesConfigFile: hermesConfigFile ?? undefined,
    hermesEnvFile: options.hermesEnvFile,
    hermesRepoPath: options.hermesRepoPath,
    ok: checks.every((check) => check.status !== 'fail'),
    requireLlm: options.requireLlm,
    requireServices: options.requireServices,
    simEnvFile: options.simEnvFile,
  }

  if (options.json) {
    io.stdout(`${JSON.stringify(summary, null, 2)}\n`)
  } else {
    printHuman(summary, io)
  }

  return summary.ok ? 0 : 1
}

if (import.meta.main) {
  const exitCode = await runHermesLocalPreflight(process.argv.slice(2))
  process.exit(exitCode)
}
