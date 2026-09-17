import { ChevronRight, CornerLeftUp, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DocumentationNode } from '@/types'

/**
 * Where the canvas currently is, and the way back out.
 *
 * Drilling into a node replaces everything on screen, so without this the user has no
 * way to tell a deep position from the top of the space, and no way up except the browser
 * back button -- which leaves the page rather than the folder. Every ancestor is a
 * target, so climbing four levels is one click rather than four.
 *
 * It is also where a node goes to get *out* of the level it is in. The canvas shows the
 * inside of one node, so there is nowhere on it to drop something meaning "not in here"
 * -- the crumbs are that target, the same way a file manager's path bar is. Each one
 * carries `data-drop-ancestor`, which is how the canvas recognises it mid-drag without
 * either component knowing about the other's state.
 *
 * The trail is one path through what is really a graph: a node can be contained by more
 * than one parent, and the server picks the same one every time (see
 * Documentation::AncestorTrail). Presenting it as *the* path is a simplification, and an
 * honest one -- the other containers are still visible as relationships in the inspector.
 */
export function Breadcrumb({
  spaceName,
  trail,
  focusNode,
  onNavigate,
  onAscend,
}: {
  spaceName: string
  trail: DocumentationNode[]
  focusNode: DocumentationNode | null
  onNavigate: (nodeId: string | null) => void
  onAscend: () => void
}) {
  if (!focusNode) return null

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 overflow-x-auto border-b border-border bg-muted/40 px-3 py-1.5 text-xs"
    >
      <Button variant="ghost" size="sm" onClick={onAscend} className="shrink-0" aria-label="Go up one level">
        <CornerLeftUp className="size-3.5" />
      </Button>

      <Crumb
        icon={<Home className="size-3" aria-hidden />}
        label={spaceName}
        dropId="root"
        onClick={() => onNavigate(null)}
      />

      {trail.map((node) => (
        <Crumb key={node.id} label={node.title} dropId={node.id} onClick={() => onNavigate(node.id)} />
      ))}

      <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />
      <span aria-current="page" className="shrink-0 truncate font-medium">
        {focusNode.title}
      </span>
      <span className="ml-2 shrink-0 font-mono text-[10px] text-muted-foreground">
        {focusNode.childCount ?? 0} inside
      </span>
    </nav>
  )
}

function Crumb({
  icon,
  label,
  dropId,
  onClick,
}: {
  icon?: React.ReactNode
  label: string
  dropId: string
  onClick: () => void
}) {
  return (
    <>
      <ChevronRight className="size-3 shrink-0 text-muted-foreground first:hidden" aria-hidden />
      <button
        type="button"
        onClick={onClick}
        data-drop-ancestor={dropId}
        // `data-drop-active` is set on this element by the canvas while a card is being
        // dragged over it, so the highlight costs no state and no re-render.
        className="inline-flex shrink-0 items-center gap-1 rounded-xs px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none data-[drop-active=true]:bg-brand-100 data-[drop-active=true]:text-brand-700 data-[drop-active=true]:ring-1 data-[drop-active=true]:ring-brand-400"
      >
        {icon}
        <span className="max-w-40 truncate">{label}</span>
      </button>
    </>
  )
}
