import type { TextEdit } from '@/features/documentation/editor/sourceCommands'

/**
 * The smallest edit that turns one string into another.
 *
 * This is what makes whole-document writes safe to put into a CRDT. A surface that
 * reports its entire new value on every change -- a controlled textarea, or a
 * contenteditable serialized back to Markdown -- would otherwise be applied as "delete
 * everything, insert this", and the CRDT would faithfully merge two complete rewrites
 * into nonsense. Comparing the old and new strings and applying only the range that
 * actually changed is what turns typing into the small, positioned operations a CRDT is
 * designed to merge.
 *
 * A common prefix and suffix, nothing cleverer. It is exact for the way people edit --
 * one contiguous change at a time -- and for anything else it is still correct, just
 * wider than the minimum.
 */
export function diffEdit(previous: string, next: string): TextEdit | null {
  if (previous === next) return null

  let start = 0
  const max = Math.min(previous.length, next.length)
  while (start < max && previous[start] === next[start]) start += 1

  let end = 0
  while (
    end < max - start &&
    previous[previous.length - 1 - end] === next[next.length - 1 - end]
  ) {
    end += 1
  }

  const insert = next.slice(start, next.length - end)
  const caret = start + insert.length

  return {
    start,
    end: previous.length - end,
    insert,
    select: { start: caret, end: caret },
  }
}
