import { describe, expect, it } from 'vitest'
import { blocksToMarkdown, isSingleMarkdownPage } from '@/features/documentation/inspector/pageMarkdown'
import type { ContentBlock, ContentBlockData, ContentBlockKind } from '@/types'

let nextId = 0

function block(blockType: ContentBlockKind, data: ContentBlockData, position = nextId): ContentBlock {
  nextId += 1

  return { id: String(nextId), blockType, position, data }
}

describe('blocksToMarkdown', () => {
  it('reads a page in position order, with block headings as Markdown headings', () => {
    const page = blocksToMarkdown([
      block('MARKDOWN', { markdown: 'Second.' }, 1),
      block('TEXT', { title: 'Overview', text: 'First.' }, 0),
    ])

    expect(page).toBe('### Overview\n\nFirst.\n\nSecond.')
  })

  it('keeps a table a table', () => {
    const page = blocksToMarkdown([
      block('TABLE', { columns: ['Setting', 'Default'], rows: [['work_mem', '4MB']] }),
    ])

    expect(page).toBe('| Setting | Default |\n| --- | --- |\n| work_mem | 4MB |')
  })

  it('escapes a pipe inside a cell, which would otherwise split the row', () => {
    const page = blocksToMarkdown([block('TABLE', { columns: ['Verb'], rows: [['read | write']] })])

    expect(page).toContain('| read \\| write |')
  })

  it('fences code with its language', () => {
    expect(blocksToMarkdown([block('CODE', { code: 'SELECT 1;', language: 'sql' })])).toBe(
      '```sql\nSELECT 1;\n```',
    )
  })

  it('lengthens the fence when the code contains one', () => {
    const page = blocksToMarkdown([block('CODE', { code: 'Use ``` for a block', language: 'md' })])

    // A three-tick fence would close early and the rest of the page would render as prose.
    expect(page.startsWith('````md')).toBe(true)
  })

  it('renders a structured payload as JSON rather than dropping it', () => {
    expect(blocksToMarkdown([block('JSON', { value: { rps: 1200 } })])).toBe(
      '```json\n{\n  "rps": 1200\n}\n```',
    )
  })

  it('turns a node reference into a mention, which is what it is', () => {
    expect(blocksToMarkdown([block('NODE_REFERENCE', { nodeId: '42', label: 'Payments' })])).toBe(
      '[@Payments](#node-42)',
    )
  })

  it('preserves a block type this build cannot render', () => {
    // Somebody wrote it. Converting it to an empty string on their first edit would be
    // the worst possible behaviour.
    const page = blocksToMarkdown([block('CHECKLIST' as ContentBlockKind, { items: ['a'] })])

    expect(page).toContain('"items"')
  })

  it('skips blocks with nothing in them', () => {
    expect(blocksToMarkdown([block('MARKDOWN', { markdown: '' }), block('URL', {})])).toBe('')
  })
})

describe('isSingleMarkdownPage', () => {
  it('is true for an empty node and for one already stored as this editor saves it', () => {
    expect(isSingleMarkdownPage([])).toBe(true)
    expect(isSingleMarkdownPage([block('MARKDOWN', { markdown: 'x' })])).toBe(true)
  })

  it('is false when saving would change how the page is stored', () => {
    expect(isSingleMarkdownPage([block('TABLE', { columns: [], rows: [] })])).toBe(false)
    expect(
      isSingleMarkdownPage([block('MARKDOWN', { markdown: 'a' }), block('MARKDOWN', { markdown: 'b' })]),
    ).toBe(false)
  })
})
