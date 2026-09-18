import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cable, SESSION_ID, subscriptionId, type RealtimeEnvelope } from '@/lib/cable'
import { logger } from '@/lib/logger'

/**
 * Subscribes to one space's live feed: who else is here, and what they are changing.
 *
 * Presence is reconstructed from messages rather than fetched, because the server keeps
 * no roster. On subscribe this client says hello; everyone already present answers, and
 * both sides learn about each other from the same message. Peers are then aged out
 * locally, which is what makes a browser that was closed by force -- or by a laptop lid
 * -- disappear without the server having to notice.
 *
 * Structural messages are not interpreted here. They are handed to `onGraphMessage`,
 * because deciding what a `node_moved` means for the canvas is the graph state's job,
 * and a hook that both owned a socket and mutated a graph would be impossible to test
 * either way round.
 */

/** Dropped after this long without a heartbeat, roughly three missed beats. */
const PEER_TTL_MS = 45_000
const HEARTBEAT_MS = 15_000

/**
 * Cursor updates are throttled hard. A pointer emits moves at display frequency, and
 * every message is a row in the cable database fanned out to everyone in the space:
 * at fifty collaborators, sending every frame would be thousands of writes a second to
 * show something nobody can perceive at that resolution.
 */
const CURSOR_THROTTLE_MS = 80

export interface Collaborator {
  id: string
  name: string
  colorSeed: number
}

export interface Peer {
  sessionId: string
  actor: Collaborator
  x?: number
  y?: number
  focusNodeId?: string | null
  selectedNodeId?: string | null
  editingBlockId?: string | null
  lastSeen: number
}

export interface PresenceState {
  x?: number
  y?: number
  focusNodeId?: string | null
  selectedNodeId?: string | null
  editingBlockId?: string | null
}

interface UseSpaceChannelOptions {
  spaceId: string
  /** Applied to the canvas by the caller. Called for every structural message. */
  onGraphMessage: (message: RealtimeEnvelope) => void
  /** Disables the socket entirely, for tests and for the server-rendered first paint. */
  enabled?: boolean
}

export interface SpaceChannelApi {
  peers: Peer[]
  connected: boolean
  /** Throttled. Safe to call from a pointer-move handler. */
  publishCursor: (state: PresenceState) => void
  /** Immediate. For changes worth reporting at once, like diving into a node. */
  publishPresence: (state: PresenceState) => void
}

export function useSpaceChannel({
  spaceId,
  onGraphMessage,
  enabled = true,
}: UseSpaceChannelOptions): SpaceChannelApi {
  const [peers, setPeers] = useState<Record<string, Peer>>({})
  const [connected, setConnected] = useState(false)

  const subscription = useRef<{ perform: (action: string, data?: object) => void; unsubscribe: () => void } | null>(null)
  // The latest presence this client has published, so a `hello` from a late joiner can be
  // answered with where we actually are rather than with an empty marker.
  const localState = useRef<PresenceState>({})
  const lastCursorAt = useRef(0)
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Held in a ref so that changing the handler does not tear down and rebuild the
  // subscription, which would make every re-render of the page a reconnect.
  const handleGraphMessage = useRef(onGraphMessage)
  handleGraphMessage.current = onGraphMessage

  useEffect(() => {
    if (!enabled) return

    const channel = cable().subscriptions.create(
      { channel: 'SpaceChannel', space_id: spaceId, session_id: SESSION_ID, subscription_id: subscriptionId() },
      {
        connected() {
          setConnected(true)
          channel.perform('hello', localState.current)
        },
        disconnected() {
          setConnected(false)
        },
        rejected() {
          setConnected(false)
          logger.warn('frontend.space_channel_rejected', { spaceId })
        },
        received(message: RealtimeEnvelope) {
          if (message.sessionId === SESSION_ID) return

          if (message.type === 'presence.here' || message.type === 'presence.cursor') {
            mergePeer(message)

            // A newcomer's hello is answered so it learns about us. Answering an
            // *answer* would be an infinite exchange, so only `presence.here` replies.
            if (message.type === 'presence.here') {
              channel.perform('cursor', localState.current)
            }
            return
          }

          if (message.type === 'presence.left') {
            setPeers((current) => {
              const next = { ...current }
              delete next[String(message.sessionId)]
              return next
            })
            return
          }

          handleGraphMessage.current(message)
        },
      },
    )

    function mergePeer(message: RealtimeEnvelope) {
      const sessionId = String(message.sessionId ?? '')
      const actor = message.actor as Collaborator | undefined
      if (!sessionId || !actor) return

      const payload = (message.payload ?? {}) as PresenceState

      setPeers((current) => ({
        ...current,
        [sessionId]: { ...current[sessionId], sessionId, actor, ...payload, lastSeen: Date.now() },
      }))
    }

    subscription.current = channel

    // Heartbeat. Doubles as the liveness signal peers age out against, so it is a
    // presence message rather than a dedicated ping: one message type, one code path.
    const heartbeat = setInterval(() => channel.perform('cursor', localState.current), HEARTBEAT_MS)

    const reaper = setInterval(() => {
      const cutoff = Date.now() - PEER_TTL_MS
      setPeers((current) => {
        const alive = Object.fromEntries(Object.entries(current).filter(([, peer]) => peer.lastSeen > cutoff))
        return Object.keys(alive).length === Object.keys(current).length ? current : alive
      })
    }, PEER_TTL_MS / 3)

    return () => {
      clearInterval(heartbeat)
      clearInterval(reaper)
      if (cursorTimer.current) clearTimeout(cursorTimer.current)
      channel.unsubscribe()
      subscription.current = null
      setPeers({})
      setConnected(false)
    }
  }, [enabled, spaceId])

  const publishPresence = useCallback((state: PresenceState) => {
    localState.current = { ...localState.current, ...state }
    subscription.current?.perform('cursor', localState.current)
  }, [])

  const publishCursor = useCallback((state: PresenceState) => {
    localState.current = { ...localState.current, ...state }

    const elapsed = Date.now() - lastCursorAt.current
    if (elapsed >= CURSOR_THROTTLE_MS) {
      lastCursorAt.current = Date.now()
      subscription.current?.perform('cursor', localState.current)
      return
    }

    // Trailing edge, so the final resting position of a pointer is always sent. Without
    // it a cursor freezes wherever the last throttled frame happened to land.
    if (cursorTimer.current) return

    cursorTimer.current = setTimeout(() => {
      cursorTimer.current = null
      lastCursorAt.current = Date.now()
      subscription.current?.perform('cursor', localState.current)
    }, CURSOR_THROTTLE_MS - elapsed)
  }, [])

  const roster = useMemo(() => Object.values(peers).sort((a, b) => a.actor.name.localeCompare(b.actor.name)), [peers])

  return { peers: roster, connected, publishCursor, publishPresence }
}
