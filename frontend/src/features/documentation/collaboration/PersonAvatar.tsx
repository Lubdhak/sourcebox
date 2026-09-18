import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { collaboratorColor } from '@/features/documentation/collaboration/colors'
import { ROLE_LABELS } from '@/features/documentation/roles'
import { cn } from '@/lib/utils'
import type { Collaborator } from '@/types'

/**
 * One person's face, wherever presence is shown: the header bar, a node's own roster.
 *
 * The photo when there is one, the coloured initial when there is not -- and either way,
 * hovering (or, since the trigger is a real button, tabbing to it) opens `PersonCard`,
 * which is where the name, address and role that do not fit inside a circle actually
 * live. One component so a face looks and behaves the same whichever list it is read
 * from, and so a future third list is a call site rather than a second implementation.
 */
export function PersonAvatar({
  actor,
  isSelf = false,
  size = 'sm',
}: {
  actor: Collaborator
  isSelf?: boolean
  size?: 'sm' | 'xs'
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        className={cn(
          'grid shrink-0 place-items-center overflow-hidden rounded-full border-2 border-background font-semibold text-white outline-none',
          size === 'sm' ? 'size-6 text-[10px]' : 'size-5 text-[9px]',
        )}
        style={actor.avatarUrl ? undefined : { backgroundColor: collaboratorColor(actor.colorSeed) }}
      >
        {actor.avatarUrl ? (
          <img src={actor.avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          actor.name.charAt(0).toUpperCase()
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" className="p-0">
        <PersonCard actor={actor} isSelf={isSelf} />
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The face in full: photo, name, address, and what this person may do here. The role
 * reads as a sentence rather than a badge for the same reason `AppSidebar`'s account card
 * does -- it is a fact about the space, not about the person, and a chip beside an email
 * address reads as the opposite.
 */
function PersonCard({ actor, isSelf }: { actor: Collaborator; isSelf: boolean }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-left">
      <span
        className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-semibold text-white"
        style={actor.avatarUrl ? undefined : { backgroundColor: collaboratorColor(actor.colorSeed) }}
      >
        {actor.avatarUrl ? (
          <img src={actor.avatarUrl} alt="" className="size-full object-cover" />
        ) : (
          actor.name.charAt(0).toUpperCase()
        )}
      </span>
      <span className="grid min-w-0 gap-0.5 leading-tight">
        <span className="truncate text-xs font-medium">
          {actor.name}
          {isSelf ? ' (you)' : ''}
        </span>
        <span className="truncate text-[11px] opacity-80">{actor.email}</span>
        {actor.role ? (
          <span className="truncate text-[11px] opacity-80">{ROLE_LABELS[actor.role]} in this space</span>
        ) : null}
      </span>
    </div>
  )
}
