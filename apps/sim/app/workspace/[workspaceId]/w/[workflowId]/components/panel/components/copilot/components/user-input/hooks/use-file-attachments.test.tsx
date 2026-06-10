// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type AttachedFile, useFileAttachments } from './use-file-attachments'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const { mockMutateAsync, mockToastError } = vi.hoisted(() => ({
  mockMutateAsync: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/hooks/queries/workspace-files', () => ({
  useUploadWorkspaceFile: () => ({
    mutateAsync: mockMutateAsync,
  }),
}))

vi.mock('@/components/emcn', () => ({
  toast: {
    error: mockToastError,
  },
}))

interface HarnessProps {
  onHook: (hook: ReturnType<typeof useFileAttachments>) => void
}

function Harness({ onHook }: HarnessProps) {
  const hook = useFileAttachments({ userId: 'user-1', workspaceId: 'ws-1' })
  onHook(hook)
  return null
}

function renderHarness(): {
  root: Root
  container: HTMLDivElement
  getHook: () => ReturnType<typeof useFileAttachments>
} {
  let current: ReturnType<typeof useFileAttachments> | null = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<Harness onHook={(hook) => (current = hook)} />)
  })
  return {
    root,
    container,
    getHook: () => {
      if (!current) throw new Error('Hook not rendered')
      return current
    },
  }
}

function fileList(files: File[]): FileList {
  return files as unknown as FileList
}

function makeFile(name: string, type: string, content = 'content'): File {
  return new File([content], name, { type })
}

describe('useFileAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutateAsync.mockImplementation(async ({ file }: { file: File }) => ({
      success: true,
      file: {
        id: `wf_${file.name}`,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        url: `/api/files/serve/${encodeURIComponent(file.name)}?context=workspace`,
        key: `workspace/ws-1/${file.name}`,
        context: 'workspace',
      },
    }))
  })

  it.each([
    ['brief.pdf', 'application/pdf'],
    ['brief.doc', 'application/msword'],
    ['brief.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ])('uploads %s as a workspace file attachment', async (name, type) => {
    const harness = renderHarness()
    await act(async () => {
      await harness.getHook().processFiles(fileList([makeFile(name, type)]))
    })

    const [attached] = harness.getHook().attachedFiles as AttachedFile[]
    expect(attached).toMatchObject({
      workspaceFileId: `wf_${name}`,
      name,
      type,
      key: `workspace/ws-1/${name}`,
      storageContext: 'workspace',
      uploading: false,
    })
    expect(mockMutateAsync).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      file: expect.objectContaining({ name }),
      skipToast: true,
    })
    act(() => harness.root.unmount())
    harness.container.remove()
  })

  it('rejects unsupported attachment types before upload', async () => {
    const harness = renderHarness()
    await act(async () => {
      await harness
        .getHook()
        .processFiles(fileList([makeFile('malware.exe', 'application/octet-stream')]))
    })

    expect(harness.getHook().attachedFiles).toEqual([])
    expect(mockMutateAsync).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledWith(
      `Couldn't upload "malware.exe"`,
      expect.objectContaining({
        description: expect.stringContaining('Unsupported file type'),
      })
    )
    act(() => harness.root.unmount())
    harness.container.remove()
  })

  it('removes the placeholder and shows the upload error when workspace upload fails', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Storage limit exceeded'))
    const harness = renderHarness()

    await act(async () => {
      await harness.getHook().processFiles(fileList([makeFile('brief.pdf', 'application/pdf')]))
    })

    expect(harness.getHook().attachedFiles).toEqual([])
    expect(mockToastError).toHaveBeenCalledWith(
      `Couldn't upload "brief.pdf"`,
      expect.objectContaining({ description: 'Storage limit exceeded' })
    )
    act(() => harness.root.unmount())
    harness.container.remove()
  })
})
