#!/usr/bin/env bun

import { db, platformProviderApiKey } from '@sim/db'
import { generateShortId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { encryptSecret } from '@/lib/core/security/encryption'

const ENV_MAPPINGS = [
  ['openai', ['OPENAI_API_KEY_1', 'OPENAI_API_KEY']],
  ['anthropic', ['ANTHROPIC_API_KEY_1']],
  ['google', ['CONTENT_TEXT_GEMINI_API_KEY', 'GEMINI_API_KEY_1', 'GEMINI_API_KEY']],
  ['mistral', ['MISTRAL_API_KEY']],
  ['fireworks', ['FIREWORKS_API_KEY']],
  ['zhipu', ['CONTENT_TEXT_GLM_API_KEY', 'ZHIPU_API_KEY']],
  ['cerebras', ['CEREBRAS_API_KEY']],
  ['cohere', ['COHERE_API_KEY_1', 'COHERE_API_KEY']],
  ['deepseek', ['DEEPSEEK_API_KEY']],
  ['ark', ['CONTENT_IMAGE_ARK_API_KEY', 'ARK_API_KEY']],
  ['evolink', ['CONTENT_AUDIO_API_KEY', 'EVOLINK_API_KEY']],
  ['dashscope', ['CONTENT_VIDEO_API_KEY', 'DASHSCOPE_API_KEY']],
] as const

function findConfiguredKey(names: readonly string[]): [string, string] | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return [name, value]
  }
  return undefined
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  for (const [providerId, names] of ENV_MAPPINGS) {
    const configured = findConfiguredKey(names)
    if (!configured) {
      console.info(`${providerId}: skipped (no configured environment key)`)
      continue
    }
    const [sourceName, apiKey] = configured
    const [existing] = await db
      .select({ id: platformProviderApiKey.id })
      .from(platformProviderApiKey)
      .where(
        and(
          eq(platformProviderApiKey.providerId, providerId),
          eq(platformProviderApiKey.status, 'active')
        )
      )
      .limit(1)
    if (existing) {
      console.info(`${providerId}: skipped (active database key already exists)`)
      continue
    }
    if (dryRun) {
      console.info(`${providerId}: would import from ${sourceName}`)
      continue
    }
    const { encrypted } = await encryptSecret(apiKey)
    await db.insert(platformProviderApiKey).values({
      id: generateShortId(),
      providerId,
      label: 'Migrated environment primary key',
      encryptedApiKey: encrypted,
      isDefault: true,
      priority: 100,
    })
    console.info(`${providerId}: imported`)
  }
}

void main()
