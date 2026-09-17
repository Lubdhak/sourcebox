import { mentionMarkdown } from '@/features/documentation/inspector/mentions'
import type { ContentBlock, ContentBlockData, ContentBlockKind } from '@/types'

/**
 * One node's content blocks, read as a single Markdown page.
 *
 * The server stores documentation as an ordered list of typed blocks, and the editor no
 * longer exposes that: a reader sees a page and a writer types a page, the way any
 * documentation tool works. Blocks remain the storage because they are what search
 * indexes and what the API returns, but the seam between "a list of typed payloads" and
 * "a document" has to live somewhere, and here is the honest place for it.
 *
 * Every type is representable in Markdown, so the conversion loses presentation rather
 * than content: a table becomes a GitHub-flavoured table, a code payload becomes a fenced
 * block with its language, a JSON payload becomes a fenced `json` block. A type this
 * build does not render is serialized as JSON in a fence rather than dropped -- it is
 * still somebody's writing, and silently discarding it on the first edit would be the
 * worst possible behaviour.
 *
 * The reverse direction is deliberately absent. Once a page is edited it is saved as one
 * Markdown block, and nothing tries to re-derive tables or code blocks from the text.
 * Guessing structure back out of prose is how an editor loses a paragraph.
 */

/** Where each block type keeps its prose, for the types that are prose. */
const PROSE_KEY: Partial<Record<ContentBlockKind, string>> = {
  TEXT: 'text',
  MARKDOWN: 'markdown',
}

export function blocksToMarkdown(blocks: ContentBlock[]): string {
  return blocks
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((block) => blockToMarkdown(block))
    .filter((section) => section.trim().length > 0)
    .join('\n\n')
}

/**
 * Whether the page is already exactly what this editor writes.
 *
 * Used to tell the author that saving will rewrite the stored shape of their page --
 * which is true the first time a seeded node with a table in it is edited, and false
 * forever after.
 */
export function isSingleMarkdownPage(blocks: ContentBlock[]): boolean {
  return blocks.length === 0 || (blocks.length === 1 && blocks[0]?.blockType === 'MARKDOWN')
}

function blockToMarkdown(block: ContentBlock): string {
  const heading = typeof block.data.title === 'string' && block.data.title.trim() ? `### ${block.data.title.trim()}` : null
  const body = bodyToMarkdown(block.blockType, block.data)

  return [heading, body].filter(Boolean).join('\n\n')
}

function bodyToMarkdown(kind: ContentBlockKind, data: ContentBlockData): string {
  const proseKey = PROSE_KEY[kind]
  if (proseKey) return string(data[proseKey])

  switch (kind) {
    case 'CODE':
      return fence(string(data.code), string(data.language))

    case 'JSON':
      return fence(JSON.stringify(data.value ?? null, null, 2), 'json')

    case 'TABLE':
      return table(data)

    case 'URL': {
      const url = string(data.url)
      if (!url) return ''

      return `[${string(data.label) || url}](${url})`
    }

    case 'NODE_REFERENCE': {
      const nodeId = string(data.nodeId)
      if (!nodeId) return ''

      return mentionMarkdown({ id: nodeId, title: string(data.label) || `Node ${nodeId}` })
    }

    case 'IMAGE': {
      const url = string(data.url)
      return url ? `![${string(data.alt) || string(data.caption)}](${url})` : ''
    }

    case 'VIDEO':
    case 'AUDIO':
    case 'EMBED': {
      const url = string(data.url)
      return url ? `[${string(data.title) || string(data.caption) || url}](${url})` : ''
    }

    case 'DIAGRAM':
      return fence(string(data.source), string(data.format) || 'mermaid')

    case 'DROPDOWN': {
      const options = Array.isArray(data.options) ? data.options : []
      return options.map((option) => `- ${cell(option)}`).join('\n')
    }

    default:
      // An unknown type still carries someone's content, so it is preserved verbatim
      // rather than converted into an empty string.
      return fence(JSON.stringify(data, null, 2), 'json')
  }
}

function table(data: ContentBlockData): string {
  const columns = (Array.isArray(data.columns) ? data.columns : []).map(cell)
  const rows = (Array.isArray(data.rows) ? data.rows : []).map((row) =>
    (Array.isArray(row) ? row : [row]).map(cell),
  )

  if (columns.length === 0 && rows.length === 0) return ''

  // A table with no header row is still a table in the data model and is not one in
  // Markdown, so the first row is promoted rather than the whole block being lost.
  const header = columns.length > 0 ? columns : (rows.shift() ?? [])
  const width = Math.max(header.length, ...rows.map((row) => row.length), 1)
  const pad = (row: string[]) => Array.from({ length: width }, (_, index) => row[index] ?? '')

  return [
    `| ${pad(header).join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${pad(row).join(' | ')} |`),
  ].join('\n')
}

function fence(body: string, language: string): string {
  if (!body.trim()) return ''

  // A body that itself contains a fence needs a longer one, or it closes the block early
  // and the rest of the page renders as prose.
  const longest = body.match(/`{3,}/g)?.reduce((max, run) => Math.max(max, run.length), 0) ?? 0
  const ticks = '`'.repeat(Math.max(3, longest + 1))

  return `${ticks}${language}\n${body.replace(/\n+$/, '')}\n${ticks}`
}

/** Cell values come from JSON, so anything that is not a string has to be rendered as one. */
function cell(value: unknown): string {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value)

  // A literal pipe would split the cell, and a newline would end the row.
  return text.replace(/\|/g, '\\|').replace(/\n+/g, ' ')
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
