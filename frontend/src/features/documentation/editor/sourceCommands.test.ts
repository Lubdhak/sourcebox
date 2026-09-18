import { describe, expect, it } from 'vitest'
import {
  continueLine,
  indentLines,
  type TextSelection,
} from '@/features/documentation/editor/sourceCommands'

/**
 * The two keys the Markdown surface needs, tested through their effect on the text.
 *
 * Each expectation reads as "this document, this caret, this key, that document", which is
 * the contract that matters -- and it is testable without rendering anything, which is the
 * reason these are pure functions rather than handlers.
 */
function indent(value: string, selection: TextSelection, outwards = false): string {
  const edit = indentLines(value, selection, outwards)

  return value.slice(0, edit.start) + edit.insert + value.slice(edit.end)
}

describe('indentLines', () => {
  it('indents the line the caret is on, and keeps the caret in the words', () => {
    const edit = indentLines('- first\n- second', { start: 9, end: 9 })

    expect('- first\n- second'.slice(0, edit.start) + edit.insert).toBe('- first\n  - second')
    // Two characters further along, because that is where the character it was after went.
    expect(edit.select).toEqual({ start: 11, end: 11 })
  })

  it('indents every line a selection touches, and keeps them selected', () => {
    const edit = indentLines('- one\n- two\n- three', { start: 2, end: 9 })

    expect(edit.insert).toBe('  - one\n  - two')
    expect(edit.select).toEqual({ start: 0, end: 15 })
  })

  it('takes one indent off on the way back, and stops at the margin', () => {
    expect(indent('    deep', { start: 8, end: 8 }, true)).toBe('  deep')
    expect(indent('  deep', { start: 6, end: 6 }, true)).toBe('deep')
    expect(indent('deep', { start: 4, end: 4 }, true)).toBe('deep')
  })
})

describe('continueLine', () => {
  it('continues a bullet, a number and a checkbox', () => {
    expect(continueLine('- capture', 9)?.insert).toBe('\n- ')
    expect(continueLine('1. capture', 10)?.insert).toBe('\n2. ')
    // A new item starts unchecked however the one above it ended.
    expect(continueLine('- [x] capture', 13)?.insert).toBe('\n- [ ] ')
  })

  it('ends the list when the item was left empty', () => {
    const value = '- capture\n- '
    const edit = continueLine(value, value.length)

    expect(value.slice(0, edit!.start) + edit!.insert).toBe('- capture\n')
  })

  it('keeps the indentation of a line that is not a list', () => {
    // Which is what makes a fenced block typeable here: without it every line of a nested
    // structure starts at the margin and has to be pushed back by hand.
    expect(continueLine('```json\n{\n  "a": 1', 18)?.insert).toBe('\n  ')
    expect(continueLine('    deep', 8)?.insert).toBe('\n    ')
  })

  it('lets the key through on an ordinary paragraph', () => {
    expect(continueLine('a paragraph', 11)).toBeNull()
  })
})
