import { collaboratorColor } from '@/features/documentation/collaboration/colors'
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
  const overflow = Math.max(0, peers.length - VISIBLE_AVATARS)

  return (
    <div className="flex items-center gap-2">
      <span
        title={connected ? 'Live' : 'Reconnecting…'}
        aria-label={connected ? 'Connected to the live session' : 'Reconnecting to the live session'}
        className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-amber-500')}
      />

      <div className="flex -space-x-1.5" aria-label={`${peers.length + 1} people here`}>
        <Avatar name={self.name} seed={self.colorSeed} title={`${self.name} (you)`} />
        {peers.slice(0, VISIBLE_AVATARS).map((peer) => (
          <Avatar
            key={peer.sessionId}
            name={peer.actor.name}
            seed={peer.actor.colorSeed}
            title={peer.actor.name}
          />
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

function Avatar({ name, seed, title }: { name: string; seed: number; title: string }) {
  return (
    <span
      title={title}
      className="grid size-6 place-items-center rounded-full border-2 border-background text-[10px] font-semibold text-white"
      style={{ backgroundColor: collaboratorColor(seed) }}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
