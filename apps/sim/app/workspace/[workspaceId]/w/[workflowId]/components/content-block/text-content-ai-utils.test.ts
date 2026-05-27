/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  applyGeneratedTextToContentHtml,
  buildTextNodeAiSystemPrompt,
  convertGeneratedTextToContentHtml,
  DEFAULT_TEXT_AI_MODEL,
  getTextAiModelOptions,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/content-block/text-content-ai-utils'

describe('text-content-ai-utils', () => {
  it('exposes the curated model list with the default model', () => {
    const options = getTextAiModelOptions()

    expect(DEFAULT_TEXT_AI_MODEL).toBe('gemini-3.1-flash-lite-preview')
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'gemini-3.1-flash-lite-preview',
          label: expect.any(String),
          description: expect.any(String),
        }),
        expect.objectContaining({
          id: 'gemini-2.5-pro',
        }),
        expect.objectContaining({
          id: 'glm-4.7-flash',
        }),
        expect.objectContaining({
          id: 'glm-4.7',
        }),
      ])
    )
  })

  it('converts markdown-like headings, paragraphs, and bullet lists into supported HTML', () => {
    const html = convertGeneratedTextToContentHtml(`
# Launch plan

Intro paragraph line one.
Intro paragraph line two.

- First task
- Second task

## Wrap up
Final note.
		`)

    expect(html).toBe(
      '<h1>Launch plan</h1><p>Intro paragraph line one. Intro paragraph line two.</p><ul><li>First task</li><li>Second task</li></ul><h2>Wrap up</h2><p>Final note.</p>'
    )
  })

  it('replaces or appends generated content without corrupting the simplified HTML shape', () => {
    const generatedText = '## Added section\n\n- Item one\n- Item two'

    expect(
      applyGeneratedTextToContentHtml({
        currentHtml: '<p>Old content</p>',
        generatedText,
        mode: 'replace',
      })
    ).toBe('<h2>Added section</h2><ul><li>Item one</li><li>Item two</li></ul>')

    expect(
      applyGeneratedTextToContentHtml({
        currentHtml: '<p>Old content</p>',
        generatedText,
        mode: 'append',
      })
    ).toBe('<p>Old content</p><h2>Added section</h2><ul><li>Item one</li><li>Item two</li></ul>')
  })

  it('builds a fixed system prompt for text-node writing output', () => {
    const prompt = buildTextNodeAiSystemPrompt()

    expect(prompt).toContain('whiteboard-style text node')
    expect(prompt).toContain('Do not use code fences')
    expect(prompt).toContain('headings, paragraphs, and bullet lists')
  })
})
