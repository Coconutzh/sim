import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
/// <reference types="vitest" />
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { configDefaults, defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)

function resolveNextEnv(projectDir: string) {
  const workspaceRoot = path.resolve(projectDir, '../..')
  const candidates = [
    '@next/env',
    path.resolve(projectDir, 'node_modules/@next/env'),
    path.resolve(workspaceRoot, 'node_modules/@next/env'),
  ]

  const bunPackagesDir = path.resolve(workspaceRoot, 'node_modules/.bun')
  if (fs.existsSync(bunPackagesDir)) {
    for (const entry of fs.readdirSync(bunPackagesDir)) {
      if (!entry.startsWith('@next+env@')) continue
      candidates.push(path.resolve(bunPackagesDir, entry, 'node_modules/@next/env'))
    }
  }

  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {}
  }

  throw new Error(`Unable to resolve @next/env for Vitest. Tried: ${candidates.join(', ')}`)
}

const projectDir = process.cwd()
const nextEnv = resolveNextEnv(projectDir)
const { loadEnvConfig } = nextEnv.default || nextEnv

loadEnvConfig(projectDir)

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  cacheDir: path.resolve(projectDir, '.vitest-cache/vite'),
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/node_modules/**', '**/dist/**'],
    setupFiles: ['./vitest.setup.ts'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        useAtomics: true,
        isolate: true,
      },
    },
    fileParallelism: true,
    maxConcurrency: 10,
    testTimeout: 10000,
    deps: {
      optimizer: {
        web: {
          enabled: true,
        },
      },
    },
  },
  resolve: {
    alias: [
      {
        find: '@sim/db',
        replacement: path.resolve(__dirname, '../../packages/db'),
      },
      {
        find: '@sim/logger',
        replacement: path.resolve(__dirname, '../../packages/logger/src'),
      },
      {
        find: '@/stores/console/store',
        replacement: path.resolve(__dirname, 'stores/console/store.ts'),
      },
      {
        find: '@/stores/execution/store',
        replacement: path.resolve(__dirname, 'stores/execution/store.ts'),
      },
      {
        find: '@/blocks/types',
        replacement: path.resolve(__dirname, 'blocks/types.ts'),
      },
      {
        find: '@/serializer/types',
        replacement: path.resolve(__dirname, 'serializer/types.ts'),
      },
      { find: '@/lib', replacement: path.resolve(__dirname, 'lib') },
      { find: '@/stores', replacement: path.resolve(__dirname, 'stores') },
      {
        find: '@/components',
        replacement: path.resolve(__dirname, 'components'),
      },
      { find: '@/app', replacement: path.resolve(__dirname, 'app') },
      { find: '@/api', replacement: path.resolve(__dirname, 'app/api') },
      {
        find: '@/executor',
        replacement: path.resolve(__dirname, 'executor'),
      },
      {
        find: '@/providers',
        replacement: path.resolve(__dirname, 'providers'),
      },
      { find: '@/tools', replacement: path.resolve(__dirname, 'tools') },
      { find: '@/blocks', replacement: path.resolve(__dirname, 'blocks') },
      {
        find: '@/serializer',
        replacement: path.resolve(__dirname, 'serializer'),
      },
      { find: '@', replacement: path.resolve(__dirname) },
    ],
  },
})
