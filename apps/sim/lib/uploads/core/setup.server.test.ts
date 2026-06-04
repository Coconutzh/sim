import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('uploads setup runtime initialization', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('does not initialize local uploads until runtime setup is requested', async () => {
    const mkdir = vi.fn().mockResolvedValue(undefined)
    const existsSync = vi.fn().mockReturnValue(false)
    const getStorageProvider = vi.fn().mockReturnValue('Local')
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    vi.doMock('fs', () => ({
      existsSync,
    }))
    vi.doMock('fs/promises', () => ({
      mkdir,
    }))
    vi.doMock('@sim/logger', () => ({
      createLogger: vi.fn(() => logger),
    }))
    vi.doMock('@/lib/core/config/env', () => ({
      env: {},
    }))
    vi.doMock('@/lib/uploads/config', () => ({
      USE_BLOB_STORAGE: false,
      USE_S3_STORAGE: false,
      getStorageProvider,
    }))

    const setupModule = await import('./setup.server')

    expect(getStorageProvider).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()

    await setupModule.ensureUploadsRuntimeReady()

    expect(getStorageProvider).toHaveBeenCalledTimes(1)
    expect(mkdir).toHaveBeenCalledTimes(1)
  })
})
