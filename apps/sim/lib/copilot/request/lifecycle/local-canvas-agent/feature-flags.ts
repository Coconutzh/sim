function readBooleanEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return defaultValue
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false
  return defaultValue
}

export function isLocalAgentPromptCacheEnabled(): boolean {
  return readBooleanEnv('LOCAL_CANVAS_AGENT_PROMPT_CACHE', true)
}

export function isLocalAgentAggregateObservationBudgetEnabled(): boolean {
  return readBooleanEnv('LOCAL_CANVAS_AGENT_AGGREGATE_OBSERVATION_BUDGET', true)
}

export function isLocalAgentGuardrailTelemetryEnabled(): boolean {
  return readBooleanEnv('LOCAL_CANVAS_AGENT_GUARDRAIL_TELEMETRY', true)
}

export function isLocalAgentPerformanceTelemetryEnabled(): boolean {
  return readBooleanEnv('LOCAL_CANVAS_AGENT_PERF_LOGS', false)
}
