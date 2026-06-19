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
  const source = input.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim()
  const wrapperMatch = source.match(/^```([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*)\n```$/)
  if (!wrapperMatch) return source

  const language = wrapperMatch[1].toLowerCase()
  if (language !== 'md' && language !== 'markdown' && language !== 'text') {
    return source
  }

  return wrapperMatch[2].trim()
}

function renderInlineMarkdown(input: string): string {
  let output = ''
  let index = 0

  while (index < input.length) {
    const current = input[index]
    const next = input[index + 1]
    const pair = input.slice(index, index + 2)

    if (current === '\\' && next) {
      output += escapeHtml(next)
      index += 2
      continue
    }

    if (current === '`') {
      const closingIndex = input.indexOf('`', index + 1)
      if (closingIndex > index + 1) {
        output += escapeHtml(input.slice(index + 1, closingIndex))
        index = closingIndex + 1
        continue
      }
    }

    if ((pair === '**' || pair === '__') && !/\s/.test(input[index + 2] ?? '')) {
      const closingIndex = input.indexOf(pair, index + 2)
      if (closingIndex > index + 2) {
        const inner = input.slice(index + 2, closingIndex)
        if (inner.trim()) {
          output += `<strong>${renderInlineMarkdown(inner)}</strong>`
          index = closingIndex + 2
          continue
        }
      }
    }

    if ((current === '*' || current === '_') && next && !/\s/.test(next)) {
      const previous = input[index - 1]
      const isWordInternalUnderscore =
        current === '_' && /[A-Za-z0-9]/.test(previous ?? '') && /[A-Za-z0-9]/.test(next)

      if (!isWordInternalUnderscore) {
        const closingIndex = input.indexOf(current, index + 1)
        if (closingIndex > index + 1) {
          const inner = input.slice(index + 1, closingIndex)
          if (inner.trim()) {
            output += `<em>${renderInlineMarkdown(inner)}</em>`
            index = closingIndex + 1
            continue
          }
        }
      }
    }

    output += escapeHtml(current)
    index += 1
  }

  return output
}

function renderParagraphLines(lines: string[]): string {
  const content = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map(renderInlineMarkdown)
    .join('<br>')

  return content ? `<p>${content}</p>` : ''
}

function renderCodeBlock(lines: string[]): string {
  const content = lines.map(escapeHtml).join('<br>').trim()
  return content ? `<p>${content}</p>` : ''
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let current = ''
  let escaped = false

  for (const char of trimmed) {
    if (char === '|' && !escaped) {
      cells.push(current.trim())
      current = ''
      continue
    }

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    current += char
  }

  cells.push(current.trim())
  return cells
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line)
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
}

function renderTableAsList(headers: string[], rows: string[][]): string {
  const items = rows
    .map((row) =>
      row
        .map((cell, index) => {
          if (!cell.trim()) return ''
          const header = headers[index]?.trim()
          const renderedCell = renderInlineMarkdown(cell)
          return header
            ? `<strong>${renderInlineMarkdown(header)}:</strong> ${renderedCell}`
            : renderedCell
        })
        .filter(Boolean)
        .join('; ')
    )
    .filter(Boolean)

  if (items.length > 0) {
    return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`
  }

  return renderParagraphLines(headers)
}

export function getTextAiModelOptions(
  enabledModelIds?: readonly string[]
): readonly TextAiModelOption[] {
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
  const codeLines: string[] = []
  let listKind: 'ul' | 'ol' | null = null
  let listItems: string[] = []
  let insideCodeBlock = false

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return
    const paragraph = renderParagraphLines(paragraphLines)
    paragraphLines.length = 0
    if (paragraph) blocks.push(paragraph)
  }

  const flushList = () => {
    if (!listKind || listItems.length === 0) return
    const items = listItems.map((line) => `<li>${renderInlineMarkdown(line.trim())}</li>`).join('')
    blocks.push(`<${listKind}>${items}</${listKind}>`)
    listKind = null
    listItems = []
  }

  const flushCodeBlock = () => {
    if (codeLines.length === 0) return
    const codeBlock = renderCodeBlock(codeLines)
    codeLines.length = 0
    if (codeBlock) blocks.push(codeBlock)
  }

  const lines = source.split('\n')
  let lineIndex = 0

  while (lineIndex < lines.length) {
    const rawLine = lines[lineIndex]
    const line = rawLine.trim()

    if (insideCodeBlock) {
      if (/^```\s*$/.test(line)) {
        flushCodeBlock()
        insideCodeBlock = false
      } else {
        codeLines.push(rawLine)
      }
      lineIndex += 1
      continue
    }

    if (/^```/.test(line)) {
      flushParagraph()
      flushList()
      insideCodeBlock = true
      lineIndex += 1
      continue
    }

    if (!line) {
      flushParagraph()
      flushList()
      lineIndex += 1
      continue
    }

    if (line.includes('|') && isTableSeparator(lines[lineIndex + 1] ?? '')) {
      flushParagraph()
      flushList()
      const headers = splitTableRow(line)
      const rows: string[][] = []
      lineIndex += 2

      while (lineIndex < lines.length) {
        const tableLine = lines[lineIndex].trim()
        if (!tableLine || !tableLine.includes('|') || isTableSeparator(tableLine)) break
        rows.push(splitTableRow(tableLine))
        lineIndex += 1
      }

      const table = renderTableAsList(headers, rows)
      if (table) blocks.push(table)
      continue
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1].length
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2].trim())}</h${level}>`)
      lineIndex += 1
      continue
    }

    const orderedListMatch = line.match(/^\d+[.)]\s+(.+)$/)
    if (orderedListMatch) {
      flushParagraph()
      if (listKind !== 'ol') flushList()
      listKind = 'ol'
      listItems.push(orderedListMatch[1])
      lineIndex += 1
      continue
    }

    const bulletMatch = line.match(/^[-*+\u2022]\s+(.+)$/)
    if (bulletMatch) {
      flushParagraph()
      if (listKind !== 'ul') flushList()
      listKind = 'ul'
      listItems.push(bulletMatch[1])
      lineIndex += 1
      continue
    }

    const quoteMatch = line.match(/^>\s?(.*)$/)
    if (quoteMatch) {
      flushParagraph()
      flushList()
      const quoteLines: string[] = []

      while (lineIndex < lines.length) {
        const quotedLine = lines[lineIndex].trim()
        const currentQuoteMatch = quotedLine.match(/^>\s?(.*)$/)
        if (!currentQuoteMatch) break
        quoteLines.push(currentQuoteMatch[1])
        lineIndex += 1
      }

      const quote = renderParagraphLines(quoteLines)
      if (quote) blocks.push(quote)
      continue
    }

    flushList()
    paragraphLines.push(line)
    lineIndex += 1
  }

  flushParagraph()
  flushList()
  flushCodeBlock()

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
