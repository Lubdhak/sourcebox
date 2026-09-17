import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '@/features/documentation/blocks/renderMarkdown'
import { htmlToMarkdown } from '@/features/documentation/inspector/pageHtml'

/**
 * Most of these are round trips, because that is the property the editor depends on.
 *
 * A page is stored as Markdown, rendered to HTML to be edited, and serialized back on
 * every change. Anything the pair of conversions does not preserve is lost by *reading* a
 * page with the editor open -- no keystroke required -- so the test for the serializer is
 * mostly "put it through both and get the same document".
 */
function roundTrip(markdown: string): string {
  return htmlToMarkdown(renderMarkdown(markdown))
}

describe('htmlToMarkdown', () => {
  it('preserves the structure a documentation page is made of', () => {
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

  it('preserves a table, which is the thing a rich editor most often eats', () => {
    const table = ['| Setting | Value |', '| --- | --- |', '| retries | 3 |'].join('\n')

    expect(roundTrip(table)).toBe(table)
  })

  it('keeps a table with empty cells on one row per row', () => {
    // The `<br>` an empty cell needs to be clickable is still a line break, and a line
    // break in a Markdown row ends it: every cell after it used to become a stray `|` on
    // a line of its own, and reading the page back parsed those as extra rows.
    const html =
      '<table><thead><tr><th>A</th><th>B</th></tr></thead>' +
      '<tbody><tr><td>hello</td><td><br></td></tr><tr><td><br></td><td><br></td></tr></tbody></table>'

    expect(htmlToMarkdown(html)).toBe('| A | B |\n| --- | --- |\n| hello |  |\n|  |  |')
  })

  it('turns a real break inside a cell into a space, which a row can hold', () => {
    const html = '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>one<br>two</td></tr></tbody></table>'

    expect(htmlToMarkdown(html)).toBe('| A |\n| --- |\n| one two |')
  })

  it('preserves a fenced block, contents untouched', () => {
    const code = ['```', 'SELECT 1', '```'].join('\n')

    expect(roundTrip(code)).toBe(code)
  })

  it('keeps a mention a mention', () => {
    // The chip is the point: an ordinary link rule would keep the href but lose the
    // shape, and formatting a browser adds inside the label would break the syntax.
    expect(htmlToMarkdown('<p>Owned by <a href="#node-42"><em>@Payments</em></a>.</p>')).toBe(
      'Owned by [@Payments](#node-42).',
    )
  })

  it('leaves an ordinary link alone', () => {
    expect(htmlToMarkdown('<p>See <a href="https://x/runbook">the runbook</a>.</p>')).toBe(
      'See [the runbook](https://x/runbook).',
    )
  })

  it('keeps a task list, checked state included', () => {
    const list = '- [x] capture\n- [ ] refund'

    expect(roundTrip(list)).toBe(list)
  })

  it('writes list markers the way a person would, so reading a page does not rewrite it', () => {
    // Turndown pads them by default. The page is serialized on every change, including
    // changes nobody made, so its idea of tidy has to match the stored document's.
    expect(htmlToMarkdown('<ul><li>first</li></ul>')).toBe('- first')
    expect(htmlToMarkdown('<ol start="3"><li>third</li></ol>')).toBe('3. third')
  })

  it('drops a paragraph with nothing in it, which Markdown cannot hold anyway', () => {
    expect(htmlToMarkdown('<p>One.</p><p><br></p><p>Two.</p>')).toBe('One.\n\nTwo.')
  })

  it('leaves the line numbers behind, so a snippet is not saved with its gutter', () => {
    // This is what lets the editor render code exactly as the page does. The numbers are
    // in the DOM, and everything in the DOM otherwise comes back through this function as
    // text: without the rule that deletes the gutter, editing a two-line snippet would
    // save "1 2" into the document above it.
    const fence = '```sql\nSELECT 1\nSELECT 2\n```'

    expect(roundTrip(fence)).toBe(fence)
  })

  it('normalises what a browser adds while editing', () => {
    // Non-breaking spaces are invisible in the source and change how Markdown parses
    // runs of whitespace; blank lines otherwise accumulate on every round trip.
    expect(htmlToMarkdown('<p>a\u00a0b</p><p><br></p><p><br></p><p>c</p>')).toBe('a b\n\nc')
  })
})
