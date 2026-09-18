import { createConsumer, type Consumer } from '@rails/actioncable'
import { logger } from '@/lib/logger'

/**
 * The application's single WebSocket connection.
 *
 * One consumer for the whole tab, shared by every channel. Action Cable multiplexes
 * subscriptions over one socket, and creating a consumer per hook would undo that: a user
 * with a space open and three nodes being edited would hold four sockets, each with its
 * own handshake, its own heartbeat and its own reconnect storm when the network blips.
 *
 * The URL is relative for the same reason the GraphQL endpoint is. The JS module comes
 * from Vite, but the *document* is served by Rails, so `/cable` resolves against the
 * backend origin and the Devise session cookie is sent with the handshake -- which is the
 * whole of the authentication story, since Action Cable authenticates once at connect and
 * never again.
 */

let consumer: Consumer | null = null

export function cable(): Consumer {
  if (consumer) return consumer

  consumer = createConsumer('/cable')

  return consumer
}

/**
 * Closes the socket. Exported for tests, which must not leave a reconnect loop running
 * between cases, and for a signed-out client that should stop trying.
 */
export function disconnectCable(): void {
  if (!consumer) return

  consumer.disconnect()
  consumer = null
}

/** Every realtime message carries the id of whoever caused it, so a client can ignore its own. */
export interface RealtimeEnvelope {
  type: string
  actorId?: string
  sessionId?: string
  [key: string]: unknown
}

/**
 * A stable per-tab identity.
 *
 * Presence is per *tab*, not per user: the same person with a space open twice is two
 * cursors, and each one has to see the other. The id lives for as long as the page does,
 * which is also exactly as long as the subscription it identifies.
 */
/**
 * A different identity for every subscription, on top of the session's.
 *
 * Action Cable keys a connection's subscriptions by their identifier, which is the channel
 * name plus the params. Two subscriptions to the same channel with the same params are
 * therefore the *same* subscription to the server -- so when a component remounts and the
 * old instance unsubscribes after the new one has subscribed, the server removes the entry
 * the live subscription is still using. Everything it sends after that is answered with
 * "unable to find subscription" and dropped on the floor: the socket looks healthy, the
 * client keeps sending, and nothing is recorded.
 *
 * A nonce in the params makes each subscription its own identifier, so an unsubscribe can
 * only ever remove the one it belongs to. The server ignores it; `session_id` is still what
 * identifies the tab, because that is what filters a client's own echo.
 */
export function subscriptionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const SESSION_ID: string =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `session-${Math.random().toString(36).slice(2)}`

export function logChannelFailure(channel: string, error: unknown): void {
  logger.warn('frontend.cable_failure', {
    channel,
    errorMessage: error instanceof Error ? error.message : String(error),
  })
}
