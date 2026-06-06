import { getContentCanvasModelOptions } from '@/lib/content-canvas/model-catalog'

export const DEFAULT_TEXT_AI_MODEL = 'gemini-3.1-flash-lite-preview'
const EMPTY_TEXT_HTML = '<p></p>'

export interface TextAiModelOption {
  id: string
  label: string
  description: string
}

export interface ApplyGeneratedTextOptions {
  currentHtml: string | null | undefined
  generatedText: string
  mode: 'replace' | 'append'
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function isMeaningfulHtml(input: string | null | undefined): boolean {
  if (!input) return false
  return (
    input
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim().length > 0
  )
}

function normalizeGeneratedSource(input: string): string {
  return input
    .replaceAll('\r\n', '\n')
    .replace(/^```[^\n]*\n?/gm, '')
    .replace(/^```$/gm, '')
    .trim()
}

function joinParagraphLines(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
}

export function getTextAiModelOptions(enabledModelIds?: readonly string[]): readonly TextAiModelOption[] {
  const options = getContentCanvasModelOptions('text') as readonly TextAiModelOption[]
  if (!enabledModelIds) return options

  const enabledSet = new Set(enabledModelIds)
  return options.filter((option) => enabledSet.has(option.id))
}

export function buildTextNodeAiSystemPrompt(): string {
  return [
    'You are writing content for a whiteboard-style text node.',
    'Return polished user-facing writing only.',
    'Do not use code fences.',
    'Do not explain what you are doing unless the user explicitly asks.',
    'Prefer headings, paragraphs, and bullet lists when useful.',
    'Keep the content ready for direct insertion into the canvas text card.',
  ].join(' ')
}

export function convertGeneratedTextToContentHtml(input: string): string {
  const source = normalizeGeneratedSource(input)
  if (!source) return EMPTY_TEXT_HTML

  const blocks: string[] = []
  const paragraphLines: string[] = []
  const bulletLines: string[] = []

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return
    const paragraph = joinParagraphLines(paragraphLines)
    paragraphLines.length = 0
    if (!paragraph) return
    blocks.push(`<p>${escapeHtml(paragraph)}</p>`)
  }

  const flushBulletList = () => {
    if (bulletLines.length === 0) return
    const items = bulletLines.map((line) => `<li>${escapeHtml(line.trim())}</li>`).join('')
    bulletLines.length = 0
    blocks.push(`<ul>${items}</ul>`)
  }

  for (const rawLine of source.split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushBulletList()
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushBulletList()
      const level = headingMatch[1].length
      blocks.push(`<h${level}>${escapeHtml(headingMatch[2].trim())}</h${level}>`)
      continue
    }

    const bulletMatch = line.match(/^[-*•]\s+(.+)$/)
    if (bulletMatch) {
      flushParagraph()
      bulletLines.push(bulletMatch[1])
      continue
    }

    flushBulletList()
    paragraphLines.push(line)
  }

  flushParagraph()
  flushBulletList()

  return blocks.join('') || EMPTY_TEXT_HTML
}

export function applyGeneratedTextToContentHtml({
  currentHtml,
  generatedText,
  mode,
}: ApplyGeneratedTextOptions): string {
  const generatedHtml = convertGeneratedTextToContentHtml(generatedText)
  if (mode === 'replace' || !isMeaningfulHtml(currentHtml)) {
    return generatedHtml
  }

  return `${currentHtml ?? EMPTY_TEXT_HTML}${generatedHtml}`
}
