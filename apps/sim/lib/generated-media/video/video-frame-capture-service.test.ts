/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDownloadFileFromStorage,
  mockEnsureFfmpegBinary,
  mockFfmpeg,
  mockReadFile,
  mockUnlink,
  mockUploadWorkspaceFile,
  mockWriteFile,
} = vi.hoisted(() => {
  const handlers: Record<string, () => void> = {}
  const command = {
    seekInput: vi.fn(() => command),
    noAudio: vi.fn(() => command),
    outputOptions: vi.fn(() => command),
    on: vi.fn((eventName: string, handler: () => void) => {
      handlers[eventName] = handler
      return command
    }),
    save: vi.fn(() => {
      handlers.end?.()
      return command
    }),
  }

  return {
    mockDownloadFileFromStorage: vi.fn(),
    mockEnsureFfmpegBinary: vi.fn(),
    mockFfmpeg: Object.assign(
      vi.fn(() => command),
      { command, handlers }
    ),
    mockReadFile: vi.fn(),
    mockUnlink: vi.fn(),
    mockUploadWorkspaceFile: vi.fn(),
    mockWriteFile: vi.fn(),
  }
})

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}))

vi.mock('fluent-ffmpeg', () => ({
  default: (...args: unknown[]) => mockFfmpeg(...args),
}))

vi.mock('@/lib/media/ffmpeg', () => ({
  ensureFfmpegBinary: () => mockEnsureFfmpegBinary(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  uploadWorkspaceFile: (...args: unknown[]) => mockUploadWorkspaceFile(...args),
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: (...args: unknown[]) => mockDownloadFileFromStorage(...args),
}))

import { captureWorkspaceVideoFrame } from '@/lib/generated-media/video/video-frame-capture-service'

const sourceFile = {
  id: 'wf_source',
  name: 'clip.mp4',
  url: '/api/files/serve/workspace/ws-1/clip.mp4?context=workspace',
  key: 'workspace/ws-1/clip.mp4',
  size: 1000,
  type: 'video/mp4',
  context: 'workspace',
}

describe('captureWorkspaceVideoFrame', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDownloadFileFromStorage.mockResolvedValue(Buffer.from('video-binary'))
    mockReadFile.mockResolvedValue(Buffer.from('jpeg-binary'))
    mockUnlink.mockResolvedValue(undefined)
    mockUploadWorkspaceFile.mockResolvedValue({
      id: 'wf_frame',
      name: 'clip-frame-current.jpg',
      size: 11,
      type: 'image/jpeg',
      key: 'workspace/ws-1/clip-frame-current.jpg',
      url: '/api/files/serve/workspace/ws-1/clip-frame-current.jpg?context=workspace',
      context: 'workspace',
    })
  })

  it('seeks to the requested time and uploads a JPEG workspace file', async () => {
    const result = await captureWorkspaceVideoFrame({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceFile,
      timeSeconds: 1.25,
      mode: 'current',
    })

    expect(mockEnsureFfmpegBinary).toHaveBeenCalled()
    expect(mockDownloadFileFromStorage).toHaveBeenCalledWith(
      sourceFile,
      expect.stringMatching(/^video-frame-/),
      expect.anything()
    )
    expect(mockFfmpeg).toHaveBeenCalledWith(expect.stringContaining('sim-video-frame-input-'))
    expect(mockFfmpeg.command.seekInput).toHaveBeenCalledWith(1.25)
    expect(mockFfmpeg.command.noAudio).toHaveBeenCalled()
    expect(mockFfmpeg.command.outputOptions).toHaveBeenCalledWith(['-frames:v 1', '-q:v 2'])
    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      Buffer.from('jpeg-binary'),
      'clip-frame-current.jpg',
      'image/jpeg'
    )
    expect(result.file.type).toBe('image/jpeg')
  })

  it('uses the capture mode in the uploaded file name', async () => {
    await captureWorkspaceVideoFrame({
      workspaceId: 'ws-1',
      userId: 'user-1',
      sourceFile: { ...sourceFile, name: 'clip.with.dots.mov', type: 'video/quicktime' },
      timeSeconds: 4.95,
      mode: 'last',
    })

    expect(mockUploadWorkspaceFile).toHaveBeenCalledWith(
      'ws-1',
      'user-1',
      expect.any(Buffer),
      'clip.with.dots-frame-last.jpg',
      'image/jpeg'
    )
  })
})
