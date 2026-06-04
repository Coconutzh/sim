/**
 * @vitest-environment jsdom
 */

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mockUseParams = vi.fn()
const mockUseSession = vi.fn()
const mockUseWorkflowMap = vi.fn()
const mockUseSettingsNavigation = vi.fn()
const mockUseSpeechToText = vi.fn()
const mockUseAvailableResources = vi.fn()
const mockUseContextManagement = vi.fn()
const mockUseFileAttachments = vi.fn()
const mockUseMentionMenu = vi.fn()
const mockUseMentionTokens = vi.fn()
const mockDraftGetState = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  useSession: () => mockUseSession(),
}))

vi.mock('@/hooks/queries/workflows', () => ({
  useWorkflowMap: () => mockUseWorkflowMap(),
}))

vi.mock('@/hooks/use-settings-navigation', () => ({
  useSettingsNavigation: () => mockUseSettingsNavigation(),
}))

vi.mock('@/hooks/use-speech-to-text', () => ({
  useSpeechToText: () => mockUseSpeechToText(),
}))

vi.mock(
  '@/app/workspace/[workspaceId]/home/components/mothership-view/components/add-resource-dropdown',
  () => ({
    useAvailableResources: () => mockUseAvailableResources(),
  })
)

vi.mock(
  '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/hooks',
  () => ({
    useContextManagement: () => mockUseContextManagement(),
    useFileAttachments: () => mockUseFileAttachments(),
    useMentionMenu: () => mockUseMentionMenu(),
    useMentionTokens: () => mockUseMentionTokens(),
  })
)

vi.mock('@/stores/mothership-drafts/store', () => ({
  useMothershipDraftsStore: {
    getState: () => mockDraftGetState(),
  },
}))

vi.mock('@/app/workspace/[workspaceId]/home/components/user-input/components', () => ({
  AnimatedPlaceholderEffect: () => null,
  AttachedFilesList: () => null,
  autoResizeTextarea: vi.fn(),
  DropOverlay: () => null,
  MAX_CHAT_TEXTAREA_HEIGHT: 200,
  mapResourceToContext: vi.fn(),
  MicButton: () => null,
  OVERLAY_CLASSES: '',
  PlusMenuDropdown: () => null,
  SendButton: ({
    onSubmit,
    canSubmit,
  }: {
    onSubmit: () => void
    canSubmit: boolean
  }) => (
    <button type='button' onClick={onSubmit} disabled={!canSubmit}>
      send
    </button>
  ),
  TEXTAREA_BASE_CLASSES: '',
}))

import { UserInput } from './user-input'

function renderIntoDocument(element: React.ReactElement): {
  container: HTMLDivElement
  root: Root
} {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return { container, root }
}

describe('UserInput integration', () => {
  const textareaRef = { current: null as HTMLTextAreaElement | null }
  const clearContexts = vi.fn()
  const setSelectedContexts = vi.fn()
  const clearAttachedFiles = vi.fn()
  const restoreAttachedFiles = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseParams.mockReturnValue({ workspaceId: 'workspace-1' })
    mockUseSession.mockReturnValue({ data: { user: { id: 'user-1' } } })
    mockUseWorkflowMap.mockReturnValue({ data: {} })
    mockUseSettingsNavigation.mockReturnValue({ navigateToSettings: vi.fn() })
    mockUseSpeechToText.mockReturnValue({
      isListening: false,
      isSupported: false,
      toggleListening: vi.fn(),
      resetTranscript: vi.fn(),
    })
    mockUseAvailableResources.mockReturnValue([])
    mockUseContextManagement.mockReturnValue({
      selectedContexts: [],
      addContext: vi.fn(),
      setSelectedContexts,
      clearContexts,
    })
    mockUseFileAttachments.mockReturnValue({
      attachedFiles: [],
      clearAttachedFiles,
      restoreAttachedFiles,
      fileInputRef: { current: null },
      isDragging: false,
      handleFileSelect: vi.fn(),
      handleFileClick: vi.fn(),
      removeFile: vi.fn(),
      handleDragOver: vi.fn(),
      handleDrop: vi.fn(),
      handleDragEnter: vi.fn(),
      handleDragLeave: vi.fn(),
      handleFileChange: vi.fn(),
    })
    mockUseMentionMenu.mockImplementation(() => ({
      textareaRef,
      getActiveMentionQueryAtPosition: vi.fn(() => null),
    }))
    mockUseMentionTokens.mockReturnValue({
      handleCut: vi.fn(),
      computeMentionRanges: vi.fn(() => []),
      removeContextsInSelection: vi.fn(),
      deleteRange: vi.fn(),
      findRangeContaining: vi.fn(() => null),
    })
    mockDraftGetState.mockReturnValue({
      drafts: {},
      clearDraft: vi.fn(),
      setDraft: vi.fn(),
    })
  })

  it('submits content-canvas messages with auto confirmation, extra thinking, and selected canvas context', async () => {
    const onSubmit = vi.fn()
    const prompt = '先生成一张图，再补一个文案节点，再接成视频'

    const { container, root } = renderIntoDocument(
      <UserInput
        defaultValue={prompt}
        onSubmit={onSubmit}
        isSending={false}
        onStopGeneration={vi.fn()}
        enableContentCanvasAgent
        autoSelectionCards={[
          {
            blockId: 'image-1',
            title: '主图',
            variant: 'image',
            mediaName: 'hero.png',
          },
          {
            blockId: 'text-1',
            title: '文案',
            variant: 'text',
            previewText: '夏日新品上线',
          },
        ]}
      />
    )

    const textarea = container.querySelector('textarea')
    const sendButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'send'
    )
    expect(textarea).not.toBeNull()
    expect(sendButton).not.toBeNull()

    await act(async () => {
      sendButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onSubmit).toHaveBeenCalledWith(
      prompt,
      undefined,
      undefined,
      expect.objectContaining({
        confirmationMode: 'auto',
        thinkingLevel: 'extra',
        autoSelectionContexts: [
          {
            kind: 'blocks',
            blockIds: ['image-1', 'text-1'],
            label: 'Current canvas selection (2)',
          },
        ],
      })
    )
    expect(clearAttachedFiles).toHaveBeenCalled()
    expect(clearContexts).toHaveBeenCalled()

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
