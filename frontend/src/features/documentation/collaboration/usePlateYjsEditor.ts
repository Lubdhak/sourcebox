import { MarkdownPlugin } from '@platejs/markdown'
import { slateToDeterministicYjsState } from '@platejs/yjs'
import { YjsPlugin } from '@platejs/yjs/react'
import { CursorEditor, YjsEditor } from '@slate-yjs/core'
import * as Y from 'yjs'
import { usePlateEditor, type PlateEditor } from 'platejs/react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import {
  CursorOverlayPlugin,
  cursorDataFor,
} from '@/features/documentation/collaboration/cursorOverlay'
import {
  createRemoteFlashPlugin,
  REMOTE_FLASH_MS,
  type RemoteFlashState,
} from '@/features/documentation/collaboration/remoteFlash'
import { DOCUMENTATION_PLUGINS } from '@/features/documentation/editor/plugins'
import {
  activeRemoteAuthor,
  type CollaborativeDocument,
} from '@/features/documentation/collaboration/useCollaborativeDocument'
import type { Collaborator } from '@/types'

/**
 * The key inside the Y.Doc that holds the Plate/Slate document tree.
 *
 * `@platejs/yjs` binds a `Y.XmlText` at this key by default (`ydoc.get('content',
 * Y.XmlText)`, inside its own `withPlateYjs`) -- not configurable here, only matched: this
 * constant exists so the one other place that needs the same key, the seeding check
 * below, cannot drift from it by a typo.
 *
 * This is NOT the same key that used to hold the Markdown text (`'page'`).
 * The Markdown text is now a derived, serialized snapshot — not the CRDT.
 */
export const PLATE_CONTENT_KEY = 'content'

/**
 * `@slate-yjs/core`'s functions are typed against a plain Slate `BaseEditor & YjsEditor`,
 * built from Slate's own generic node types. A Plate editor genuinely has every one of
 * those methods -- `withPlateYjs` mutates the very object `usePlateEditor` returns -- but
 * its *type* is Plate's own, generic over its plugin list instead, and the two do not
 * line up structurally. The cast is the honest way to say so, once, rather than at every
 * call site below.
 */
export function asYjsEditor(editor: PlateEditor): YjsEditor {
  return editor as unknown as YjsEditor
}

/**
 * A Plate editor bound to the collaborative Y.Doc via @platejs/yjs.
 *
 * The document model is the Plate/Slate tree, stored in a `Y.XmlText` inside the Y.Doc.
 * Markdown is NOT the CRDT — it is derived from the Plate tree on demand and written to
 * the database as a periodic snapshot.
 *
 * Architecture:
 *
 *   Y.Doc
 *     └── Y.XmlText(PLATE_CONTENT_KEY)  ← canonical collaborative state
 *          ↕ @platejs/yjs (withYjs, from @slate-yjs/core)
 *   Plate / Slate document model        ← local rendering model
 *          ↓ serialize (debounced)
 *   Markdown                            ← persistence / export / LLM
 *
 * Transport is handled separately by useCollaborativeDocument, which sends and receives
 * binary Yjs updates -- for both the document and, since this file also configures
 * `cursors`, Yjs's Awareness protocol -- over Action Cable. The server never decodes those
 * bytes; it relays and, for the document only, logs them.
 *
 * ### Why this file calls `YjsEditor.connect` itself, rather than `yjs.init()`
 *
 * `@platejs/yjs` ships a `yjs.init()` API that seeds, connects, and more -- but `init`
 * requires at least one entry in its `providers` array, and throws without one. A
 * provider is `@platejs/yjs`'s own transport abstraction (hocuspocus, webrtc, indexeddb),
 * and this application already has a transport: the Action Cable channel
 * `useCollaborativeDocument` owns, which relays raw Yjs bytes exactly the way a provider
 * would, just not through `@platejs/yjs`'s registry. Writing a do-nothing provider merely
 * to satisfy `init`'s guard would be more code and more indirection than doing, by hand,
 * the two things this application actually needs from it -- seeding and connecting, in
 * that order, for the reason the next section gives.
 *
 * ### Why seeding happens before `YjsEditor.connect`, not through `editor.tf.setValue`
 *
 * `YjsEditor.connect` does two things: it loads whatever is already in the shared text
 * into the editor, and it force-normalizes the result. On a genuinely empty document, this
 * project's own schema plugins (a required trailing paragraph, among others) mean that
 * normalize does not merely accept the empty state -- it *edits* it, inserting the
 * paragraph a document is not allowed to be without. Because the editor is connected the
 * instant before this runs, that insertion is a real Slate operation, which the binding
 * mirrors into the Y.Doc as a real write. A moment later, this hook's own seeding logic
 * would ask "does the shared text already have content" and, finding that one paragraph,
 * answer yes -- and never write the actual stored Markdown at all. Every node opened for
 * the first time would silently keep its placeholder paragraph and lose everything that
 * had been written about it.
 *
 * `slateToDeterministicYjsState` (from `@platejs/yjs`, built for exactly this moment in
 * `init`) sidesteps the whole question by writing directly to the Y.Doc, before the editor
 * exists to normalize anything. It also removes the need for the election this file used
 * to run: every peer opening the same empty node derives the *same* bytes from the same
 * inputs (the node's id, the same stored Markdown), so two peers seeding at once are two
 * peers writing identical Yjs operations -- which a CRDT merges into one, not a race.
 *
 * ### Why the caller needs `ready`, not just `editor`
 *
 * Seeding awaits `crypto.subtle.digest` before it writes anything, which means there is a
 * real, if short, span of time after mount during which the editor exists but is neither
 * seeded nor connected. A click during that span is a click into whatever the initial
 * value happened to render -- and, worse, the resulting selection change asks
 * `withCursors` to translate a Slate path into a Y position against a shared root that
 * connect has not attached anything to yet, which is not a question that path has an
 * answer to. `ready` is what `PageEditor` holds `PlateContent` read-only for, the same way
 * it already did for `page.synced`, to close that span rather than let a fast click land
 * inside it.
 */
export function usePlateYjsEditor({
  document,
  stored,
  collaborator,
  nodeId,
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
  /** Whoever is signed in, for the name and colour their caret shows to everyone else. */
  collaborator: Collaborator
  /** Fed to `slateToDeterministicYjsState` as the seed's id, so two different empty nodes
   * seeded from coincidentally identical Markdown do not derive the same bytes. */
  nodeId: string
}) {
  const { doc, awareness, synced, editors } = document

  // Read inside `applyRemoteEvents` below, which is set up once at connect time but
  // called on every remote change after that -- a plain closure over `editors` would see
  // whoever was editing at connect time forever, not whoever actually sent this change.
  const editorsRef = useRef(editors)
  editorsRef.current = editors

  // A plain mutable map, not React state -- see `RemoteFlashState`'s own comment for why.
  // `useMemo` rather than `useRef` only so it survives a fast-refresh-style re-run of this
  // hook's own body without losing the reference the plugin below was already given.
  const flashState = useMemo<RemoteFlashState>(() => new Map(), [])

  // Forces the plugin's `decorate` to run again after `flashState` changes -- the same
  // problem `PageEditor`'s own `redecorate` (for cursors) solves, solved here instead of
  // there because `flashState` is this hook's own state, not something worth exposing
  // just to hand the trigger to a caller.
  const [, forceRedecorate] = useReducer((tick: number) => tick + 1, 0)

  const editor = usePlateEditor({
    plugins: [
      ...DOCUMENTATION_PLUGINS,
      /*
        The Yjs binding.

        YjsPlugin wraps the editor with withYjs (from @slate-yjs/core internally),
        attaching the Y.XmlText at PLATE_CONTENT_KEY to the Slate children array. After
        this:
          - Every Slate operation is mirrored to the Y.XmlText as Yjs operations.
          - Every remote Yjs update is applied as precise Slate operations, not a
            full document replacement.

        The transport (doc.on('update') / Y.applyUpdate) lives in
        useCollaborativeDocument and is entirely unaware of what is stored inside
        the Y.Doc.

        `cursors.data` is this client's own presence, sent the moment `YjsEditor.connect`
        below runs (see `withCursors`'s `connect`, in `@slate-yjs/core`) and again every
        time the local selection moves. `CursorOverlayPlugin` is what turns everyone
        else's copy of it back into a coloured, named highlight in the text.

        `autoSend: false`: `withCursors`'s own auto-send calls `sendCursorPosition`
        synchronously inside `onChange`, which walks the *new* selection's path against
        `sharedRoot` to encode it. Some structural edits -- a code block's own
        `insertBreak`, splitting a code line rather than a paragraph, is the one this was
        found from -- produce a selection whose path `sharedRoot` cannot yet answer for at
        that exact point in `onChange`, and `@slate-yjs/core` has no guard for it: it
        throws, uncaught, out of a promise nothing here is in a position to catch.
        `PageEditor`'s own `sendCursorPositionSafely` (in its `scheduleSnapshot`) is this
        codebase's replacement -- same call, wrapped in a try/catch that drops one
        position update rather than letting a code block break the editor for everyone
        looking at it.
      */
      YjsPlugin.configure({
        options: {
          ydoc: doc,
          awareness,
          cursors: { data: cursorDataFor(collaborator), autoSend: false },
        },
      }),
      CursorOverlayPlugin,
      createRemoteFlashPlugin(flashState),
    ],
    /*
      Initialise from stored Markdown so the editor is never blank when opened.

      Without an initial value the editor starts empty until seeding and `YjsEditor.connect`
      below have both run. The user would see a blank page for the width of a network
      round-trip.

      Once connected, `YjsEditor.connect` overwrites this with whatever the Y.Doc actually
      holds -- the initial value is only ever what appears in the gap before that, not a
      competing source of truth.
    */
    value: stored
      ? (instance) => instance.getApi(MarkdownPlugin).markdown.deserialize(stored)
      : undefined,
    shouldNormalizeEditor: true,
  })

  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!synced) return

    let cancelled = false

    async function seedThenConnect() {
      /*
        Seed first, at the Y.Doc level, before the editor that would normalize an empty
        one exists to do so. See the class comment's second section for why the order
        matters.
      */
      const sharedRoot = doc.get(PLATE_CONTENT_KEY, Y.XmlText)

      if (sharedRoot.length === 0 && stored) {
        const initialNodes = editor.getApi(MarkdownPlugin).markdown.deserialize(stored)
        const update = await slateToDeterministicYjsState(nodeId, initialNodes)
        /*
          Checked again, immediately after the one genuine await in this function: `stored`
          arrives from `usePageBody`, itself downstream of a GraphQL fetch that can still be
          in flight the moment this effect first runs, empty until it resolves. If it
          resolves *during* this await, `stored` (and this whole effect) reruns with the
          real value -- the run that got here first is exactly the one that must not
          also finish, on the empty value it started with.
        */
        if (cancelled) return

        // A second peer's identical, concurrently-generated update is a no-op here --
        // Yjs deduplicates by clientId and clock, which is what makes this safe without
        // the coordination an election would otherwise need.
        Y.applyUpdate(doc, update)
      }

      if (cancelled) return

      const yjsEditor = asYjsEditor(editor)
      YjsEditor.connect(yjsEditor)

      /*
        `withCursors`'s own `connect` sends this for us -- but only when `autoSend` is
        true, and `autoSend` is false here (see the `cursors` option's comment above).
        Sent by hand instead: unlike a position, this is a plain Awareness field write
        with no path to walk and nothing in it that can fail the way that walk can.
      */
      if (CursorEditor.isCursorEditor(yjsEditor)) {
        CursorEditor.sendCursorData(yjsEditor, cursorDataFor(collaborator))
      }

      /*
        The remote-change flash: wraps the one function `withYjs`'s deep observer calls
        for a remote update (never for a local one -- `handleYEvents` filters those out
        before this is reached), so everything downstream of it already knows this
        change came from someone else without asking.

        Diffing `editor.children` before and after, by reference rather than by content,
        is what finds which top-level blocks moved: Slate's own operations rebuild the
        top-level array immutably, so a paragraph nobody touched is the same object
        after the batch as before it, and one that changed is not.
      */
      const original = yjsEditor.applyRemoteEvents
      yjsEditor.applyRemoteEvents = (events, origin) => {
        const before = editor.children
        original(events, origin)
        const after = editor.children

        const author = activeRemoteAuthor(editorsRef.current)
        if (!author) return // Nothing to attribute the flash to; nothing to flash.

        const until = Date.now() + REMOTE_FLASH_MS
        const maxLength = Math.max(before.length, after.length)
        let changed = false

        for (let index = 0; index < maxLength; index += 1) {
          if (before[index] === after[index]) continue
          flashState.set(index, { until, color: author.color, name: author.name })
          changed = true
        }

        if (!changed) return

        forceRedecorate()
        window.setTimeout(() => {
          // Only ever removes entries this call itself added: a block that changed
          // again in the meantime already has a *later* `until` from that newer call,
          // and this timeout deleting the entry out from under it would cut the second
          // flash short instead of letting its own timer end it.
          for (const [index, flash] of flashState) {
            if (flash.until <= until) flashState.delete(index)
          }
          forceRedecorate()
        }, REMOTE_FLASH_MS)
      }

      setReady(true)
    }

    void seedThenConnect()

    return () => {
      cancelled = true
      setReady(false)
      // Only meaningful if `seedThenConnect` reached it before this ran; `YjsEditor`
      // itself guards a disconnect of an editor that was never connected, and a
      // reconnect on the next run is exactly what an editor that outlives one `stored`
      // value needs -- this is not a special case, just the ordinary teardown before it.
      if (YjsEditor.connected(asYjsEditor(editor))) YjsEditor.disconnect(asYjsEditor(editor))
    }
  }, [doc, editor, nodeId, stored, synced])

  return { editor, ready }
}
