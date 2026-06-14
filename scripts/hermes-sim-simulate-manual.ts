#!/usr/bin/env bun

import { type CheckResult, loadDefaultLocalEnvFiles, runSmoke } from './hermes-sim-smoke'

type SimulatedManualCaseName =
  | 'chat-memory'
  | 'canvas-summary'
  | 'canvas-proposal'
  | 'canvas-propose-confirm-apply'
  | 'canvas-history'
  | 'isolation'

interface SimulatedManualOptions {
  cases: SimulatedManualCaseName[]
  json: boolean
}

interface SimulatedManualCaseResult {
  caseName: SimulatedManualCaseName
  smokeFlags: string[]
  requestIds: Record<string, string>
  conversationKey?: string
  toolCalls: string[]
  dbChecks: Record<string, unknown>
  stateDiff: Record<string, unknown>
  pass: boolean
  failureReason?: string
  checks: CheckResult[]
}

const ALL_CASES: SimulatedManualCaseName[] = [
  'chat-memory',
  'canvas-summary',
  'canvas-proposal',
  'canvas-propose-confirm-apply',
  'canvas-history',
  'isolation',
]

const CASE_FLAGS: Record<SimulatedManualCaseName, string[]> = {
  'chat-memory': ['--chat', '--conversation-chain'],
  'canvas-summary': ['--canvas-read'],
  'canvas-proposal': ['--canvas-propose'],
  'canvas-propose-confirm-apply': ['--canvas-propose-apply'],
  'canvas-history': ['--canvas-history'],
  isolation: ['--conversation-chain'],
}

const CASE_REQUIRED_ENV: Record<SimulatedManualCaseName, string[]> = {
  'chat-memory': ['HERMES_API_URL', 'HERMES_API_KEY', 'HERMES_SMOKE_USER_ID'],
  'canvas-summary': [
    'HERMES_API_URL',
    'HERMES_API_KEY',
    'HERMES_SERVICE_TOKEN',
    'HERMES_SMOKE_USER_ID',
    'HERMES_SMOKE_WORKSPACE_ID',
    'HERMES_SMOKE_WORKFLOW_ID',
  ],
  'canvas-proposal': [
    'HERMES_API_URL',
    'HERMES_API_KEY',
    'HERMES_SMOKE_USER_ID',
    'HERMES_SMOKE_WORKSPACE_ID',
    'HERMES_SMOKE_WORKFLOW_ID',
  ],
  'canvas-propose-confirm-apply': [
    'HERMES_API_URL',
    'HERMES_API_KEY',
    'HERMES_SERVICE_TOKEN',
    'HERMES_SMOKE_USER_ID',
    'HERMES_SMOKE_WORKSPACE_ID',
    'HERMES_SMOKE_WORKFLOW_ID',
    'HERMES_SMOKE_WRITE_CONFIRM',
  ],
  'canvas-history': [
    'HERMES_API_URL',
    'HERMES_API_KEY',
    'HERMES_SERVICE_TOKEN',
    'HERMES_SMOKE_USER_ID',
    'HERMES_SMOKE_WORKSPACE_ID',
    'HERMES_SMOKE_WORKFLOW_ID',
  ],
  isolation: ['HERMES_API_URL', 'HERMES_API_KEY', 'HERMES_SMOKE_USER_ID'],
}

function printUsage(): void {
  process.stdout.write(`SIM Hermes simulated manual testing

Usage:
  bun run hermes:simulate-manual -- --case chat-memory [--json]
  bun run hermes:simulate-manual -- --case canvas-summary
  bun run hermes:simulate-manual -- --case canvas-proposal
  bun run hermes:simulate-manual -- --case canvas-propose-confirm-apply
  bun run hermes:simulate-manual -- --case canvas-history
  bun run hermes:simulate-manual -- --case isolation

Options:
  --case <name>   Case to run. Repeat for multiple cases. Use "all" for every API-level case.
  --json          Print machine-readable results only.

Notes:
  This is API-level simulated manual testing. It exercises real SIM/Hermes APIs
  through scripts/hermes-sim-smoke.ts and emits the fields required by the plan:
  caseName, smokeFlags, requestIds, conversationKey, toolCalls, dbChecks,
  stateDiff, pass, failureReason, and raw checks.
  canvas-proposal verifies proposal + pendingActionId without applying canvas changes.
  canvas-propose-confirm-apply requires HERMES_SMOKE_WRITE_CONFIRM=APPLY_CANVAS_PROPOSAL.
`)
}

function isCaseName(value: string): value is SimulatedManualCaseName {
  return (ALL_CASES as string[]).includes(value)
}

export function parseSimulatedManualOptions(argv: string[]): SimulatedManualOptions {
  const cases: SimulatedManualCaseName[] = []
  let json = false
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--case') {
      const value = argv[index + 1]
      index += 1
      if (value === 'all') {
        cases.push(...ALL_CASES)
        continue
      }
      if (!value || !isCaseName(value)) {
        throw new Error(`Unsupported simulated manual case: ${value ?? '<missing>'}`)
      }
      cases.push(value)
      continue
    }
    throw new Error(`Unsupported option: ${arg}`)
  }
  return { cases: cases.length ? [...new Set(cases)] : ALL_CASES, json }
}

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value || undefined
}

function missingEnvForCase(caseName: SimulatedManualCaseName): string[] {
  const missing = CASE_REQUIRED_ENV[caseName].filter((key) => !envString(key))
  if (
    caseName === 'canvas-propose-confirm-apply' &&
    envString('HERMES_SMOKE_WRITE_CONFIRM') !== 'APPLY_CANVAS_PROPOSAL'
  ) {
    missing.push('HERMES_SMOKE_WRITE_CONFIRM=APPLY_CANVAS_PROPOSAL')
  }
  return [...new Set(missing)]
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function readString(value: unknown, key: string): string | undefined {
  const item = asRecord(value)?.[key]
  return typeof item === 'string' && item.trim() ? item : undefined
}

function readStringArray(value: unknown, key: string): string[] {
  const item = asRecord(value)?.[key]
  return Array.isArray(item)
    ? item.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []
}

function inferToolCalls(checks: CheckResult[]): string[] {
  const tools = new Set<string>()
  for (const check of checks) {
    const text = `${check.name} ${check.detail ?? ''}`
    if (/canvas-(read|propose|apply)/.test(text)) tools.add('sim_canvas_agent_run')
    if (/canvas-history/.test(text)) tools.add('sim_canvas_history_query')
    if (/skill-proposal|skill-list/.test(text)) tools.add('sim_skill_proposal_run')
    if (/^sim\.hermes-memory/.test(check.name)) tools.add('sim_memory_run')
  }
  return [...tools]
}

function buildRequestIds(checks: CheckResult[]): Record<string, string> {
  const ids: Record<string, string> = {}
  const idKeys = [
    'requestId',
    'responseId',
    'toolCallId',
    'auditId',
    'pendingActionId',
    'proposalId',
    'conversation',
  ] as const
  for (const check of checks) {
    const data = asRecord(check.data)
    for (const key of idKeys) {
      const value = readString(data, key)
      if (value && !ids[key]) ids[key] = value
    }
  }
  return ids
}

function buildDbChecks(checks: CheckResult[]): Record<string, unknown> {
  return Object.fromEntries(
    checks
      .filter((check) => /^sim\.|^hermes\.sim-/.test(check.name))
      .map((check) => [
        check.name,
        {
          status: check.status,
          detail: check.detail,
        },
      ])
  )
}

function buildStateDiff(
  caseName: SimulatedManualCaseName,
  checks: CheckResult[]
): Record<string, unknown> {
  if (caseName !== 'canvas-propose-confirm-apply') return {}
  const apply = checks.find((check) => check.name === 'hermes.sim-canvas-apply-after-confirm')
  const verify = checks.find((check) => check.name === 'sim.canvas-write-verify')
  return {
    changedNodeIds: readStringArray(apply?.data, 'changedNodeIds'),
    verificationSummary: readString(apply?.data, 'verificationSummary'),
    workflowStateCheck: verify
      ? {
          status: verify.status,
          detail: verify.detail,
        }
      : undefined,
  }
}

function failureReason(checks: CheckResult[]): string | undefined {
  return checks
    .filter((check) => check.status === 'fail')
    .map((check) => `${check.name}: ${check.detail ?? 'failed'}`)
    .join('; ')
}

async function runOneCase(caseName: SimulatedManualCaseName): Promise<SimulatedManualCaseResult> {
  const missing = missingEnvForCase(caseName)
  if (missing.length > 0) {
    return {
      caseName,
      smokeFlags: CASE_FLAGS[caseName],
      requestIds: {},
      toolCalls: [],
      dbChecks: {},
      stateDiff: {},
      pass: false,
      failureReason: `Missing required environment: ${missing.join(', ')}`,
      checks: missing.map((key) => ({
        name: `env:${key}`,
        status: 'fail',
        detail: `${key} is required for simulated manual case ${caseName}`,
      })),
    }
  }

  const smokeFlags = [...CASE_FLAGS[caseName], '--skip-sim-health']
  const { results } = await runSmoke(smokeFlags)
  const pass = !results.some((check) => check.status === 'fail')
  const requestIds = buildRequestIds(results)
  const conversationKey = requestIds.conversation
  return {
    caseName,
    smokeFlags,
    requestIds,
    conversationKey,
    toolCalls: inferToolCalls(results),
    dbChecks: buildDbChecks(results),
    stateDiff: buildStateDiff(caseName, results),
    pass,
    failureReason: pass ? undefined : failureReason(results),
    checks: results,
  }
}

export async function runSimulatedManualCases(
  options: SimulatedManualOptions
): Promise<SimulatedManualCaseResult[]> {
  const results: SimulatedManualCaseResult[] = []
  for (const caseName of options.cases) {
    results.push(await runOneCase(caseName))
  }
  return results
}

function printResults(results: SimulatedManualCaseResult[], json: boolean): void {
  const ok = results.every((result) => result.pass)
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok, cases: results }, null, 2)}\n`)
    return
  }
  for (const result of results) {
    process.stdout.write(
      `[${result.pass ? 'PASS' : 'FAIL'}] ${result.caseName}${
        result.failureReason ? ` - ${result.failureReason}` : ''
      }\n`
    )
  }
}

async function main(): Promise<void> {
  try {
    await loadDefaultLocalEnvFiles()
    const options = parseSimulatedManualOptions(process.argv.slice(2))
    const results = await runSimulatedManualCases(options)
    printResults(results, options.json)
    process.exit(results.every((result) => result.pass) ? 0 : 1)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
