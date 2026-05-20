#!/usr/bin/env bun

/**
 * Fails when application source imports the heavy Sim tool registry directly.
 *
 * Runtime code should use `@/tools/catalog` for metadata or
 * `@/tools/utils.server#getToolAsync` for execution-time loading.
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const ROOT = process.cwd()
const APP_DIR = join(ROOT, 'apps', 'sim')
const IMPORT_PATTERNS = ['@/tools/registry', '@/tools/registry']

const ALLOWED_RELATIVE_PATHS = new Set([
  join('apps', 'sim', 'tools', 'registry.ts'),
  join('apps', 'sim', 'scripts', 'check-block-registry.ts'),
])

function isSourceFile(path: string): boolean {
  return /\.(ts|tsx)$/.test(path)
}

function isIgnored(path: string): boolean {
  const normalized = relative(ROOT, path)
  return (
    normalized.includes(`${sep}node_modules${sep}`) ||
    normalized.includes(`${sep}.next${sep}`) ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.test.tsx') ||
    normalized.endsWith('.spec.ts') ||
    normalized.endsWith('.spec.tsx') ||
    ALLOWED_RELATIVE_PATHS.has(normalized)
  )
}

async function collectFiles(dir: string, files: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      await collectFiles(path, files)
      continue
    }
    if (entry.isFile() && isSourceFile(path) && !isIgnored(path)) {
      files.push(path)
    }
  }
  return files
}

async function main(): Promise<void> {
  const files = await collectFiles(APP_DIR)
  const violations: string[] = []

  for (const file of files) {
    const content = await readFile(file, 'utf8')
    if (IMPORT_PATTERNS.some((pattern) => content.includes(pattern))) {
      violations.push(relative(ROOT, file))
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      [
        'Direct @/tools/registry imports are not allowed outside explicit maintenance files.',
        'Use @/tools/catalog for metadata or @/tools/utils.server#getToolAsync for execution.',
        ...violations.map((file) => `- ${file}`),
        '',
      ].join('\n')
    )
    process.exit(1)
  }

  process.stdout.write('Tool registry boundary check passed\n')
}

await main()
