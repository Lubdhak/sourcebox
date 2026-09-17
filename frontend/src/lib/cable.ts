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
