import { isLocalAgentPromptCacheEnabled } from '@/lib/copilot/request/lifecycle/local-canvas-agent/feature-flags'
import { recordLocalAgentPerformanceMetric } from '@/lib/copilot/request/lifecycle/local-canvas-agent/observability'
import type {
  LocalAgentContext,
  LocalAgentRole,
  LocalAgentSkill,
} from '@/lib/copilot/request/lifecycle/local-canvas-agent/types'

const PROMPT_CACHE_VERSION = 'local-canvas-agent-prompt-cache-v1'
const MAX_PROMPT_CACHE_ENTRIES = 128

interface PromptCacheEntry<T> {
  value: T
  hits: number
}

interface PromptCacheResult<T> {
  value: T
  hit: boolean
  key: string
}

const promptCache = new Map<string, PromptCacheEntry<unknown>>()

function normalizeForStableJson(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(normalizeForStableJson)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeForStableJson(item)])
  )
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value))
}

function stableHash(input: string): string {
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function enforcePromptCacheLimit(): void {
  while (promptCache.size > MAX_PROMPT_CACHE_ENTRIES) {
    const firstKey = promptCache.keys().next().value
    if (!firstKey) return
    promptCache.delete(firstKey)
  }
}

function buildSkillCacheParts(skills: LocalAgentSkill[]): unknown {
  return skills
    .filter((skill) => skill.enabled)
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      contentHash: stableHash(skill.content),
      source: skill.source,
    }))
}

export function buildLocalAgentPromptCacheContextParts(context: LocalAgentContext): unknown {
  return {
    model: {
      provider: context.model.provider,
      model: context.model.model,
      mode: context.model.mode,
      useContentCanvasTextResolver: context.model.useContentCanvasTextResolver === true,
    },
    permissions: context.permissions,
    confirmationMode: context.confirmationMode,
    agent: {
      code: context.agent.code,
      systemPromptHash: stableHash(context.agent.systemPrompt),
    },
    discipline: {
      id: context.discipline.id,
      code: context.discipline.code,
    },
    skills: buildSkillCacheParts(context.skills),
  }
}

export function buildLocalAgentPromptCacheKey(params: {
  kind: string
  role?: LocalAgentRole
  version?: string
  parts: unknown
}): string {
  const payload = stableStringify({
    cacheVersion: PROMPT_CACHE_VERSION,
    kind: params.kind,
    role: params.role,
    version: params.version,
    parts: params.parts,
  })
  return `${params.kind}:${stableHash(payload)}`
}

export function getOrCreateLocalAgentPromptCacheEntry<T>(params: {
  kind: string
  role?: LocalAgentRole
  version?: string
  parts: unknown
  build: () => T
  measure?: (value: T) => number
}): PromptCacheResult<T> {
  const key = buildLocalAgentPromptCacheKey(params)
  if (!isLocalAgentPromptCacheEnabled()) {
    const value = params.build()
    recordLocalAgentPerformanceMetric({
      kind: 'prompt_cache',
      cacheKind: params.kind,
      cacheHit: false,
      cacheEnabled: false,
      cacheKey: key,
      chars: params.measure?.(value),
    })
    return { value, hit: false, key }
  }

  const existing = promptCache.get(key)
  if (existing) {
    existing.hits += 1
    recordLocalAgentPerformanceMetric({
      kind: 'prompt_cache',
      cacheKind: params.kind,
      cacheHit: true,
      cacheEnabled: true,
      cacheKey: key,
      chars: params.measure?.(existing.value as T),
    })
    return { value: existing.value as T, hit: true, key }
  }

  const value = params.build()
  promptCache.set(key, { value, hits: 0 })
  enforcePromptCacheLimit()
  recordLocalAgentPerformanceMetric({
    kind: 'prompt_cache',
    cacheKind: params.kind,
    cacheHit: false,
    cacheEnabled: true,
    cacheKey: key,
    chars: params.measure?.(value),
  })
  return { value, hit: false, key }
}

export function clearLocalAgentPromptCache(): void {
  promptCache.clear()
}

export function getLocalAgentPromptCacheSize(): number {
  return promptCache.size
}
