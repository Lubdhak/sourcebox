import { useCallback, useEffect, useRef } from 'react'
import { codeBlockHtml, languageOf, resolveLanguage } from '@/features/documentation/blocks/highlight'
import { renderMarkdown } from '@/features/documentation/blocks/renderMarkdown'
import type { TableSize } from '@/features/documentation/inspector/markdownCommands'
import { htmlToMarkdown } from '@/features/documentation/inspector/pageHtml'
import { MENTION_HREF_PREFIX, mentionQueryAt, type MentionQuery } from '@/features/documentation/inspector/mentions'

/**
 * The formatted editing surface: the rendered page, typed into directly.
 *
 * The author never sees Markdown here. They see headings that look like headings and
 * bullets that look like bullets, and the toolbar produces them -- which is the whole
 * point, because knowing that `##` makes a heading is not a reasonable thing to require
 * of somebody documenting a system.
 *
 * Markdown stays the stored form. It round-trips through this component:
 * `renderMarkdown` on the way in, `htmlToMarkdown` on the way out, debounced, and the
 * result is diffed into the shared text so collaborators receive a positioned edit rather
 * than a rewrite. The honest cost of that design is granularity -- a serialize-and-diff
 * cycle merges at the level of a changed region, not a keystroke -- and the honest
 * benefit is that the document stays greppable, diffable, exportable text rather than a
 * proprietary tree that only this editor can read.
 *
 * Two mechanics deserve naming because they are where a contenteditable normally goes
 * wrong:
 *
 *   Re-rendering. The HTML is written into the element exactly once per *incoming*
 *   change, never in response to local typing. React re-rendering this element on every
 *   keystroke would destroy and rebuild the DOM the caret lives in; instead the browser
 *   owns the DOM between incoming changes, and the caret is restored by character offset
 *   when a collaborator's edit forces a re-render.
 *
 *   Commands. `document.execCommand` is formally deprecated and is still the only API
 *   that applies a format to a selection with the caret behaviour people expect, in every
 *   engine, without shipping a document model of our own. It is used deliberately, behind
 *   one function, so the day a replacement exists there is one place to change.
 */

export interface RichEditorHandle {
  /** Applies a formatting command to the current selection. */
  run: (command: RichCommand) => void
  /** Replaces the `@query` before the caret with a mention chip. */
  insertMention: (range: MentionQuery, node: { id: string; title: string }) => void
  /** Starts a mention where the caret is, for the toolbar's `@` button. */
  startMention: () => void
  focus: () => void
}

export type RichCommand =
  | { kind: 'inline'; command: 'bold' | 'italic' | 'strikeThrough' | 'underline' }
  | { kind: 'block'; tag: 'h1' | 'h2' | 'h3' | 'blockquote' | 'p' }
  | { kind: 'list'; ordered: boolean }
  | { kind: 'checklist' }
  | { kind: 'code' }
  | { kind: 'codeBlock'; language: string | null }
  | { kind: 'table'; size: TableSize }
  | { kind: 'divider' }
  | { kind: 'link'; href: string }
  | { kind: 'clear' }

export function RichEditor({
  value,
  editable = true,
  handle,
  onChangeMarkdown,
  onMentionQuery,
  onFocus,
  onBlur,
  onEscape,
  onPickerKeys,
  onShortcut,
}: {
  /** The document, as Markdown. Rendered on mount and whenever it changes elsewhere. */
  value: string
  editable?: boolean
  /** Filled in with the imperative API the toolbar needs. */
  handle?: React.RefObject<RichEditorHandle | null>
  onChangeMarkdown: (markdown: string) => void
  /** The mention being typed, or null. Called on every input and selection change. */
  onMentionQuery?: (query: MentionQuery | null) => void
  onFocus?: () => void
  onBlur?: () => void
  onEscape?: () => void
  /**
   * Given first refusal on arrow and Enter keys, so the mention picker can own them while
   * it is open. Returns true when it consumed the key.
   */
  onPickerKeys?: (event: React.KeyboardEvent) => boolean
  /**
   * Given the modifier combinations before the browser sees them, for the ones this
   * surface cannot answer alone -- a link needs a target, and Cmd+Enter means finish.
   * Returns true when it consumed the key.
   */
  onShortcut?: (event: React.KeyboardEvent) => boolean
}) {
  const container = useRef<HTMLDivElement>(null)

  // The last Markdown this component either rendered or produced. Incoming values equal
  // to it need no re-render, which is what keeps a local keystroke from rebuilding the
  // DOM under the caret after it has been echoed back through the shared document.
  const settled = useRef<string | null>(null)

  /** True between compositionstart and compositionend, while an IME owns the text. */
  const composing = useRef(false)

  const serialize = useCallback(() => {
    const element = container.current
    if (!element) return

    const markdown = htmlToMarkdown(element.innerHTML)
    if (markdown === settled.current) return

    settled.current = markdown
    onChangeMarkdown(markdown)
  }, [onChangeMarkdown])

  const reportMention = useCallback(() => {
    if (!onMentionQuery) return

    onMentionQuery(mentionQueryAtCaret(container.current))
  }, [onMentionQuery])

  /**
   * Re-tokenises the code block the caret is in.
   *
   * The document as a whole is never re-rendered while somebody types -- that is what
   * would destroy the caret -- but a code block can be, because it is small and the caret
   * inside it is restorable by character offset. So the colouring and the line numbers
   * stay correct as the snippet is written, which is the difference between highlighting
   * that helps and highlighting that lies.
   *
   * Nothing happens outside a code block, or mid-composition: replacing the DOM under an
   * IME cancels the word being composed.
   */
  const rehighlightCode = useCallback(() => {
    const element = container.current
    if (!element || composing.current) return

    const pre = enclosingElement(['PRE'])
    if (!pre || !element.contains(pre)) return

    const code = pre.querySelector('code')
    // No caret inside the code itself means no offset to put back, and replacing the
    // markup would drop the selection somewhere arbitrary.
    const caret = code ? caretOffset(code) : null
    if (!code || caret === null) return

    const language = languageOf(pre)
    const html = codeBlockHtml(code.textContent ?? '', language)
    if (html === pre.innerHTML) return

    pre.innerHTML = html
    // Also set here, not only by the renderer, so a block inserted by the toolbar gets
    // the page's chrome -- gutter, background, language label -- the moment it exists.
    pre.className = 'code-block'
    if (language) pre.setAttribute('data-language', language)

    const rendered = pre.querySelector('code')
    if (rendered) restoreCaret(rendered, caret)
  }, [])

  // Incoming changes only. See the note about re-rendering above.
  useEffect(() => {
    const element = container.current
    if (!element) return
    if (value === settled.current) return

    const caret = element.contains(document.activeElement) || document.activeElement === element
      ? caretOffset(element)
      : null

    settled.current = value
    // Trimmed, because the parser leaves a newline after the last block and a bare text
    // node at the end of a contenteditable is a caret position outside every paragraph:
    // type there and the words land in their own block instead of the sentence.
    element.innerHTML = renderMarkdown(value).trim() || '<p><br></p>'

    if (caret !== null) restoreCaret(element, caret)
  }, [value])

  useEffect(() => {
    if (!handle) return

    handle.current = {
      run: (command) => {
        container.current?.focus()
        applyCommand(command)
        serialize()
        rehighlightCode()
        reportMention()
      },
      insertMention: (range, node) => {
        replaceQueryWithMention(container.current, range, node)
        serialize()
        onMentionQuery?.(null)
      },
      startMention: () => {
        container.current?.focus()
        insertText('@')
        serialize()
        reportMention()
      },
      focus: () => container.current?.focus(),
    }

    return () => {
      handle.current = null
    }
  }, [handle, onMentionQuery, reportMention, rehighlightCode, serialize])

  return (
    <div
      ref={container}
      // Markdown is the storage format, so the rendered page is styled by exactly the
      // same rules a reader sees. Editing something that looks different from the
      // published result is the failure mode this whole surface exists to avoid.
      className="documentation-markdown h-full overflow-y-auto px-6 py-4 text-sm leading-relaxed focus-visible:outline-none"
      contentEditable={editable}
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Page content"
      onInput={() => {
        serialize()
        rehighlightCode()
        reportMention()
      }}
      onCompositionStart={() => {
        composing.current = true
      }}
      onCompositionEnd={() => {
        composing.current = false
        rehighlightCode()
      }}
      onKeyUp={reportMention}
      onMouseUp={reportMention}
      onFocus={onFocus}
      onBlur={() => {
        // Serialized on the way out as well as on input: the debounce upstream may still
        // be pending, and a page left by clicking elsewhere must not lose its last word.
        serialize()
        onBlur?.()
      }}
      onKeyDown={(event) => {
        // While the picker is open it owns the navigation keys. Everything else falls
        // through, so typing never stops working.
        if (onPickerKeys?.(event)) return
        if (onShortcut?.(event)) return

        if (event.key === 'Escape') {
          event.stopPropagation()
          onEscape?.()
          return
        }

        if (event.key === 'Enter') {
          // Inside a code block, Enter is a newline and nothing else. Left to the
          // browser it ends the block or splits it in two -- which is how a snippet
          // becomes three snippets -- and a code block that cannot hold a second line is
          // not a code block.
          if (insideBlock(['PRE'])) {
            event.preventDefault()
            insertText('\n')
            serialize()
            rehighlightCode()
            return
          }

          // A browser's default for Enter inside a contenteditable div is a `<div>` or a
          // `<br>` depending on engine and context, which serializes to a hard line break
          // rather than a new paragraph. Asking for a paragraph explicitly is what makes
          // pressing Enter produce the gap the author sees in the rendered page.
          if (!event.shiftKey && !insideBlock(['LI', 'BLOCKQUOTE'])) {
            event.preventDefault()
            exec('insertParagraph')
            serialize()
          }
        }
      }}
      onPaste={(event) => {
        // Pasted HTML from another application arrives with its own fonts, colours and
        // class names, none of which survive the trip to Markdown and all of which look
        // broken in the meantime. Plain text is what the author meant to bring.
        const text = event.clipboardData.getData('text/plain')
        if (!text) return

        event.preventDefault()
        insertText(text)
        serialize()
      }}
    />
  )
}

/** Behind one function, for the day `execCommand` finally has a replacement. */
function exec(command: string, value?: string): void {
  // Absent in jsdom, and absent is not a crash: a command that cannot run leaves the
  // document exactly as it was.
  document.execCommand?.(command, false, value)
}

function insertText(text: string): void {
  exec('insertText', text)
}

function insertHtml(html: string): void {
  exec('insertHTML', html)
}

function applyCommand(command: RichCommand): void {
  switch (command.kind) {
    case 'inline':
      exec(command.command)
      return

    case 'block': {
      // Pressing "Heading 2" on a heading 2 turns it back into a paragraph, so one button
      // is a toggle rather than a one-way trip.
      const current = enclosingTag(['H1', 'H2', 'H3', 'BLOCKQUOTE', 'P'])
      const target = current === command.tag.toUpperCase() ? 'p' : command.tag

      exec('formatBlock', `<${target}>`)
      return
    }

    case 'list':
      exec(command.ordered ? 'insertOrderedList' : 'insertUnorderedList')
      return

    case 'checklist': {
      // A GFM task list is a list item that starts with a checkbox, which is exactly what
      // this inserts; the serializer recognises the shape on the way back out.
      const selection = selectedText()
      insertHtml(`<ul><li><input type="checkbox"> ${escapeHtml(selection) || 'To do'}</li></ul>`)
      return
    }

    case 'code': {
      const selection = selectedText()
      insertHtml(`<code>${escapeHtml(selection) || 'code'}</code>`)
      return
    }

    case 'codeBlock': {
      // Inserted highlighted and numbered, rather than as a plain `<pre>` that only
      // becomes one after the first keystroke. The language goes on the class Turndown
      // reads, so choosing it here is also what puts it after the fence in the saved
      // Markdown.
      const language = resolveLanguage(command.language)
      const attribute = language ? ` data-language="${language}"` : ''

      insertHtml(
        `<pre class="code-block"${attribute}>${codeBlockHtml(selectedText() || 'code', language)}</pre><p><br></p>`,
      )
      return
    }

    case 'table': {
      insertHtml(`${tableHtml(command.size)}<p><br></p>`)
      return
    }

    case 'divider':
      insertHtml('<hr><p><br></p>')
      return

    case 'link': {
      if (selectedText()) exec('createLink', command.href)
      else insertHtml(`<a href="${escapeHtml(command.href)}">${escapeHtml(command.href)}</a>`)
      return
    }

    case 'clear':
      exec('removeFormat')
      exec('formatBlock', '<p>')
  }
}

/**
 * A table of the size asked for, with a header row and the body empty.
 *
 * Each empty cell gets a `<br>`. Without it a browser will not put a caret in the cell --
 * an empty table cell has no position to click into -- and the table is decoration.
 */
function tableHtml({ rows, columns }: TableSize): string {
  const width = Math.max(1, columns)
  const height = Math.max(1, rows)

  const header = Array.from({ length: width }, (_, index) => `<th>Column ${index + 1}</th>`).join('')
  const cells = Array.from({ length: width }, () => '<td><br></td>').join('')
  const body = Array.from({ length: height }, () => `<tr>${cells}</tr>`).join('')

  return `<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`
}

function selection(): Selection | null {
  return typeof window === 'undefined' ? null : window.getSelection()
}

function selectedText(): string {
  return selection()?.toString() ?? ''
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The nearest ancestor of the caret whose tag is one of `tags`. */
function enclosingElement(tags: string[]): Element | null {
  let node: Node | null = selection()?.anchorNode ?? null

  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE && tags.includes((node as Element).tagName)) {
      return node as Element
    }
    node = node.parentNode
  }

  return null
}

function enclosingTag(tags: string[]): string | null {
  return enclosingElement(tags)?.tagName ?? null
}

function insideBlock(tags: string[]): boolean {
  return enclosingElement(tags) !== null
}

/**
 * The mention being typed, read from the DOM.
 *
 * The query is looked for in the text node the caret sits in rather than in the whole
 * document: offsets in a rendered tree do not line up with offsets in the Markdown, and
 * only the local text is needed to answer "is this person typing a name".
 */
function mentionQueryAtCaret(container: HTMLElement | null): MentionQuery | null {
  if (!container) return null

  const current = selection()
  const node = current?.anchorNode
  if (!node || node.nodeType !== Node.TEXT_NODE || !container.contains(node)) return null

  return mentionQueryAt(node.textContent ?? '', current?.anchorOffset ?? 0)
}

/**
 * Swaps the typed `@query` for a chip.
 *
 * Done with the Range API rather than execCommand, because the range to replace is known
 * exactly -- it is the query that was just matched -- and because an anchor inserted this
 * way carries only the attributes put on it.
 */
function replaceQueryWithMention(
  container: HTMLElement | null,
  range: MentionQuery,
  node: { id: string; title: string },
): void {
  const current = selection()
  const anchor = current?.anchorNode
  if (!container || !current || !anchor || !container.contains(anchor)) return

  const target = document.createRange()
  target.setStart(anchor, range.start)
  target.setEnd(anchor, range.end)
  target.deleteContents()

  const link = document.createElement('a')
  link.setAttribute('href', `${MENTION_HREF_PREFIX}${node.id}`)
  link.textContent = `@${node.title}`

  // A trailing space, because a mention is nearly always followed by more sentence and
  // typing immediately after a chip would otherwise extend its label.
  const trailing = document.createTextNode('\u00a0')

  target.insertNode(trailing)
  target.insertNode(link)

  const after = document.createRange()
  after.setStartAfter(trailing)
  after.collapse(true)
  current.removeAllRanges()
  current.addRange(after)
}

/** Where the caret is, counted in characters of rendered text. */
function caretOffset(container: Element): number | null {
  const current = selection()
  if (!current || current.rangeCount === 0) return null

  const range = current.getRangeAt(0)
  if (!container.contains(range.startContainer)) return null

  const measured = document.createRange()
  measured.selectNodeContents(container)
  measured.setEnd(range.startContainer, range.startOffset)

  return measured.toString().length
}

/** Puts the caret back that many characters in, after the document was re-rendered. */
function restoreCaret(container: Element, offset: number): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node = walker.nextNode()

  while (node) {
    const length = node.textContent?.length ?? 0
    if (remaining <= length) break

    remaining -= length
    const next = walker.nextNode()
    if (!next) break
    node = next
  }

  const current = selection()
  if (!current) return

  const range = document.createRange()

  if (node) range.setStart(node, Math.min(remaining, node.textContent?.length ?? 0))
  else range.selectNodeContents(container)

  range.collapse(true)
  current.removeAllRanges()
  current.addRange(range)
}
