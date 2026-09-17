import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import {
  PAGE_KEY,
  pageText,
  type CollaborativeDocument,
} from '@/features/documentation/collaboration/useCollaborativeDocument'
import type { TextEdit } from '@/features/documentation/inspector/markdownCommands'
import { blocksToMarkdown, isSingleMarkdownPage } from '@/features/documentation/inspector/pageMarkdown'
import { diffEdit } from '@/features/documentation/inspector/textDiff'
import { SESSION_ID } from '@/lib/cable'
import type { ContentBlock } from '@/types'

/**
 * One node's documentation as a single editable body, and the seam to the database.
 *
 * Two problems live here, and both are about a CRDT sitting in front of a row.
 *
 * The first is seeding. The text exists in `content_blocks` long before anyone opens the
 * page, so the shared document starts empty and has to be filled from storage exactly
 * once. If every client that opens the page inserted the stored text, the page would
 * appear once per reader. So the clients elect one: each writes its session id into a
 * shared map, only if the key is absent. Concurrent writes to a Yjs map converge on a
 * single value, so after a short settle every participant reads the same winner and
 * exactly one of them recognises itself and inserts.
 *
 * The second is persistence. The CRDT log is the live state, but it is not what search
 * indexes, what renders for a reader who never opens the editor, or what survives
 * compaction of a document nobody has touched in months. So the text is written back --
 * debounced, and only by whoever is typing, because the typist is the one client that can
 * be identified without coordination. Fifty participants must not issue fifty identical
 * mutations for one keystroke.
 *
 * There is one path now, not two. Every editor's changes go straight into the shared
 * document, which is what removing the review queue bought: an edit is an edit, and the
 * only question left is who is allowed to make one.
 */

/** Long enough for concurrent joiners to converge on one seeder, short enough not to feel like loading. */
const SEED_SETTLE_MS = 400

/** Typing pauses are common; saves should follow the thought, not the keystroke. */
const COMMIT_DEBOUNCE_MS = 1_200

export interface PageBody {
  /** The document, as Markdown. */
  value: string
  /** The shared text, for a surface that binds to it directly. */
  text: Y.Text
  synced: boolean
  saving: boolean
  /** Other people with this page open. */
  editorNames: string[]
  /**
   * Set when saving will change how the page is stored, so the author is told before it
   * happens rather than noticing afterwards.
   */
  conversionNotice: string | null
  /** A positioned edit, from a toolbar command against the Markdown source. */
  applyEdit: (edit: TextEdit) => void
  /** A whole new document, from a surface that can only report its full value. */
  write: (markdown: string) => void
  announceEditing: (active: boolean) => void
  /** Commits now instead of on the debounce, and resolves false if the save failed. */
  flush: () => Promise<boolean>
}

export function usePageBody({
  document,
  blocks,
  saving,
  onSave,
}: {
  document: CollaborativeDocument
  blocks: ContentBlock[]
  saving: boolean
  onSave: (markdown: string) => Promise<boolean>
}): PageBody {
  const { doc, synced, editors, announceEditing } = document

  const stored = useMemo(() => blocksToMarkdown(blocks), [blocks])
  const text = useMemo(() => pageText(doc), [doc])

  const [shared, setShared] = useState('')
  const commitTimer = useRef<number | null>(null)
  const save = useRef(onSave)
  save.current = onSave

  // Seed once, by election. See the note at the top of the file.
  useEffect(() => {
    if (!synced || !stored) return

    const seeders = doc.getMap<string>('seededBy')
    if (!seeders.has(PAGE_KEY)) seeders.set(PAGE_KEY, SESSION_ID)

    const timer = window.setTimeout(() => {
      if (seeders.get(PAGE_KEY) !== SESSION_ID) return
      // Somebody -- another client, or this one typing during the settle -- got there
      // first. Inserting now would say the page twice.
      if (text.length > 0) return

      text.insert(0, stored)
    }, SEED_SETTLE_MS)

    return () => window.clearTimeout(timer)
  }, [doc, stored, synced, text])

  // Mirror the shared text into state, and persist what the typist types.
  // `transaction.local` is the whole test for the second half: a remote change is already
  // being saved by the person who made it.
  useEffect(() => {
    const observer = (_event: Y.YTextEvent, transaction: Y.Transaction) => {
      const next = text.toString()
      setShared(next)

      if (!transaction.local) return

      if (commitTimer.current !== null) window.clearTimeout(commitTimer.current)
      commitTimer.current = window.setTimeout(() => {
        commitTimer.current = null
        void save.current(next)
      }, COMMIT_DEBOUNCE_MS)
    }

    text.observe(observer)
    setShared(text.toString())

    return () => {
      text.unobserve(observer)
      if (commitTimer.current !== null) {
        window.clearTimeout(commitTimer.current)
        commitTimer.current = null
      }
    }
  }, [text])

  // Storage is the fallback, not the source: the shared text is authoritative the moment
  // it has anything in it. The window this covers is the one between connecting and the
  // seed landing, where showing an empty page would look like data loss -- and saving one
  // would be data loss, which is why `flush` reads this rather than the text directly.
  const value = shared.length > 0 || !stored ? shared : stored

  const applyEdit = useCallback(
    (edit: TextEdit) => {
      // One transaction, so a wrap -- delete the selection, insert the wrapped version --
      // reaches collaborators as a single change rather than as a flicker of two.
      text.doc?.transact(() => {
        if (edit.end > edit.start) text.delete(edit.start, edit.end - edit.start)
        if (edit.insert) text.insert(edit.start, edit.insert)
      })
    },
    [text],
  )

  // The rich surface can only say "the document is now this". Diffing before writing is
  // what keeps that from arriving as a wholesale rewrite that conflicts with every
  // concurrent edit; see `diffEdit`.
  const write = useCallback(
    (markdown: string) => {
      const edit = diffEdit(text.toString(), markdown)
      if (edit) applyEdit(edit)
    },
    [applyEdit, text],
  )

  const flush = useCallback(async () => {
    if (commitTimer.current !== null) {
      window.clearTimeout(commitTimer.current)
      commitTimer.current = null
    }

    // Nothing typed and nothing to convert: a "Done" click should not write a row.
    if (value === stored && isSingleMarkdownPage(blocks)) return true

    return save.current(value)
  }, [blocks, stored, value])

  const editorNames = useMemo(
    () => editors.filter((peer) => peer.editing === PAGE_KEY).map((peer) => peer.actor.name),
    [editors],
  )

  return {
    value,
    text,
    synced,
    saving,
    editorNames,
    conversionNotice: isSingleMarkdownPage(blocks)
      ? null
      : 'Tables and snippets on this page are saved as Markdown.',
    applyEdit,
    write,
    announceEditing: useCallback(
      (active: boolean) => announceEditing(active ? PAGE_KEY : null),
      [announceEditing],
    ),
    flush,
  }
}
