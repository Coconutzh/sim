/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateCanvas, mockGetDocument, mockGetPage, mockRender } = vi.hoisted(() => ({
  mockCreateCanvas: vi.fn(),
  mockGetDocument: vi.fn(),
  mockGetPage: vi.fn(),
  mockRender: vi.fn(),
}))

vi.mock('@napi-rs/canvas', () => ({
  createCanvas: mockCreateCanvas,
}))

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mockGetDocument,
}))

import { renderPdfPagesToImages } from '@/lib/copilot/request/lifecycle/local-canvas-agent/pdf-renderer'

describe('renderPdfPagesToImages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRender.mockReturnValue({ promise: Promise.resolve() })
    mockGetPage.mockResolvedValue({
      getViewport: vi.fn(({ scale }: { scale: number }) => ({
        width: 1200 * scale,
        height: 800 * scale,
      })),
      render: mockRender,
    })
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 4,
        getPage: mockGetPage,
        destroy: vi.fn(async () => undefined),
      }),
    })
    mockCreateCanvas.mockReturnValue({
      getContext: vi.fn(() => ({ kind: '2d-context' })),
      toBuffer: vi.fn(() => Buffer.from('rendered-png')),
    })
  })

  it('renders only the requested PDF pages as base64 images', async () => {
    const pages = await renderPdfPagesToImages({
      buffer: Buffer.from('%PDF-1.7'),
      maxPages: 2,
      maxDimension: 600,
      maxBytesPerPage: 1024,
    })

    expect(mockGetDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        isEvalSupported: false,
      })
    )
    expect(mockGetPage).toHaveBeenCalledTimes(2)
    expect(mockCreateCanvas).toHaveBeenCalledWith(600, 400)
    expect(mockRender).toHaveBeenCalledWith(
      expect.objectContaining({
        canvas: expect.anything(),
        canvasContext: expect.anything(),
        viewport: expect.objectContaining({ width: 600, height: 400 }),
      })
    )
    expect(pages).toEqual([
      {
        pageNumber: 1,
        pageCount: 4,
        mimeType: 'image/png',
        data: Buffer.from('rendered-png').toString('base64'),
      },
      {
        pageNumber: 2,
        pageCount: 4,
        mimeType: 'image/png',
        data: Buffer.from('rendered-png').toString('base64'),
      },
    ])
  })
})
