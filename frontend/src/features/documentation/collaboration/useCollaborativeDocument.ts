import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { cable, SESSION_ID, type RealtimeEnvelope } from '@/lib/cable'
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
 *   awareness  both ways          who is editing, never stored
 *   compact    client -> server   a merged snapshot, so the log can be truncated
 *
 * Compaction is done by a client because only a client can merge. The server's job is to
 * refuse a snapshot that claims to cover updates it has not seen.
 */

/**
 * The node's page, inside the node's document.
 *
 * A fixed key rather than one per content block, because a node's documentation is one
 * body now and the blocks behind it are storage. Keying by block id also meant the shared
 * text moved whenever the row it came from was replaced, which is exactly what saving a
 * page does.
 */
export const PAGE_KEY = 'page'

export function pageText(doc: Y.Doc): Y.Text {
  return doc.getText(PAGE_KEY)
}

export interface TextPeer {
  sessionId: string
  actor: Collaborator
  /** `PAGE_KEY` while they have the editor open, null when they are only reading. */
  editing?: string | null
}

export interface CollaborativeDocument {
  doc: Y.Doc
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

  const [synced, setSynced] = useState(false)
  const [connected, setConnected] = useState(false)
  const [editors, setEditors] = useState<Record<string, TextPeer>>({})

  const subscription = useRef<{ perform: (action: string, data?: object) => void; unsubscribe: () => void } | null>(null)
  const highestSeq = useRef(0)

  useEffect(() => () => doc.destroy(), [doc])

  useEffect(() => {
    if (!nodeId || !enabled) return

    let disposed = false

    const channel = cable().subscriptions.create(
      { channel: 'NodeDocumentChannel', node_id: nodeId, session_id: SESSION_ID },
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
            case 'awareness':
              if (message.sessionId === SESSION_ID || !message.actor) return
              setEditors((current) => ({
                ...current,
                [String(message.sessionId)]: {
                  sessionId: String(message.sessionId),
                  actor: message.actor as Collaborator,
                  editing: message.state?.editing ?? null,
                },
              }))
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
    }

    // Local edits out. Filtering on origin is what separates "the user typed" from "we
    // just applied someone else's change".
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || disposed) return

      channel.perform('update', { update: toBase64(update) })
    }

    doc.on('update', onUpdate)
    subscription.current = channel

    return () => {
      disposed = true
      doc.off('update', onUpdate)
      channel.unsubscribe()
      subscription.current = null
      setSynced(false)
      setConnected(false)
      setEditors({})
    }
  }, [doc, enabled, nodeId])

  const announceEditing = useCallback((editing: string | null) => {
    subscription.current?.perform('awareness', { state: { editing } })
  }, [])

  const roster = useMemo(() => Object.values(editors), [editors])

  return { doc, synced, connected, editors: roster, announceEditing }
}
