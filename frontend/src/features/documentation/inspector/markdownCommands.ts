/**
 * The formatting commands behind the editor's toolbar and its keyboard shortcuts.
 *
 * Pure text in, pure text out. Nothing here touches a DOM node or a CRDT, which is what
 * makes the behaviour that actually annoys people when it is wrong -- what happens to the
 * selection afterwards, whether a second Cmd+B unwraps -- testable without rendering
 * anything.
 *
 * Every command returns a replacement for one range plus where the caret should end up,
 * and the caller applies that however it applies edits: straight into a Y.Text when the
 * page is being co-edited, or into component state when it is a draft. That split is the
 * reason this file exists rather than the commands living in the component.
 */

export interface TextSelection {
  start: number
  end: number
}

export interface TextEdit {
  /** The range to replace, in the value the command was given. */
  start: number
  end: number
  insert: string
  /** Where the selection should sit afterwards, in the resulting value. */
  select: TextSelection
}

export type CommandId =
  | 'bold'
  | 'italic'
  | 'code'
  | 'strike'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'numberedList'
  | 'checklist'
  | 'quote'
  | 'codeBlock'
  | 'link'
  | 'table'
  | 'divider'
  | 'clearFormatting'

/** The shortcuts worth having: the four every editor has trained people to expect. */
export const SHORTCUTS: Record<string, CommandId> = {
  b: 'bold',
  i: 'italic',
  e: 'code',
  k: 'link',
}

const WRAPPERS: Partial<Record<CommandId, string>> = {
  bold: '**',
  italic: '_',
  code: '`',
  strike: '~~',
}

/**
 * Line prefixes. A second press removes the one already there, so every button toggles.
 *
 * Heading levels are three commands rather than one that cycles, because the toolbar
 * shows them as three buttons: a level is a choice, and a control that answers "which
 * heading is this" by making you press until it looks right is a worse control.
 */
const PREFIXES: Partial<Record<CommandId, string[]>> = {
  heading1: ['# '],
  heading2: ['## '],
  heading3: ['### '],
  bulletList: ['- '],
  numberedList: ['1. '],
  checklist: ['- [ ] '],
  quote: ['> '],
}

const PLACEHOLDER: Partial<Record<CommandId, string>> = {
  bold: 'bold text',
  italic: 'italic text',
  code: 'code',
  strike: 'struck through',
  heading1: 'Heading',
  heading2: 'Heading',
  heading3: 'Heading',
  bulletList: 'List item',
  numberedList: 'List item',
  checklist: 'To do',
  quote: 'Quote',
}

export interface TableSize {
  rows: number
  columns: number
}

/** The default a table is offered at, and the size the skeleton is built to. */
export const DEFAULT_TABLE: TableSize = { rows: 3, columns: 3 }

/** What a command cannot work out from the text alone, and has to be told. */
export interface CommandInput {
  table?: TableSize
  href?: string
  /** The fence's language, which is what the reader's page highlights by. */
  language?: string | null
}

export function applyCommand(
  id: CommandId,
  value: string,
  selection: TextSelection,
  input: CommandInput = {},
): TextEdit {
  const wrapper = WRAPPERS[id]
  if (wrapper) return wrap(wrapper, id, value, selection)

  if (PREFIXES[id]) return prefixLines(id, value, selection)

  switch (id) {
    case 'codeBlock':
      return fence(value, selection, input.language)
    case 'link':
      return link(value, selection, input.href)
    case 'table':
      return asBlock(tableSkeleton(input.table ?? DEFAULT_TABLE), value, selection, { caretOffset: 2 })
    case 'divider':
      return asBlock('---', value, selection, {})
    case 'clearFormatting':
      return clear(value, selection)
    default:
      // Every wrapper and prefix command returned above. Reached only if a command id is
      // added to the union without a definition, and doing nothing is better than
      // inserting something arbitrary into the author's page.
      return { start: selection.start, end: selection.end, insert: '', select: selection }
  }
}

/**
 * The Enter behaviour that makes lists feel like lists.
 *
 * Continues the marker on a new line, and clears it when the item was left empty -- which
 * is how every editor ends a list, and without it the only way out of one is to delete the
 * bullet the editor just inserted for you.
 *
 * Returns null when the caret is not in a list, so the caller lets the key through.
 */
export function continueList(value: string, caret: number): TextEdit | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const line = value.slice(lineStart, caret)

  const match = /^(\s*)(?:([-*+])\s(?:\[( |x)\]\s)?|(\d+)\.\s)/.exec(line)
  if (!match) return null

  const [marker] = match
  const [, indent = '', bullet, checked, ordinal] = match

  // An empty item means "I am done with this list".
  if (line.trim() === marker.trim()) {
    return { start: lineStart, end: caret, insert: '', select: { start: lineStart, end: lineStart } }
  }

  const next = ordinal
    ? `${indent}${Number(ordinal) + 1}. `
    : checked !== undefined
      ? `${indent}${bullet} [ ] `
      : `${indent}${bullet} `

  const insert = `\n${next}`
  const caretAfter = caret + insert.length

  return { start: caret, end: caret, insert, select: { start: caretAfter, end: caretAfter } }
}

function wrap(wrapper: string, id: CommandId, value: string, selection: TextSelection): TextEdit {
  const { start, end } = selection
  const selected = value.slice(start, end)

  // Already wrapped, inside the selection: unwrap. Pressing the same button twice should
  // undo, not nest, or emphasis accumulates into asterisk soup.
  if (selected.startsWith(wrapper) && selected.endsWith(wrapper) && selected.length >= wrapper.length * 2) {
    const inner = selected.slice(wrapper.length, selected.length - wrapper.length)

    return { start, end, insert: inner, select: { start, end: start + inner.length } }
  }

  // Already wrapped, just outside the selection: unwrap that instead, so selecting the
  // word rather than the markers still toggles.
  const before = value.slice(Math.max(0, start - wrapper.length), start)
  const after = value.slice(end, end + wrapper.length)

  if (before === wrapper && after === wrapper) {
    return {
      start: start - wrapper.length,
      end: end + wrapper.length,
      insert: selected,
      select: { start: start - wrapper.length, end: start - wrapper.length + selected.length },
    }
  }

  const body = selected || PLACEHOLDER[id] || ''
  const insert = `${wrapper}${body}${wrapper}`
  const bodyStart = start + wrapper.length

  return { start, end, insert, select: { start: bodyStart, end: bodyStart + body.length } }
}

function prefixLines(id: CommandId, value: string, selection: TextSelection): TextEdit {
  const options = PREFIXES[id] ?? []
  const start = value.lastIndexOf('\n', selection.start - 1) + 1
  const end = lineEnd(value, selection.end)
  const lines = value.slice(start, end).split('\n')

  const current = options.findIndex((option) => lines.every((line) => line.startsWith(option)))
  // Cycle to the next form, or to none when the last one is already applied.
  const next = current === -1 ? options[0] : options[current + 1]

  const stripped = lines.map((line) => strip(line, options))
  const rewritten = stripped.map((line) => {
    if (!next) return line
    // An empty line gets the placeholder, so the button produces something visible
    // rather than a bare marker on an empty document.
    return `${next}${line || (lines.length === 1 ? PLACEHOLDER[id] ?? '' : '')}`
  })

  // Numbered lists count. Rewriting every line as "1." and letting Markdown renumber is
  // valid but reads badly in the source, which is also the thing being edited here.
  const insert = (id === 'numberedList' && next
    ? rewritten.map((line, index) => line.replace(/^(\s*)\d+\./, `$1${index + 1}.`))
    : rewritten
  ).join('\n')

  return { start, end, insert, select: { start, end: start + insert.length } }
}

/**
 * Back to plain prose: markers off the front of every line, emphasis out of the text.
 *
 * The button people reach for after pasting something in, and the reason it works on
 * whole lines rather than only the selection is that a heading pasted mid-paragraph is
 * exactly the case they are trying to fix.
 */
function clear(value: string, selection: TextSelection): TextEdit {
  const start = value.lastIndexOf('\n', selection.start - 1) + 1
  const end = lineEnd(value, selection.end)

  const insert = value
    .slice(start, end)
    .split('\n')
    .map((line) => strip(line, []))
    .join('\n')
    // Emphasis, inline code and strikethrough. Link syntax is left alone: a link is
    // content, not formatting, and dropping the target would lose information.
    .replace(/(\*\*|__|~~|[*_`])(.+?)\1/g, '$2')

  return { start, end, insert, select: { start, end: start + insert.length } }
}

function strip(line: string, options: string[]): string {
  for (const option of options) {
    if (line.startsWith(option)) return line.slice(option.length)
  }

  // Also strip a sibling form, so pressing "bullet" on a numbered item converts it
  // instead of producing "- 1. item".
  return line.replace(/^(\s*)(?:[-*+]\s(?:\[[ x]\]\s)?|\d+\.\s|#{1,6}\s|>\s)/, '$1')
}

function fence(value: string, selection: TextSelection, language?: string | null): TextEdit {
  const selected = value.slice(selection.start, selection.end)
  const body = selected || 'code'
  const info = language ?? ''
  const block = `\`\`\`${info}\n${body}\n\`\`\``

  // Past the opening fence and its language, so the caret lands on the first line of code
  // rather than in the syntax.
  return asBlock(block, value, selection, { caretOffset: 4 + info.length, caretLength: body.length })
}

/**
 * A table of the size asked for: a header row, a divider, and the rest empty.
 *
 * Built to a size rather than to a fixed skeleton because the size is the first thing
 * anyone changes, and adding a column to Markdown by hand means editing every row
 * including the divider -- the one edit in Markdown that is genuinely worse than a form.
 */
function tableSkeleton({ rows, columns }: TableSize): string {
  const width = Math.max(1, columns)
  const body = Math.max(1, rows)

  const header = Array.from({ length: width }, (_, index) => `Column ${index + 1}`)
  // Padded to a common width so the skeleton is a readable grid in the source as well as
  // a table in the rendered page. Markdown does not need the alignment; the person
  // filling the cells in does.
  const cell = Math.max(...header.map((label) => label.length))

  const line = (cells: string[]) => `| ${cells.map((value) => value.padEnd(cell)).join(' | ')} |`

  return [
    line(header),
    line(Array.from({ length: width }, () => '-'.repeat(cell))),
    ...Array.from({ length: body }, () => line(Array.from({ length: width }, () => ''))),
  ].join('\n')
}

function link(value: string, selection: TextSelection, href?: string): TextEdit {
  const selected = value.slice(selection.start, selection.end)
  const looksLikeUrl = !href && /^(https?:\/\/|mailto:|\/)/i.test(selected.trim())

  // Selecting a URL and pressing the button should make it the target and leave the caret
  // in the label; selecting a phrase should make it the label and leave the caret in the
  // target. Anything else is a guess the author has to undo.
  const label = looksLikeUrl ? 'label' : selected || 'label'
  const target = looksLikeUrl ? selected.trim() : href || 'https://'
  const insert = `[${label}](${target})`

  // With a target already supplied there is nothing left to type but the label, so the
  // caret goes there instead.
  const inLabel = looksLikeUrl || Boolean(href)
  const caretStart = inLabel ? selection.start + 1 : selection.start + label.length + 3
  const caretLength = inLabel ? label.length : target.length

  return {
    start: selection.start,
    end: selection.end,
    insert,
    select: { start: caretStart, end: caretStart + caretLength },
  }
}

/**
 * Inserts a block on its own lines.
 *
 * The blank-line bookkeeping matters more than it looks: a table or a fence butted against
 * the paragraph above it is not a table or a fence to any Markdown parser, so the button
 * would appear to do nothing.
 */
function asBlock(
  block: string,
  value: string,
  selection: TextSelection,
  { caretOffset = 0, caretLength = 0 }: { caretOffset?: number; caretLength?: number },
): TextEdit {
  const before = value.slice(0, selection.start)
  const after = value.slice(selection.end)

  const lead = before.length === 0 ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trail = after.length === 0 ? '\n' : after.startsWith('\n') ? '' : '\n\n'

  const insert = `${lead}${block}${trail}`
  const caret = selection.start + lead.length + caretOffset

  return {
    start: selection.start,
    end: selection.end,
    insert,
    select: { start: caret, end: caret + caretLength },
  }
}

function lineEnd(value: string, from: number): number {
  const index = value.indexOf('\n', from)

  return index === -1 ? value.length : index
}
