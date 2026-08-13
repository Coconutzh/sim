/**
 * @vitest-environment node
 */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { getPptxSlideCount } from '@/lib/presentation/pptx-slide-count'

describe('getPptxSlideCount', () => {
  it('counts only final PPTX slide XML parts', async () => {
    const zip = new JSZip()
    zip.file('ppt/slides/slide1.xml', '<p:sld />')
    zip.file('ppt/slides/slide2.xml', '<p:sld />')
    zip.file('ppt/slides/_rels/slide1.xml.rels', '<Relationships />')

    await expect(getPptxSlideCount(await zip.generateAsync({ type: 'nodebuffer' }))).resolves.toBe(2)
  })

  it('rejects a PPTX package with no slides', async () => {
    const zip = new JSZip()
    zip.file('ppt/presentation.xml', '<p:presentation />')

    await expect(getPptxSlideCount(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(
      'PPTX package has no slides'
    )
  })
})
