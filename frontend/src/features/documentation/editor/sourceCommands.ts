/**
 * The two keys that make the Markdown surface bearable to type in.
 *
 * That surface is a plain textarea over the same shared text -- the escape hatch for
 * pasting a document in, fixing something by hand, or seeing exactly what will be saved.
 * It deliberately has no formatting commands of its own: it shows the source, and the
 * source is edited by typing. What it does need is the two behaviours a text editor has
 * and a textarea does not.
 *
 * Pure text in, pure text out. Nothing here touches a DOM node or a CRDT, which is what
 * makes the behaviour that annoys people when it is wrong -- where the caret ends up --
 * testable without rendering anything.
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

/** One indent. Two spaces, the narrowest nesting every Markdown parser agrees on. */
export const INDENT = '  '

/**
 * Tab: the lines under the selection in or out by one indent.
 *
 * Whole lines rather than the caret's position, because indenting is what nesting a list
 * item and lining up a block of code both are, and both are line-shaped. A collapsed
 * caret keeps its place in the words it was in rather than jumping to the margin.
 *
 * Tab has to mean this here because left to the browser it moves focus to the next
 * control -- so the one key everybody presses to indent is the one that throws away where
 * they were. Escape is still the way out of the editor, which keeps that from being a trap.
 */
export function indentLines(value: string, selection: TextSelection, outwards = false): TextEdit {
  const start = value.lastIndexOf('\n', selection.start - 1) + 1
  const end = lineEnd(value, selection.end)
  const lines = value.slice(start, end).split('\n')

  const rewritten = lines.map((line) =>
    outwards ? line.replace(new RegExp(`^ {1,${INDENT.length}}`), '') : `${INDENT}${line}`,
  )

  const insert = rewritten.join('\n')
  const shift = (rewritten[0]?.length ?? 0) - (lines[0]?.length ?? 0)
  const caret = Math.max(start, selection.start + shift)

  return {
    start,
    end,
    insert,
    // A selection that spanned lines keeps spanning them, so a second Tab indents the
    // same block again instead of one line of it.
    select:
      selection.start === selection.end
        ? { start: caret, end: caret }
        : { start, end: start + insert.length },
  }
}

/**
 * Enter: continues whatever the line was doing.
 *
 * For a list, the marker -- continued on the new line, and cleared when the item was left
 * empty, which is how every editor ends a list. For any other indented line, the
 * indentation, which is what makes a fenced block typeable here.
 *
 * Returns null when the line was doing neither, so the caller lets the key through.
 */
export function continueLine(value: string, caret: number): TextEdit | null {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1
  const line = value.slice(lineStart, caret)

  const match = /^(\s*)(?:([-*+])\s(?:\[( |x)\]\s)?|(\d+)\.\s)/.exec(line)
  if (!match) return keepIndent(line, caret)

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

  return at(caret, `\n${next}`)
}

function keepIndent(line: string, caret: number): TextEdit | null {
  const indent = /^[\t ]+/.exec(line)?.[0]

  return indent ? at(caret, `\n${indent}`) : null
}

/** An insertion at the caret, with the caret after it. */
function at(caret: number, insert: string): TextEdit {
  const after = caret + insert.length

  return { start: caret, end: caret, insert, select: { start: after, end: after } }
}

function lineEnd(value: string, from: number): number {
  const index = value.indexOf('\n', from)

  return index === -1 ? value.length : index
}
