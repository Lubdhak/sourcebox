import { MarkdownPlugin } from '@platejs/markdown'
import { createPlateEditor } from 'platejs/react'
import { describe, expect, it } from 'vitest'
import { DOCUMENTATION_PLUGINS } from '@/features/documentation/editor/plugins'

/**
 * The round trip, which is the property the whole editor rests on.
 *
 * A page is stored as Markdown, parsed into a document to be edited, and written back on
 * every change -- so anything the pair of conversions does not preserve is lost by
 * *reading* a page with the editor open, no keystroke required. Worse, a conversion that
 * is merely unstable rewrites the document a little differently on each save, which is how
 * the old serializer turned a table into rows of debris.
 *
 * So every case here goes through both directions and expects the same document back, and
 * the ones that cannot come back unchanged say what they become instead.
 */
function editor(markdown: string) {
  return createPlateEditor({
    plugins: DOCUMENTATION_PLUGINS,
    value: (instance) => instance.getApi(MarkdownPlugin).markdown.deserialize(markdown),
  })
}

function roundTrip(markdown: string): string {
  return editor(markdown).getApi(MarkdownPlugin).markdown.serialize().trim()
}

describe('a documentation page as Markdown', () => {
  it('keeps the structure a page is made of', () => {
    const page = [
      '## Capture',
      '',
      'Handles **capture** and _refunds_, see `settle()`.',
      '',
      '- first',
      '- second',
      '',
      '1. one',
      '2. two',
      '',
      '> A caveat.',
    ].join('\n')

    expect(roundTrip(page)).toBe(page)
  })

  it('keeps a table, which is the thing the old editor most often ate', () => {
    const table = ['| Setting | Value |', '| ------- | ----- |', '| retries | 3     |'].join('\n')

    expect(roundTrip(table)).toBe(table)
  })

  it('keeps a table cell that contains the characters a row is made of', () => {
    // A literal pipe used to split the cell and the parser then dropped every cell past
    // the header's width. remark escapes it on the way out and unescapes it on the way in.
    const table = ['| Verb        | Who   |', '| ----------- | ----- |', '| read \\| write | owner |'].join('\n')

    expect(roundTrip(table)).toContain('read \\| write')
  })

  it('keeps a fenced block, its language, and every line of it', () => {
    const code = ['```json', '{', '  "retries": 3', '}', '```'].join('\n')

    expect(roundTrip(code)).toBe(code)
  })

  it('keeps a task list checked', () => {
    const list = ['- [x] capture', '- [ ] refund'].join('\n')

    expect(roundTrip(list)).toBe(list)
  })

  it('keeps a mention a mention, as a link to the node it names', () => {
    const page = 'Owned by [@Payments](#node-42).'

    expect(roundTrip(page)).toBe(page)
  })

  it('keeps an ordinary link, and a nested list, and a divider', () => {
    const page = ['See [the runbook](https://x/runbook).', '', '---'].join('\n')

    expect(roundTrip(page)).toBe(page)
  })

  it('says the same thing the second and third time it is read', () => {
    // Idempotence is the part that matters most: the page is serialized whenever the
    // editor is open, including for somebody who only read it.
    const page = [
      '# Payments',
      '',
      'See [@Ledger](#node-7) and the table.',
      '',
      '| Setting | Value |',
      '| ------- | ----- |',
      '| retries | 3     |',
      '',
      '```sql',
      'SELECT 1',
      '```',
      '',
      '- [ ] verify',
    ].join('\n')

    const once = roundTrip(page)

    expect(roundTrip(once)).toBe(once)
    expect(roundTrip(roundTrip(once))).toBe(once)
  })

  it('has no way to put a block inside a table cell', () => {
    // The bug that started all of this. It is not fixed here so much as made
    // unrepresentable: the schema says a cell holds blocks of text, and Markdown says a
    // row is one line, so the editor never offers to nest a table and a pasted one is
    // flattened by the parser rather than by rules of ours.
    const nested = ['| A | B |', '| - | - |', '| <table><tr><td>x</td></tr></table> | b |'].join('\n')

    const saved = roundTrip(nested)

    expect(saved.split('\n').filter((line) => line.startsWith('|'))).toHaveLength(3)
    expect(roundTrip(saved)).toBe(saved)
  })
})
