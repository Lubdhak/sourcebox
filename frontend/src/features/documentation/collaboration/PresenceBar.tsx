import { useMemo } from 'react'
import { dedupeByActor } from '@/features/documentation/collaboration/dedupeByActor'
import { PersonAvatar } from '@/features/documentation/collaboration/PersonAvatar'
import type { Peer } from '@/features/documentation/collaboration/useSpaceChannel'
import { cn } from '@/lib/utils'
import type { Collaborator } from '@/types'

/**
 * Who else is in this space.
 *
 * Small, but it is what makes concurrent editing legible rather than uncanny: without it,
 * a node retitling itself is a glitch, and with it, it is Ada. The connection dot is part
 * of the same story from the other side -- when the socket drops, edits stop arriving,
 * and saying so is better than letting the canvas quietly go stale.
 *
 * Capped at a handful of avatars with a count for the rest. At fifty collaborators the
 * roster stops being a list of people and becomes a number, and pretending otherwise
 * would consume the whole header.
 */
const VISIBLE_AVATARS = 4

export function PresenceBar({
  peers,
  self,
  connected,
}: {
  peers: Peer[]
  self: Collaborator
  connected: boolean
}) {
  /*
    Two collapses in one pass. `dedupeByActor` folds a person's several tabs into one
    entry -- see its own comment for why a roster does that and a cursor does not -- and
    the `self.id` filter removes the specific case that leaves unhandled: *this* person's
    other tabs, which would otherwise sit in `peers` under their own actor id and be drawn
    a second time next to the `self` avatar already rendered below for the same id.
  */
  const others = useMemo(
    () => dedupeByActor(peers.filter((peer) => peer.actor.id !== self.id)),
    [peers, self.id],
  )
  const overflow = Math.max(0, others.length - VISIBLE_AVATARS)

  return (
    <div className="flex items-center gap-2">
      <span
        title={connected ? 'Live' : 'Reconnecting…'}
        aria-label={connected ? 'Connected to the live session' : 'Reconnecting to the live session'}
        className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-amber-500')}
      />

      <div className="flex -space-x-1.5" aria-label={`${others.length + 1} people here`}>
        <PersonAvatar actor={self} isSelf />
        {others.slice(0, VISIBLE_AVATARS).map((peer) => (
          <PersonAvatar key={peer.actor.id} actor={peer.actor} />
        ))}
        {overflow > 0 ? (
          <span className="grid size-6 place-items-center rounded-full border-2 border-background bg-muted text-[10px] font-medium text-muted-foreground">
            +{overflow}
          </span>
        ) : null}
      </div>
    </div>
  )
}
