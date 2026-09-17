import { describe, expect, it } from 'vitest'
import {
  applyCommand,
  continueList,
  type CommandId,
  type CommandInput,
} from '@/features/documentation/inspector/markdownCommands'

/**
 * The commands are tested through their effect on the text, not their return shape.
 *
 * `run` applies the edit the way the editor does, so each expectation reads as "this
 * document, this selection, this button, that document" -- which is the contract that
 * matters and the one a refactor of the edit representation must not break.
 */
function run(id: CommandId, value: string, start = 0, end = start, input: CommandInput = {}) {
  const edit = applyCommand(id, value, { start, end }, input)
  const next = value.slice(0, edit.start) + edit.insert + value.slice(edit.end)

  return { next, selected: next.slice(edit.select.start, edit.select.end), select: edit.select }
}

describe('applyCommand', () => {
  it('wraps the selection and leaves it selected, so the next keystroke replaces it', () => {
    const { next, selected } = run('bold', 'capture and refunds', 0, 7)

    expect(next).toBe('**capture** and refunds')
    expect(selected).toBe('capture')
  })

  it('unwraps when the selection is already emphasised, rather than nesting', () => {
    expect(run('bold', '**capture** and refunds', 0, 11).next).toBe('capture and refunds')
  })

  it('unwraps when the markers sit just outside the selection', () => {
    // Selecting the word rather than the asterisks is what people actually do.
    expect(run('italic', '_capture_ and refunds', 1, 8).next).toBe('capture and refunds')
  })

  it('inserts a named placeholder when nothing is selected', () => {
    const { next, selected } = run('code', '')

    expect(next).toBe('`code`')
    expect(selected).toBe('code')
  })

  it('sets a heading level, and the same button again clears it', () => {
    const second = run('heading2', 'Overview').next
    expect(second).toBe('## Overview')

    // A different level replaces rather than stacks, so ## never becomes ### ##.
    expect(run('heading3', second).next).toBe('### Overview')

    expect(run('heading2', second).next).toBe('Overview')
  })

  it('prefixes every line of the selection, not just the first', () => {
    const value = 'capture\nrefund\nchargeback'

    expect(run('bulletList', value, 0, value.length).next).toBe('- capture\n- refund\n- chargeback')
  })

  it('converts between list kinds instead of stacking their markers', () => {
    const value = '- capture\n- refund'

    expect(run('numberedList', value, 0, value.length).next).toBe('1. capture\n2. refund')
  })

  it('makes a selected URL the target and a selected phrase the label', () => {
    const fromUrl = run('link', 'https://runbook.internal', 0, 24)
    expect(fromUrl.next).toBe('[label](https://runbook.internal)')
    expect(fromUrl.selected).toBe('label')

    const fromText = run('link', 'the runbook', 4, 11)
    expect(fromText.next).toBe('the [runbook](https://)')
    expect(fromText.selected).toBe('https://')
  })

  it('builds a table to the size it was given, as a grid in the source too', () => {
    const { next } = run('table', '', 0, 0, { table: { rows: 2, columns: 3 } })

    expect(next).toBe(
      [
        '| Column 1 | Column 2 | Column 3 |',
        '| -------- | -------- | -------- |',
        '|          |          |          |',
        '|          |          |          |',
        '',
      ].join('\n'),
    )
  })

  it('separates an inserted block from the paragraph above it', () => {
    // Without the blank line this is not a table to any Markdown parser, and the button
    // would appear to do nothing.
    const { next } = run('table', 'Capture happens first.', 22, 22, { table: { rows: 1, columns: 2 } })

    expect(next).toBe(
      'Capture happens first.\n\n| Column 1 | Column 2 |\n| -------- | -------- |\n|          |          |\n',
    )
  })

  it('takes a link target it was handed, and leaves the caret in the label', () => {
    const { next, selected } = run('link', 'see ', 4, 4, { href: 'https://runbook.internal' })

    expect(next).toBe('see [label](https://runbook.internal)')
    expect(selected).toBe('label')
  })

  it('strips formatting back to prose, keeping links, which are content', () => {
    const value = '## **Capture** and `refunds`, see [runbook](https://x)'

    expect(run('clearFormatting', value, 0, value.length).next).toBe(
      'Capture and refunds, see [runbook](https://x)',
    )
  })
})

describe('continueList', () => {
  it('carries the marker onto the next line', () => {
    const value = '- capture'
    const edit = continueList(value, value.length)

    expect(edit?.insert).toBe('\n- ')
  })

  it('counts, so a numbered list stays numbered', () => {
    const value = '1. capture\n2. refund'
    const edit = continueList(value, value.length)

    expect(edit?.insert).toBe('\n3. ')
  })

  it('keeps a task list a task list, unchecked', () => {
    const value = '- [x] capture'

    expect(continueList(value, value.length)?.insert).toBe('\n- [ ] ')
  })

  it('ends the list when the item was left empty', () => {
    const value = '- capture\n- '
    const edit = continueList(value, value.length)

    // The marker the editor inserted is removed rather than a second empty one added,
    // which is the only way out of a list that does not involve backspacing.
    expect(edit).toEqual({ start: 10, end: 12, insert: '', select: { start: 10, end: 10 } })
  })

  it('does nothing outside a list, so Enter stays Enter', () => {
    expect(continueList('a paragraph', 11)).toBeNull()
  })
})
