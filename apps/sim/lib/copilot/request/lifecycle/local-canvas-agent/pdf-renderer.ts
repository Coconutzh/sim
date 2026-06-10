import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'

const logger = createLogger('LocalCanvasAgentPdfRenderer')
const JPEG_QUALITY_STEPS = [85, 70, 55, 40] as const
const STANDARD_FONT_DATA_URL = pathToFileURL(
  join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/')
).href

export interface RenderedPdfPageImage {
  pageNumber: number
  pageCount: number
  mimeType: 'image/png' | 'image/jpeg'
  data: string
}

async function compressRenderedPage(params: {
  pngBuffer: Buffer
  maxBytesPerPage: number
}): Promise<{ mimeType: 'image/png' | 'image/jpeg'; buffer: Buffer } | null> {
  if (params.pngBuffer.length <= params.maxBytesPerPage) {
    return { mimeType: 'image/png', buffer: params.pngBuffer }
  }

  const sharp = (await import('sharp')).default
  for (const quality of JPEG_QUALITY_STEPS) {
    const jpegBuffer = await sharp(params.pngBuffer)
      .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
      .toBuffer()
    if (jpegBuffer.length <= params.maxBytesPerPage) {
      return { mimeType: 'image/jpeg', buffer: jpegBuffer }
    }
  }

  return null
}

export async function renderPdfPagesToImages(params: {
  buffer: Buffer
  maxPages: number
  maxDimension: number
  maxBytesPerPage: number
}): Promise<RenderedPdfPageImage[]> {
  const startedAt = Date.now()
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(params.buffer),
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
  }).promise

  const pageCount = pdf.numPages
  const pagesToRender = Math.min(pageCount, Math.max(0, params.maxPages))
  const renderedPages: RenderedPdfPageImage[] = []

  try {
    for (let pageNumber = 1; pageNumber <= pagesToRender; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const baseViewport = page.getViewport({ scale: 1 })
      const longestSide = Math.max(baseViewport.width, baseViewport.height)
      const scale = longestSide > 0 ? Math.min(1, params.maxDimension / longestSide) : 1
      const viewport = page.getViewport({ scale })
      const width = Math.max(1, Math.ceil(viewport.width))
      const height = Math.max(1, Math.ceil(viewport.height))
      const canvas = createCanvas(width, height)
      const canvasContext = canvas.getContext('2d')

      await page.render({
        canvas: canvas as never,
        canvasContext: canvasContext as never,
        viewport,
      }).promise

      const compressed = await compressRenderedPage({
        pngBuffer: canvas.toBuffer('image/png'),
        maxBytesPerPage: params.maxBytesPerPage,
      })
      if (!compressed) {
        logger.warn('Rendered PDF page exceeded vision byte budget', {
          pageNumber,
          pageCount,
          maxBytesPerPage: params.maxBytesPerPage,
        })
        continue
      }

      renderedPages.push({
        pageNumber,
        pageCount,
        mimeType: compressed.mimeType,
        data: compressed.buffer.toString('base64'),
      })
    }

    logger.info('Rendered PDF pages for attachment vision', {
      pageCount,
      renderedPageCount: renderedPages.length,
      elapsedMs: Date.now() - startedAt,
    })

    return renderedPages
  } catch (error) {
    logger.warn('Failed to render PDF pages for attachment vision', {
      pageCount,
      elapsedMs: Date.now() - startedAt,
      error: toError(error).message,
    })
    throw error
  } finally {
    await pdf.destroy()
  }
}
