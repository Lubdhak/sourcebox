import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { cable, SESSION_ID, subscriptionId, type RealtimeEnvelope } from '@/lib/cable'
import { logger } from '@/lib/logger'
import type { Collaborator } from '@/features/documentation/collaboration/useSpaceChannel'

/**
 * A Yjs document for one node's text, synchronised over Action Cable.
 *
 * This is the part that makes two people able to type into the same paragraph. Everything
 * else in the app resolves concurrency by last-write-wins, which is right for a position
 * or a title and destroys work when applied to prose: the slower typist's sentence simply
 * vanishes. A CRDT resolves it instead -- both edits survive, in a deterministic order
 * every participant agrees on, with no server arbitration.
 *
 * Rails is a relay and an append-only log here, not a merger; it never decodes a payload.
 * The protocol is deliberately small:
 *
 *   sync       server -> client   snapshot plus the updates recorded after it
 *   update     both ways          one encoded Yjs update
 *   awareness  both ways          who has this node open, and who is typing; never stored
 *   cursor     both ways          one encoded Yjs *Awareness* update; never stored
 *   left       server -> client   a session's subscription ended
 *   compact    client -> server   a merged snapshot, so the log can be truncated
 *
 * Compaction is done by a client because only a client can merge. The server's job is to
 * refuse a snapshot that claims to cover updates it has not seen.
 *
 * `awareness` and `cursor` look alike -- two names for "tell everyone something about
 * yourself that nobody should have to remember" -- and stay two protocols because they
 * answer different questions at different rates. `awareness` is ours: a page open or not,
 * typing or not, sent on the change and answered once to a newcomer, the same shape a
 * human would describe it in. `cursor` is Yjs's own Awareness protocol, encoded bytes
 * neither this file nor Rails looks inside -- it carries a *selection*, in the
 * fine-grained, every-keystroke-moves-it way `@slate-yjs/core`'s `withCursors` expects,
 * which is what actually draws a colleague's caret and highlight inside the text. One
 * could describe the other's job in prose; neither could do it.
 */

/**
 * The awareness key used to indicate which page a collaborator is editing.
 *
 * A fixed key rather than one per content block, because a node's documentation is one
 * body now and the blocks behind it are storage. Sent via the `awareness` action so
 * other clients can display "Alice is in here too".
 *
 * This is NOT the key used to store the Plate document in the Y.Doc — that is
 * `PLATE_CONTENT_KEY` in usePlateYjsEditor, owned by @platejs/yjs.
 */
export const PAGE_KEY = 'page'

export interface TextPeer {
  sessionId: string
  actor: Collaborator
  /** `PAGE_KEY` while they have the editor open, null when they are only reading. */
  editing?: string | null
}

export interface CollaborativeDocument {
  doc: Y.Doc
  /**
   * Yjs's own Awareness instance for `doc`, shared with `usePlateYjsEditor` so that
   * `@slate-yjs/core`'s cursor tracking and this hook's transport are talking about the
   * same object. Created and destroyed alongside `doc` for the same reason they are the
   * same lifecycle: an awareness instance from the node just left describing cursors in a
   * document nobody here has open would be nonsense the moment it arrived.
   */
  awareness: Awareness
  /** False until the server's state has been applied, so an editor does not show an empty document. */
  synced: boolean
  connected: boolean
  /** Everyone else with this node open, and which block they are in. */
  editors: TextPeer[]
  /** Tell the others whether this client has the editor open. */
  announceEditing: (editing: string | null) => void
}

interface SyncMessage extends RealtimeEnvelope {
  snapshot?: string | null
  updates?: string[]
  seq?: number
  compactionNeeded?: boolean
  update?: string
  state?: { editing?: string | null } | null
  actor?: Collaborator
}

function toBytes(encoded: string): Uint8Array {
  const binary = atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked rather than one spread call: a large paste produces an array long enough to
  // blow the argument limit of String.fromCharCode.
  const CHUNK = 0x8000
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

export function useCollaborativeDocument(nodeId: string | null, enabled = true): CollaborativeDocument {
  // One document per node id. Recreated when the selection moves, because a Yjs document
  // is the identity of the thing being edited -- reusing one across nodes would merge two
  // unrelated texts into each other.
  const doc = useMemo(() => new Y.Doc(), [nodeId])
  // Bound to `doc` explicitly rather than left for @platejs/yjs to create its own: the
  // plugin only ever sees the editor open, and it is this hook's channel, not the
  // editor's, that has anywhere to send an Awareness update.
  const awareness = useMemo(() => new Awareness(doc), [doc])

  const [synced, setSynced] = useState(false)
  const [connected, setConnected] = useState(false)
  const [editors, setEditors] = useState<Record<string, TextPeer>>({})

  const subscription = useRef<{ perform: (action: string, data?: object) => void; unsubscribe: () => void } | null>(null)
  const highestSeq = useRef(0)
  // What this client would say if asked right now. `announceEditing` writes it;
  // `received` reads it when answering a newcomer, so the answer is never stale by more
  // than the time between a focus change and the next render.
  const myEditing = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      awareness.destroy()
      doc.destroy()
    }
  }, [doc, awareness])

  useEffect(() => {
    if (!nodeId || !enabled) return

    let disposed = false

    // Every sessionId this client has already heard from, on this document. Local to the
    // subscription rather than a ref: it describes what *this* channel connection knows,
    // and a new node -- a new subscription -- has heard from no one yet.
    const answeredSessions = new Set<string>()

    // The Yjs Awareness clientIds this client has already answered, kept apart from
    // `answeredSessions` because they are different id spaces answering the same
    // question -- Yjs assigns its own random numeric id per Y.Doc instance, which this
    // hook never sees outside of `awareness` itself.
    const answeredClients = new Set<number>()

    // `myEditing` is a ref because `announceEditing` needs to reach it from outside this
    // effect, but its value describes standing in *this* node's document -- carrying a
    // stale "editing" from the node just left into this one's first announcement would
    // tell everyone here that a page they have not opened yet is being typed into.
    myEditing.current = null

    const channel = cable().subscriptions.create(
      // The nonce is what keeps a remount from unsubscribing the subscription that
      // replaced it. See `subscriptionId`.
      { channel: 'NodeDocumentChannel', node_id: nodeId, session_id: SESSION_ID, subscription_id: subscriptionId() },
      {
        connected() {
          setConnected(true)
        },
        disconnected() {
          setConnected(false)
        },
        rejected() {
          setConnected(false)
          logger.warn('frontend.node_document_rejected', { nodeId })
        },
        received(message: SyncMessage) {
          if (disposed) return

          switch (message.type) {
            case 'sync':
              applySync(message)
              break
            case 'update':
              if (message.sessionId === SESSION_ID || !message.update) return
              // `origin` marks this as remote so the observer below does not echo it
              // straight back to the server, which would loop forever.
              Y.applyUpdate(doc, toBytes(message.update), 'remote')
              if (message.seq) highestSeq.current = Math.max(highestSeq.current, message.seq)
              break
            case 'awareness': {
              if (message.sessionId === SESSION_ID || !message.actor) return
              const sessionId = String(message.sessionId)

              setEditors((current) => ({
                ...current,
                [sessionId]: {
                  sessionId,
                  actor: message.actor as Collaborator,
                  editing: message.state?.editing ?? null,
                },
              }))

              /*
                Answered once per session, the way SpaceChannel answers a `hello`:
                broadcasting is not asking, so a client that joined before this sender
                would otherwise never learn it is here too. Every subsequent message from
                the same session is a real change (focus, blur) rather than an
                introduction, and gets no reply -- an answer to every keystroke's
                awareness update would double the traffic this channel carries for
                nothing outside this client's own roster.
              */
              if (!answeredSessions.has(sessionId)) {
                answeredSessions.add(sessionId)
                channel.perform('awareness', { state: { editing: myEditing.current } })
              }
              break
            }
            case 'cursor':
              if (message.sessionId === SESSION_ID || !message.update) return
              // The matching `onAwarenessChange` listener below does the rest: applying
              // this fires it with `origin === 'remote'`, which is where a newcomer among
              // the client ids this update names gets answered.
              applyAwarenessUpdate(awareness, toBytes(message.update), 'remote')
              break
            // The other end of `awareness`: a session that had this node open no longer
            // does. Without it, closing a tab would leave a face in every remaining
            // viewer's roster for a document nobody is looking at anymore.
            case 'left':
              setEditors((current) => {
                if (!message.sessionId || !(String(message.sessionId) in current)) return current
                const next = { ...current }
                delete next[String(message.sessionId)]
                return next
              })
              break
            case 'rejected':
              logger.warn('frontend.node_document_update_rejected', { nodeId })
              break
          }
        },
      },
    )

    function applySync(message: SyncMessage) {
      // One transaction for the whole catch-up, so an editor bound to this document
      // re-renders once rather than once per recorded keystroke.
      doc.transact(() => {
        if (message.snapshot) Y.applyUpdate(doc, toBytes(message.snapshot), 'remote')
        for (const update of message.updates ?? []) Y.applyUpdate(doc, toBytes(update), 'remote')
      }, 'remote')

      highestSeq.current = message.seq ?? 0
      setSynced(true)

      // The log has grown long enough that replaying it is the slow part of joining.
      // This client has just merged all of it, so it is in a position to say so.
      if (message.compactionNeeded && highestSeq.current > 0) {
        channel.perform('compact', {
          state: toBase64(Y.encodeStateAsUpdate(doc)),
          throughSeq: highestSeq.current,
        })
      }

      /*
        Says "I have this open" the moment it is true, rather than waiting for the editor
        to be focused.

        Without this, `editors` held only people who had clicked into the text -- so a
        panel opened to read, not to type, told nobody it was open at all, and a viewer's
        own "who else is here" roster stayed empty for exactly the visits it most needed
        to show. `announceEditing` still fires its own `awareness` on focus and blur; this
        is the announcement that comes before either one, so a reader counts as present
        without having to become a writer first. Reads `myEditing` rather than hardcoding
        null in case the editor has already claimed focus by the time sync completes.
      */
      channel.perform('awareness', { state: { editing: myEditing.current } })

      /*
        The Awareness half of the same "I have arrived" announcement.

        Our own local state is very likely still empty at this instant -- `usePlateYjsEditor`
        has not necessarily called `YjsEditor.connect` yet, and cursor data is not sent
        until it does -- but the update still names our clientId, which is the only thing
        this round needs to accomplish: it is what lets an *already-present* peer's own
        `onAwarenessChange` recognise us as new and answer. Our real cursor state, once
        there is one, goes out through that same listener the moment it is set.
      */
      channel.perform('cursor', {
        update: toBase64(encodeAwarenessUpdate(awareness, [awareness.clientID])),
      })
    }

    // Local edits out. Filtering on origin is what separates "the user typed" from "we
    // just applied someone else's change".
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || disposed) return

      channel.perform('update', { update: toBase64(update) })
    }

    /*
     * One listener for both directions of the Awareness protocol, the way `applyAwarenessUpdate`
     * itself does not distinguish them: it fires this same 'update' event whether the
     * change came from a local `setLocalStateField` (our own cursor moved) or from
     * `applyAwarenessUpdate` above (someone else's did).
     *
     * The `origin` argument is what tells the two apart, and each does a different job --
     * a local change is relayed, unconditionally; a remote one is only ever inspected for
     * *sessions the answer-once handshake has not seen*, and only they get an answer.
     * Both branches speak in Yjs clientIds, which is what `added`/`updated`/`removed`
     * name -- never our own `SESSION_ID`, which this protocol does not know exists.
     */
    const onAwarenessChange = (
      changes: { added: number[]; updated: number[]; removed: number[] },
      origin: unknown,
    ) => {
      if (disposed) return

      if (origin === 'remote') {
        const newClients = changes.added.filter((clientId) => !answeredClients.has(clientId))
        if (newClients.length === 0) return

        for (const clientId of newClients) answeredClients.add(clientId)
        channel.perform('cursor', {
          update: toBase64(encodeAwarenessUpdate(awareness, [awareness.clientID])),
        })
        return
      }

      const changedClients = [...changes.added, ...changes.updated, ...changes.removed]
      if (changedClients.length === 0) return

      channel.perform('cursor', { update: toBase64(encodeAwarenessUpdate(awareness, changedClients)) })
    }

    doc.on('update', onUpdate)
    awareness.on('update', onAwarenessChange)
    subscription.current = channel

    return () => {
      disposed = true
      doc.off('update', onUpdate)
      awareness.off('update', onAwarenessChange)
      channel.unsubscribe()
      subscription.current = null
      setSynced(false)
      setConnected(false)
      setEditors({})
    }
  }, [doc, awareness, enabled, nodeId])

  const announceEditing = useCallback((editing: string | null) => {
    myEditing.current = editing
    subscription.current?.perform('awareness', { state: { editing } })
  }, [])

  const roster = useMemo(() => Object.values(editors), [editors])

  return { doc, awareness, synced, connected, editors: roster, announceEditing }
}
