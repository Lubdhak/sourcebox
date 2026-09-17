import { describe, expect, it } from 'vitest'
import { diffEdit } from '@/features/documentation/inspector/textDiff'

/**
 * What matters here is the *size* of the edit, not just its result.
 *
 * Every one of these could be satisfied by replacing the whole document, and that is
 * exactly the answer a CRDT cannot merge: two people rewriting everything at once
 * converge on nonsense. So the expectations are on the range.
 */
describe('diffEdit', () => {
  it('reports nothing for an unchanged document', () => {
    expect(diffEdit('capture', 'capture')).toBeNull()
  })

  it('reports one character for one keystroke, wherever it happened', () => {
    const edit = diffEdit('Handles capture.', 'Handles captures.')

    expect(edit).toEqual({ start: 15, end: 15, insert: 's', select: { start: 16, end: 16 } })
  })

  it('reports a deletion as an empty insert over the range removed', () => {
    const edit = diffEdit('Handles capture.', 'Handles.')

    expect(edit).toEqual({ start: 7, end: 15, insert: '', select: { start: 7, end: 7 } })
  })

  it('touches only the paragraph that changed in a long document', () => {
    const before = 'one\n\ntwo\n\nthree'
    const edit = diffEdit(before, 'one\n\ntwo!\n\nthree')

    expect(edit?.start).toBe(8)
    expect(edit?.end).toBe(8)
    expect(edit?.insert).toBe('!')
  })

  it('leaves the caret after what was inserted', () => {
    const edit = diffEdit('see ', 'see the runbook')

    expect(edit?.select).toEqual({ start: 15, end: 15 })
  })

  it('handles an empty document in either direction', () => {
    expect(diffEdit('', 'a')).toEqual({ start: 0, end: 0, insert: 'a', select: { start: 1, end: 1 } })
    expect(diffEdit('a', '')).toEqual({ start: 0, end: 1, insert: '', select: { start: 0, end: 0 } })
  })
})
