import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { diffEdit } from '@/features/documentation/inspector/textDiff'

/**
 * A textarea bound to a Y.Text, so several people can type into it at once.
 *
 * The binding is a diff rather than a replace, and that is the whole substance of this
 * component: a controlled textarea reports its entire new value on every keystroke, and
 * only the range that actually changed may be written into the shared text. `diffEdit`
 * has the reasoning.
 *
 * The caret is then adjusted by hand. React does not know the value changed because a
 * collaborator typed, and a naive re-render puts the cursor at the end of the text --
 * which, mid-sentence, is worse than not seeing their edit at all.
 */
export function CollaborativeTextArea({
  text,
  synced,
  id,
  rows = 6,
  placeholder,
  disabled,
  className,
  ariaLabel,
  textareaRef,
  onFocus,
  onBlur,
  onKeyDown,
  onSelect,
  onChangeText,
}: {
  text: Y.Text
  synced: boolean
  id?: string
  rows?: number
  placeholder?: string
  disabled?: boolean
  className?: string
  ariaLabel?: string
  /**
   * Handed out so the surrounding editor can read the caret and apply toolbar commands.
   *
   * The element is shared rather than the behaviour being duplicated: formatting and
   * mention insertion are edits to the *shared text*, which this component already owns
   * the binding for, but where to apply them is a question only the DOM selection can
   * answer.
   */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>
  onFocus?: () => void
  onBlur?: () => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onSelect?: () => void
  /** Fired for every converged value, local or remote. Debounce persistence downstream. */
  onChangeText?: (value: string) => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = useState(() => text.toString())

  // Where the caret should land after a remote change, computed while we still know what
  // changed and applied after React has written the new value into the DOM.
  const pendingCaret = useRef<number | null>(null)
  const notify = useRef(onChangeText)
  notify.current = onChangeText

  useEffect(() => {
    const observer = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      const next = text.toString()

      if (transaction.local) {
        setValue(next)
        notify.current?.(next)
        return
      }

      // Remote: work out how far ahead of the caret the change landed. An insertion
      // before the caret shifts it; one after it does not.
      const element = ref.current
      const caret = element?.selectionStart ?? null

      if (caret !== null && document.activeElement === element) {
        let position = 0
        let shift = 0

        for (const delta of event.delta) {
          if (delta.retain) position += delta.retain
          else if (typeof delta.insert === 'string') {
            if (position <= caret) shift += delta.insert.length
            position += delta.insert.length
          } else if (delta.delete) {
            if (position < caret) shift -= Math.min(delta.delete, caret - position)
          }
        }

        pendingCaret.current = Math.max(0, caret + shift)
      }

      setValue(next)
      notify.current?.(next)
    }

    text.observe(observer)
    setValue(text.toString())

    return () => text.unobserve(observer)
  }, [text])

  useLayoutEffect(() => {
    if (pendingCaret.current === null || !ref.current) return

    ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [value])

  const handleChange = useCallback(
    (next: string) => {
      const edit = diffEdit(text.toString(), next)
      if (!edit) return

      text.doc?.transact(() => {
        if (edit.end > edit.start) text.delete(edit.start, edit.end - edit.start)
        if (edit.insert) text.insert(edit.start, edit.insert)
      })
    },
    [text],
  )

  return (
    <textarea
      ref={(element) => {
        ref.current = element
        if (textareaRef) textareaRef.current = element
      }}
      id={id}
      rows={rows}
      value={value}
      placeholder={synced ? placeholder : 'Loading…'}
      disabled={disabled || !synced}
      aria-label={ariaLabel}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onSelect={onSelect}
      onChange={(event) => handleChange(event.target.value)}
      className={
        className ??
        'w-full rounded-sm border border-input bg-transparent px-2 py-1.5 font-mono text-xs focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60'
      }
    />
  )
}
