import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { blocksToMarkdown, isSingleMarkdownPage } from '@/features/documentation/inspector/pageMarkdown'
import {
  PAGE_KEY,
  type CollaborativeDocument,
} from '@/features/documentation/collaboration/useCollaborativeDocument'
import type { ContentBlock } from '@/types'

/**
 * One node's documentation as a single editable body, and the seam to the database.
 *
 * ### What changed (Yjs CRDT architecture)
 *
 * The previous implementation stored Markdown in a `Y.Text` and treated that text as
 * the collaborative source of truth. Every keystroke serialised the entire Plate document
 * to Markdown and wrote a character-level diff into the Y.Text. Every remote update
 * deserialised the Markdown string back into a Plate value and called `setValue`, which
 * replaced the whole document and destroyed the local cursor.
 *
 * The new architecture:
 *
 *   Y.Doc
 *     └── Y.Array('content')   ← Plate/Slate tree, owned by @platejs/yjs
 *          ↕ direct Yjs ops (no serialisation in the hot path)
 *   Plate editor
 *          ↓ serialize (debounced, on change)
 *   Markdown snapshot
 *          ↓ debounced save
 *   Database (content_blocks)
 *
 * This hook is now responsible only for:
 *   1. Providing `stored` Markdown (from the DB) as the seeding source.
 *   2. Debouncing persistence: the editor calls `onEditorChange` whenever the
 *      Markdown snapshot changes, and this hook saves it to the DB.
 *   3. Exposing `value` (the latest known Markdown) for the reader view and
 *      for `flush()` on Done.
 *
 * The Y.Text('page') and character-level diffing are gone. The editor itself
 * drives all Yjs operations through the @platejs/yjs binding.
 */

/** Typing pauses are common; saves should follow the thought, not the keystroke. */
const COMMIT_DEBOUNCE_MS = 1_200

export interface PageBody {
  /**
   * The collaborative document for this node.
   *
   * Exposed so PageEditor can pass it to usePlateYjsEditor, which binds the
   * Plate editor to the Y.Doc via @platejs/yjs.
   */
  document: CollaborativeDocument
  /**
   * The latest known Markdown for this page.
   *
   * Initialised from the database snapshot (`stored`). Updated every time
   * the rich editor reports a change via `onEditorChange`. Used by:
   *   - The reader view (PageView) when editing is not active.
   *   - `flush()` to determine what to write on Done.
   */
  value: string
  /**
   * The Markdown from the database, derived from content_blocks.
   *
   * The Plate editor uses this to seed the Y.Doc the first time the node is
   * opened (via usePlateYjsEditor). After that the Y.Doc is authoritative and
   * `stored` is used only for comparison in `flush()`.
   */
  stored: string
  synced: boolean
  saving: boolean
  /** Other people with this page open. */
  editorNames: string[]
  /**
   * Set when saving will change how the page is stored, so the author is told
   * before it happens rather than noticing afterwards.
   */
  conversionNotice: string | null
  /**
   * Called by the Plate editor whenever its Markdown snapshot changes.
   *
   * This is the only persistence trigger. The editor serialises its state to
   * Markdown (debounced) and reports it here; this hook debounces the DB write
   * on top of that. Double-debouncing keeps the DB quiet while the author is
   * mid-sentence and the editor is mid-snapshot.
   */
  onEditorChange: (markdown: string) => void
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
  const { synced, editors, announceEditing } = document

  /*
    The Markdown snapshot derived from the database rows.

    This is the seeding source for the Y.Doc (see usePlateYjsEditor) and the
    baseline for deciding whether `flush()` needs to write anything.
  */
  const stored = useMemo(() => blocksToMarkdown(blocks), [blocks])

  /*
    The latest Markdown the editor has reported.

    Starts as `stored` so that the reader view shows something sensible before
    the editor is opened, and before the first onEditorChange fires.
  */
  const [liveValue, setLiveValue] = useState(stored)

  /*
    A ref that is always current, even within the same render cycle.

    flush() reads from this rather than from state, so that calling
    onEditorChange(x) and flush() in the same synchronous frame (as the Done
    button does when exiting Markdown mode) sees the correct value.
  */
  const liveRef = useRef(stored)

  /*
    Keep liveValue in sync with stored when the node changes (e.g. the user
    navigates to a different node). Without this, the stale liveValue from the
    previous node would appear briefly in the reader view.
  */
  useEffect(() => {
    liveRef.current = stored
    setLiveValue(stored)
  }, [stored])

  const commitTimer = useRef<number | null>(null)
  const save = useRef(onSave)
  save.current = onSave

  const onEditorChange = useCallback((markdown: string) => {
    liveRef.current = markdown
    setLiveValue(markdown)

    /*
      Debounce the DB write. The editor already debounces its own Markdown
      snapshot generation; this is the second gate — it keeps the DB quiet
      if the user switches between Markdown and rich mode rapidly.
    */
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null
      void save.current(markdown)
    }, COMMIT_DEBOUNCE_MS)
  }, [])

  /*
    Clean up the pending timer when the component unmounts (e.g. panel closes).
    The flush path handles the "Done" case; this covers a hard unmount.
  */
  useEffect(
    () => () => {
      if (commitTimer.current !== null) {
        window.clearTimeout(commitTimer.current)
        commitTimer.current = null
      }
    },
    [],
  )

  const flush = useCallback(async () => {
    if (commitTimer.current !== null) {
      window.clearTimeout(commitTimer.current)
      commitTimer.current = null
    }

    /*
      Use the ref so we always see the value from the current frame, even if
      onEditorChange was just called in the same synchronous sequence (e.g. the
      Done button in Markdown mode: exitMarkdownMode → onEditorChange → flush).
    */
    const current = liveRef.current

    /*
      Nothing typed and nothing to convert: a "Done" click must not write a row
      when the page has not changed and is already in the single-Markdown-block
      format this editor produces.
    */
    if (current === stored && isSingleMarkdownPage(blocks)) return true

    return save.current(current)
  }, [blocks, stored])

  const editorNames = useMemo(
    () => editors.filter((peer) => peer.editing === PAGE_KEY).map((peer) => peer.actor.name),
    [editors],
  )

  return {
    document,
    value: liveValue,
    stored,
    synced,
    saving,
    editorNames,
    conversionNotice: isSingleMarkdownPage(blocks)
      ? null
      : 'Tables and snippets on this page are saved as Markdown.',
    onEditorChange,
    announceEditing: useCallback(
      (active: boolean) => announceEditing(active ? PAGE_KEY : null),
      [announceEditing],
    ),
    flush,
  }
}
