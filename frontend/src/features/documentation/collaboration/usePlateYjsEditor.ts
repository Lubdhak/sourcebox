import { MarkdownPlugin } from '@platejs/markdown'
import { YjsPlugin } from '@platejs/yjs/react'
import * as Y from 'yjs'
import { usePlateEditor } from 'platejs/react'
import { useEffect, useRef } from 'react'
import { DOCUMENTATION_PLUGINS } from '@/features/documentation/editor/plugins'
import { SESSION_ID } from '@/lib/cable'
import type { CollaborativeDocument } from '@/features/documentation/collaboration/useCollaborativeDocument'

/**
 * The key inside the Y.Doc that holds the Plate/Slate document tree.
 *
 * @platejs/yjs uses this key to find or create the shared Y.Array. Keep it
 * consistent with whatever @platejs/yjs defaults to. If that ever changes,
 * update this constant and re-seed existing documents.
 *
 * This is NOT the same key that used to hold the Markdown text (`'page'`).
 * The Markdown text is now a derived, serialized snapshot — not the CRDT.
 */
export const PLATE_CONTENT_KEY = 'content'

/**
 * How long to wait for concurrent joiners to converge on one seeder before
 * the winner actually writes. Long enough for a late joiner to recognise it
 * lost the election; short enough not to feel like loading.
 */
const SEED_SETTLE_MS = 400

/**
 * A Plate editor bound to the collaborative Y.Doc via @platejs/yjs.
 *
 * The document model is the Plate/Slate tree, stored in a Y.Array inside the
 * Y.Doc. Markdown is NOT the CRDT — it is derived from the Plate tree on
 * demand and written to the database as a periodic snapshot.
 *
 * Architecture:
 *
 *   Y.Doc
 *     └── Y.Array(PLATE_CONTENT_KEY)   ← canonical collaborative state
 *          ↕ @platejs/yjs
 *   Plate / Slate document model        ← local rendering model
 *          ↓ serialize (debounced)
 *   Markdown                            ← persistence / export / LLM
 *
 * Transport is handled separately by useCollaborativeDocument, which sends and
 * receives binary Yjs updates over Action Cable. The server never decodes
 * those bytes — it just relays and logs them. Switching from Y.Text(Markdown)
 * to Y.Array(PlateNodes) requires no server changes.
 *
 * Seeding — moving stored Markdown into the Y.Doc for the first time — uses the
 * same election mechanism the old Y.Text approach used. The first client to win
 * the map key is the only one that writes; concurrent joiners yield.
 */
export function usePlateYjsEditor({
  document,
  stored,
}: {
  document: CollaborativeDocument
  /**
   * The Markdown read from the database (derived from content_blocks).
   *
   * Used only for seeding an empty Y.Doc on first open. It is never written
   * back to the CRDT on subsequent opens — the Y.Doc is authoritative the
   * moment it has content.
   */
  stored: string
}) {
  const { doc, synced } = document

  const editor = usePlateEditor({
    plugins: [
      ...DOCUMENTATION_PLUGINS,
      /*
        The Yjs binding.

        YjsPlugin wraps the editor with withYjs (from @slate-yjs/core internally),
        attaching the Y.Array at PLATE_CONTENT_KEY to the Slate children array.
        After this:
          - Every Slate operation is mirrored to the Y.Array as Yjs operations.
          - Every remote Yjs update is applied as precise Slate operations, not a
            full document replacement.

        The transport (doc.on('update') / Y.applyUpdate) lives in
        useCollaborativeDocument and is entirely unaware of what is stored inside
        the Y.Doc. Switching from Markdown text to Plate nodes requires no change
        to the transport layer.
      */
      YjsPlugin.configure({
        options: {
          ydoc: doc,
        },
      }),
    ],
    /*
      Initialise from stored Markdown so the editor is never blank when opened.

      Without an initial value the editor starts empty and waits for the seeding
      election (network round-trip + 400 ms settle) before showing any content.
      The user sees a blank page and cannot interact with anything.

      With an initial value the editor renders content immediately. When the real
      @platejs/yjs is installed, the Y.Doc state overwrites this on connect if
      the collaborative document is newer. If the Y.Doc is still empty (first
      open), the seeding below writes the same content into it via Yjs ops.
    */
    value: stored
      ? (instance) => instance.getApi(MarkdownPlugin).markdown.deserialize(stored)
      : undefined,
    shouldNormalizeEditor: true,
  })

  // Guard so the effect fires at most once per doc lifecycle.
  const seeded = useRef(false)

  useEffect(() => {
    if (!synced || seeded.current) return

    /*
      The shared root that @platejs/yjs manages. If it already has content
      from a previous collaborative session, nothing to seed.

      Note: @platejs/yjs uses Y.Array internally (via @slate-yjs/core). We
      peek at length to decide whether seeding is needed without modifying the
      Y.Doc ourselves.
    */
    const sharedRoot = doc.get(PLATE_CONTENT_KEY, Y.Array)

    if (sharedRoot.length > 0) {
      seeded.current = true
      return
    }

    if (!stored) {
      // Nothing in storage and nothing in the Y.Doc — brand new document.
      seeded.current = true
      return
    }

    /*
      Election: the first client to set the key seeds; all others yield.

      Yjs maps converge on a single value for concurrent sets, so after the
      settle period every participant reads the same winner. The loser checks
      the key against its own session id and no-ops.
    */
    const seeders = doc.getMap<string>('seededBy')
    if (!seeders.has(PLATE_CONTENT_KEY)) {
      seeders.set(PLATE_CONTENT_KEY, SESSION_ID)
    }

    const timer = window.setTimeout(() => {
      seeded.current = true

      if (seeders.get(PLATE_CONTENT_KEY) !== SESSION_ID) return // Lost the election.
      if (sharedRoot.length > 0) return // Someone else already seeded.

      /*
        Deserialize stored Markdown → Plate value, then apply via the editor.

        Because YjsPlugin is active, editor.tf.setValue propagates through the
        withYjs binding as a series of Yjs insert operations — not a raw
        Y.Doc mutation. Other clients receive those operations and apply them
        as Slate changes.
      */
      const value = editor.getApi(MarkdownPlugin).markdown.deserialize(stored)
      editor.tf.setValue(value)
      editor.tf.normalize({ force: true })
    }, SEED_SETTLE_MS)

    return () => window.clearTimeout(timer)
  }, [doc, editor, stored, synced])

  return editor
}
