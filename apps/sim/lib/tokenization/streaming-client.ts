import { createLogger } from '@sim/logger'
import { LLM_BLOCK_TYPES, TOKENIZATION_CONFIG } from '@/lib/tokenization/constants'
import type { BlockLog } from '@/executor/types'

const logger = createLogger('ClientStreamingTokenization')

function hasRealTokenData(tokens?: { total?: number; input?: number; output?: number }): boolean {
  if (!tokens) return false
  return (tokens.total ?? 0) > 0 || (tokens.input ?? 0) > 0 || (tokens.output ?? 0) > 0
}

function hasRealCostData(cost?: { total?: number; input?: number; output?: number }): boolean {
  if (!cost) return false
  return (cost.total ?? 0) > 0 || (cost.input ?? 0) > 0 || (cost.output ?? 0) > 0
}

function extractTextContent(input: unknown): string {
  if (typeof input === 'string') return input.trim()
  if (input && typeof input === 'object') {
    try {
      return JSON.stringify(input)
    } catch {
      return ''
    }
  }
  return String(input || '')
}

function estimateTokens(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return Math.ceil(trimmed.length / TOKENIZATION_CONFIG.fallback.avgCharsPerToken)
}

function isTokenizableBlockType(blockType?: string): boolean {
  if (!blockType) return false
  return (LLM_BLOCK_TYPES as readonly string[]).includes(blockType)
}

function processStreamingBlockLog(log: BlockLog, streamedContent: string): boolean {
  if (!isTokenizableBlockType(log.blockType)) return false
  if (hasRealTokenData(log.output?.tokens) && hasRealCostData(log.output?.cost)) return false
  if (log.output?.cost?.pricing) return false
  if (!streamedContent?.trim()) return false

  const inputTokens = estimateTokens(extractTextContent(log.input))
  const outputTokens = estimateTokens(streamedContent)
  if (!log.output) log.output = {}
  log.output.tokens = {
    input: inputTokens,
    output: outputTokens,
    total: inputTokens + outputTokens,
  }
  log.output.model = log.output.model || TOKENIZATION_CONFIG.defaults.model
  return true
}

/**
 * Adds lightweight token estimates for streamed client logs without bundling tokenizer tables.
 */
export function processStreamingBlockLogs(
  logs: BlockLog[],
  streamedContentMap: Map<string, string>
): number {
  let processedCount = 0

  for (const log of logs) {
    const content = streamedContentMap.get(log.blockId)
    if (content && processStreamingBlockLog(log, content)) {
      processedCount++
    }
  }

  logger.info('Client streaming tokenization summary', {
    totalLogs: logs.length,
    processedBlocks: processedCount,
    streamedBlocks: streamedContentMap.size,
  })

  return processedCount
}
