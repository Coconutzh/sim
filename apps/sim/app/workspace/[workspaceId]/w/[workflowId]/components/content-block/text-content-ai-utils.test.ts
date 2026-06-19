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

  it('converts markdown headings, paragraphs, emphasis, and lists into supported HTML', () => {
    const html = convertGeneratedTextToContentHtml(`
# Launch plan

Intro paragraph line one with **bold** and *italic*.
Intro paragraph line two with __strong__ and _emphasis_.

- First task
* Second task

1. Confirm requirements
2. Ship implementation

## Wrap up
Final note.
		`)

    expect(html).toBe(
      '<h1>Launch plan</h1><p>Intro paragraph line one with <strong>bold</strong> and <em>italic</em>.<br>Intro paragraph line two with <strong>strong</strong> and <em>emphasis</em>.</p><ul><li>First task</li><li>Second task</li></ul><ol><li>Confirm requirements</li><li>Ship implementation</li></ol><h2>Wrap up</h2><p>Final note.</p>'
    )
  })

  it('preserves fenced code block content without rendering markdown syntax inside it', () => {
    const html = convertGeneratedTextToContentHtml(`
Here is code:

\`\`\`ts
const title = "# Not a heading"
const value = "**not bold**"
\`\`\`
		`)

    expect(html).toBe(
      '<p>Here is code:</p><p>const title = &quot;# Not a heading&quot;<br>const value = &quot;**not bold**&quot;</p>'
    )
  })

  it('unwraps an explicit markdown fence around the full generated response', () => {
    const html = convertGeneratedTextToContentHtml(`\`\`\`md
# Wrapped

- Item
\`\`\``)

    expect(html).toBe('<h1>Wrapped</h1><ul><li>Item</li></ul>')
  })

  it('treats an unlabeled full-response fence as code content', () => {
    const html = convertGeneratedTextToContentHtml(`\`\`\`
# Not a heading
**not bold**
\`\`\``)

    expect(html).toBe('<p># Not a heading<br>**not bold**</p>')
  })

  it('safely degrades blockquotes and GFM tables without losing content', () => {
    const html = convertGeneratedTextToContentHtml(`
> Important note
> with **emphasis**

| Area | Status |
| --- | --- |
| Design | **Done** |
| Build | In progress |
		`)

    expect(html).toBe(
      '<p>Important note<br>with <strong>emphasis</strong></p><ul><li><strong>Area:</strong> Design; <strong>Status:</strong> <strong>Done</strong></li><li><strong>Area:</strong> Build; <strong>Status:</strong> In progress</li></ul>'
    )
  })

  it('escapes raw HTML from generated markdown output', () => {
    const html = convertGeneratedTextToContentHtml(
      '# Safe\n\n<script>alert("x")</script>\n\n- <img src=x onerror=alert(1)>'
    )

    expect(html).toBe(
      '<h1>Safe</h1><p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p><ul><li>&lt;img src=x onerror=alert(1)&gt;</li></ul>'
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
