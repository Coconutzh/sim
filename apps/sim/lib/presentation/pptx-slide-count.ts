import { parseZip } from '@/lib/pptx-renderer/parser/zip-parser'
import { SIM_PPTX_ZIP_LIMITS } from '@/lib/pptx-renderer/sim-pptx-viewer'

/** Reads the slide parts from a validated PPTX package to determine its actual page count. */
export async function getPptxSlideCount(buffer: Buffer): Promise<number> {
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer
  const files = await parseZip(arrayBuffer, SIM_PPTX_ZIP_LIMITS)
  const slideCount = files.slides.size
  if (slideCount < 1) throw new Error('PPTX package has no slides')
  return slideCount
}
