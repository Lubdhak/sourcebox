import TurndownService from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { MENTION_HREF_PREFIX, mentionNodeId } from '@/features/documentation/inspector/mentions'

/**
 * HTML back to Markdown, for the editor that edits the rendered page.
 *
 * The document is stored as Markdown and edited as formatted text, so something has to
 * serialize one into the other in both directions. This is the return leg:
 * `renderMarkdown` produces the HTML the author sees and types into, and this turns what
 * they left behind back into the Markdown that gets saved.
 *
 * Turndown rather than a hand-written serializer, for the same reason the other direction
 * uses a real parser. A contenteditable surface does not produce tidy markup -- browsers
 * emit `<b>`, `<div>`, nested spans with inline styles, `&nbsp;` between words, and a
 * different shape per browser for the same keystroke -- and normalising that is a long
 * tail of cases nobody enumerates correctly from memory. The GFM plugin adds the three
 * things a documentation page cannot do without: tables, strikethrough and task lists.
 *
 * Two rules are ours. Mentions have to survive as mentions, because that is this
 * application's one piece of syntax. And list items are re-done to use a single space
 * after the marker, because Turndown's default pads them -- `-   item`, `1.  item` -- and
 * a page that is only *read* with the editor open is serialized and saved, so anything
 * the round trip rewrites shows up as a diff nobody made.
 *
 * What is deliberately not preserved is an empty paragraph. Markdown has no way to say
 * "a paragraph with nothing in it", so keeping one means emitting blank lines that render
 * as nothing, accumulate on every save, and still do not come back as a paragraph. The
 * caret keeps working in one while it is being typed into; it just is not stored.
 */

function build(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  })

  service.use(gfm)

  // A mention is a link whose target names a node. Left to the ordinary link rule it
  // would still round-trip, but any stray formatting inside the label -- which a browser
  // adds freely when the caret sits at the edge of a chip -- would end up inside the link
  // text and break the syntax. Taking the label as plain text keeps the chip intact.
  service.addRule('mention', {
    filter: (node) =>
      node.nodeName === 'A' && mentionNodeId(node.getAttribute('href') ?? '') !== null,
    replacement: (_content, node) => {
      const element = node as HTMLElement
      const id = mentionNodeId(element.getAttribute('href') ?? '')
      const label = (element.textContent ?? '').replace(/^@/, '').trim()

      if (!id || !label) return element.textContent ?? ''

      return `[@${label.replace(/([[\]])/g, '\\$1')}](${MENTION_HREF_PREFIX}${id})`
    },
  })

  /*
    Code blocks, taken from the `<code>` element's text and nothing else.

    Turndown's own fenced rule requires the `<code>` to be the `<pre>`'s first child, and
    here it is not: a rendered block leads with the line-number gutter, because the editor
    shows a code block exactly as the page does rather than as a plain grey box. Without
    this rule that block serialized as *inline* code -- a three-line snippet collapsing
    onto one line, which is how a code block becomes a sentence.

    Reading only the code element is also what leaves the numbers behind. They are
    presentation; they are in the DOM; and everything else in the DOM comes back through
    this function as text.

    The fence is grown past the longest run of backticks inside, so a snippet that
    contains a fence does not end its own block.
  */
  service.addRule('codeBlock', {
    filter: 'pre',
    replacement: (_content, node) => {
      const element = node as HTMLElement
      const code = element.querySelector('code') ?? element
      const body = (code.textContent ?? '').replace(/\n+$/, '')
      const language = /language-(\S+)/.exec(code.className)?.[1] ?? ''
      const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length))
      const fence = '`'.repeat(Math.max(3, longest + 1))

      return `\n\n${fence}${language}\n${body}\n${fence}\n\n`
    },
  })

  /*
    Nothing inside a table cell may produce a newline.

    A Markdown row is one line, so a line break in a cell ends the row and every cell
    after it becomes a stray `|` on a line of its own -- which is what an empty cell did,
    because the `<br>` that gives an empty cell a caret position to click into is still a
    line break to a serializer. So a cell's break disappears when the cell is empty and
    becomes a space when it is not, and a paragraph inside a cell contributes its text
    without the blank lines a paragraph normally brings. The block converter resolves a
    newline in a cell the same way, for the same reason.
  */
  service.addRule('cellBreak', {
    filter: (node) => node.nodeName === 'BR' && insideCell(node),
    replacement: (_content, node) => (node.parentNode?.childNodes.length === 1 ? '' : ' '),
  })

  service.addRule('cellParagraph', {
    filter: (node) => node.nodeName === 'P' && insideCell(node),
    replacement: (content) => content,
  })

  // Turndown's own list rule, with the marker padding removed. Continuation lines are
  // indented by two spaces to stay inside the item, which is the narrowest indent every
  // parser agrees on.
  service.addRule('listItem', {
    filter: 'li',
    replacement: (content, node, options) => {
      const body = content
        .replace(/^\n+/, '')
        .replace(/\n+$/, '\n')
        .replace(/\n/g, '\n  ')
        // A checkbox and the text after it each bring their own space.
        .replace(/^(\[[ x]\])\s+/, '$1 ')

      const parent = node.parentNode as HTMLElement | null
      const marker =
        parent?.nodeName === 'OL'
          ? `${ordinal(parent, node)}. `
          : `${options.bulletListMarker} `

      return `${marker}${body}${node.nextSibling && !/\n$/.test(body) ? '\n' : ''}`
    },
  })

  return service
}

function insideCell(node: Node): boolean {
  for (let current = node.parentNode; current; current = current.parentNode) {
    if (current.nodeName === 'TD' || current.nodeName === 'TH') return true
    // Stop at the table: a break in a paragraph next to one is an ordinary break.
    if (current.nodeName === 'TABLE') return false
  }

  return false
}

/** Where this item sits in its list, honouring a `start` attribute if there is one. */
function ordinal(list: HTMLElement, item: Node): number {
  const start = Number(list.getAttribute('start') ?? 1)
  const index = Array.prototype.indexOf.call(list.children, item)

  return (globalThis.Number.isFinite(start) ? start : 1) + Math.max(0, index)
}

let service: TurndownService | null = null

export function htmlToMarkdown(html: string): string {
  // Built once, lazily: constructing the service parses its own rule set, and the editor
  // serializes on a debounce while somebody is typing.
  service ??= build()

  return (
    service
      .turndown(html)
      // A browser inserts non-breaking spaces while editing; they are invisible in the
      // source and change how Markdown parses runs of whitespace.
      .replace(/\u00a0/g, ' ')
      // Trailing whitespace first: a blank line with a space on it is not blank to the
      // rule below, and that is how stacked blank lines survive a round trip.
      .replace(/[ \t]+$/gm, '')
      // More than one blank line between blocks carries no meaning in Markdown.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}
