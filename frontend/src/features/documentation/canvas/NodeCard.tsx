import { Handle, Position } from '@xyflow/react'
import { ArrowUpFromLine, Copy, CornerDownRight, Link2, Pencil, TextCursorInput, Trash2 } from 'lucide-react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { DocumentationNode, NodeParent } from '@/types'

export interface NodeCardActions {
  onDive: (nodeId: string) => void
  onInspect: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onStartLink: (nodeId: string) => void
  onRename: (nodeId: string, title: string) => void
  /** Go to the level a containing node lives on, with that node selected. */
  onGoUp: (parent: NodeParent) => void
  onDuplicate: (nodeId: string) => void
}

/**
 * How the canvas asks a card to start renaming: a DOM event on the card's own element.
 *
 * A message rather than state, because state would have to travel in through `data`, and
 * changing a node's data means handing React Flow a new node object -- which drops its
 * measurements and hides it for a frame. An input that mounts inside a hidden element
 * cannot take the focus, so routing "start renaming" through the node array was the one
 * way of delivering it that broke the thing it was delivering.
 */
export const RENAME_EVENT = 'documentation:rename'

export interface NodeCardData extends Record<string, unknown> {
  node: DocumentationNode
  blockCount: number | null
  actions: NodeCardActions
  /** True while a link is being drawn and this card is a candidate target. */
  linking: boolean
  /**
   * Whether this person may change the graph at all.
   *
   * False hides the toolbar entirely rather than disabling it. A row of greyed-out
   * buttons on every card tells a reader, repeatedly, about things they cannot do; the
   * card without them simply reads as a document.
   */
  editable: boolean
  /** Names of collaborators who are on this node right now. */
  presentEditors: string[]
  /**
   * True while a card is being dragged over this one.
   *
   * The whole feedback for drag-to-nest: without it the gesture is a guess, because
   * nothing else on screen distinguishes "dropped on the canvas at these coordinates"
   * from "dropped into this node", and the two do very different things.
   */
  dropTarget: boolean
}

/**
 * How one node is drawn on the canvas.
 *
 * Kept deliberately thin in content: a title, what kind of thing it is, and where it sits
 * conceptually. It renders no content blocks at all -- the canvas is a map, and a map that
 * tried to show every page of documentation at once would be unreadable at any zoom and
 * would make first paint proportional to how much has been written.
 *
 * It is not thin in *actions*, and that is a deliberate reversal. The things a person
 * does most -- open it, rename it, connect it, delete it -- used to live in a panel on
 * the other side of the screen, which meant every one of them cost a selection, a glance
 * across the window, and a click on a control that was nowhere near the thing it acted
 * on. The buttons now sit on the card and appear on hover or focus, so the pointer never
 * leaves the node being worked on.
 *
 * "Add a node inside this one" is not among them, and its absence is the point. A node's
 * contents are only ever drawn inside it, so adding one from out here produced something
 * the user could not then see -- it landed a level down, on a canvas they were not
 * looking at. Adding happens where the thing will be: open the node, then add.
 *
 * Memoized because React Flow re-renders the node layer on every viewport change, and a
 * space can hold hundreds of these.
 */
export const NodeCard = memo(function NodeCard({
  data,
  selected,
}: {
  data: NodeCardData
  selected?: boolean
}) {
  const { node, blockCount, actions, linking, editable, presentEditors, dropTarget } = data
  const childCount = node.childCount ?? 0
  const parents = node.parents ?? []
  const lineage = describeLineage(parents)

  /*
   * Renaming in place.
   *
   * Retitling is far and away the most common edit, and routing it through the inspector
   * cost a selection, a panel, a form and a save for one word. It cannot be double-click,
   * though -- that is how you go *inside* a node, and a gesture that sometimes navigates
   * and sometimes edits is worse than either one. So it is asked for explicitly: the
   * toolbar button here, or F2 on the selected card, which arrives as RENAME_EVENT
   * because React Flow's wrapper element holds the keyboard focus, not this markup.
   */
  const [renaming, setRenaming] = useState(false)
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Listened for on React Flow's wrapper, because that is the element the canvas can
    // find: it carries the node id and it is what holds the keyboard focus. An event
    // dispatched there would never reach a listener further in, since events travel
    // outwards.
    const element = card.current?.closest('.react-flow__node')
    if (!element || !editable) return

    const start = () => setRenaming(true)
    element.addEventListener(RENAME_EVENT, start)

    return () => element.removeEventListener(RENAME_EVENT, start)
  }, [editable])

  const commitRename = (draft: string) => {
    setRenaming(false)

    const title = draft.trim()
    // An empty title is a slip rather than a request to erase the node's name, and
    // saving an unchanged one would spend a mutation -- and, for a contributor, a
    // proposal that somebody then has to review.
    if (!title || title === node.title) return

    actions.onRename(node.id, title)
  }

  // The 2.5D depth cue, and the only place `z` is interpreted visually.
  //
  // A higher node casts a larger shadow and sits above its neighbours. This is where a
  // Three.js renderer would read the same field as a camera-space coordinate instead --
  // the domain does not change, only this line does.
  const elevated = node.position.z > 0

  return (
    <div
      ref={card}
      className={cn(
        'group/card relative w-60 rounded-sm border bg-card text-card-foreground transition-shadow',
        selected ? 'border-brand-500 ring-1 ring-brand-500' : 'border-border',
        linking ? 'border-dashed border-brand-400' : '',
        dropTarget ? 'border-brand-500 ring-2 ring-brand-400 ring-offset-1' : '',
        elevated ? 'shadow-md' : 'shadow-xs',
      )}
    >
      {/*
        Handles are the drag targets for drawing an edge. Left is where edges arrive,
        right is where they leave, which makes the direction of a relationship legible
        without reading its label.

        Both stay mounted for a reader and are made non-connectable instead. React Flow
        anchors an edge to its endpoints' handles, so unmounting them for someone who
        cannot draw edges would also erase the edges that already exist -- which is the
        one thing a reader most needs to see.
      */}
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={editable}
        className={cn('!size-2 !border-background !bg-muted-foreground', !editable && '!opacity-0')}
        aria-label={`Connect a relationship into ${node.title}`}
      />

      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1">
          {/*
            Up a level, and outside the editable toolbar below on purpose: going to the
            node that contains this one is reading, not writing, and a reader following a
            graph upwards needs it more than an author does.
          */}
          {parents.length > 0 ? <GoUpControl node={node} parents={parents} onGoUp={actions.onGoUp} /> : null}
          {/*
            The card's own sentence about where it sits: "a database of Storefront
            Platform". Faint, because it is context rather than content -- the title below
            is what the card is for -- but it is the line that makes a drilled-in canvas
            legible. Every card on a level shares a parent, so without it the only clue to
            where you are is the breadcrumb at the top of the window, a long way from the
            node being read.
          */}
          <span
            className="truncate text-[10px] leading-tight text-muted-foreground/70"
            title={lineage}
          >
            {lineage}
          </span>
        </span>
      </div>

      <div className="px-2.5 py-2">
        {renaming ? (
          <TitleInput title={node.title} onCommit={commitRename} onCancel={() => setRenaming(false)} />
        ) : (
          <p className="truncate text-sm font-medium leading-tight">{node.title}</p>
        )}
        {node.summary ? (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">{node.summary}</p>
        ) : null}

        <div className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          {blockCount !== null && blockCount > 0 ? (
            <span>
              {blockCount} {blockCount === 1 ? 'block' : 'blocks'}
            </span>
          ) : null}
          {childCount > 0 ? (
            <button
              type="button"
              // The dive affordance sits on the count itself: the number of things inside
              // and the way in are the same fact, so they are the same control.
              onClick={(event) => {
                event.stopPropagation()
                actions.onDive(node.id)
              }}
              className="inline-flex items-center gap-1 rounded-xs px-1 text-brand-600 hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              aria-label={`Open ${node.title}, containing ${childCount} ${childCount === 1 ? 'node' : 'nodes'}`}
            >
              <CornerDownRight className="size-3" aria-hidden />
              {childCount} inside
            </button>
          ) : null}
        </div>
      </div>

      {presentEditors.length > 0 ? (
        <div
          className="absolute -top-2 -right-1 flex -space-x-1"
          aria-label={`${presentEditors.join(', ')} ${presentEditors.length === 1 ? 'is' : 'are'} here`}
        >
          {presentEditors.slice(0, 3).map((name) => (
            <span
              key={name}
              title={name}
              className="grid size-4 place-items-center rounded-full border border-background bg-brand-500 text-[8px] font-semibold text-white"
            >
              {name.charAt(0).toUpperCase()}
            </span>
          ))}
        </div>
      ) : null}

      {/*
        Revealed on hover and on keyboard focus, never on selection alone: a toolbar that
        appeared on select would cover the neighbouring card the moment someone clicked
        this one.
      */}
      <div
        className={cn(
          'absolute -bottom-3 left-1/2 hidden -translate-x-1/2 gap-0.5 rounded-sm border border-border bg-popover p-0.5 shadow-sm',
          editable && 'group-hover/card:flex group-focus-within/card:flex',
        )}
      >
        <QuickAction label={`Open ${node.title}`} onClick={() => actions.onDive(node.id)}>
          <CornerDownRight className="size-3" />
        </QuickAction>
        <QuickAction label={`Connect ${node.title} to another node`} onClick={() => actions.onStartLink(node.id)}>
          <Link2 className="size-3" />
        </QuickAction>
        <QuickAction label={`Rename ${node.title}`} onClick={() => setRenaming(true)}>
          <TextCursorInput className="size-3" />
        </QuickAction>
        <QuickAction label={`Duplicate ${node.title}`} onClick={() => actions.onDuplicate(node.id)}>
          <Copy className="size-3" />
        </QuickAction>
        <QuickAction label={`Edit ${node.title}`} onClick={() => actions.onInspect(node.id)}>
          <Pencil className="size-3" />
        </QuickAction>
        <QuickAction label={`Delete ${node.title}`} destructive onClick={() => actions.onDelete(node.id)}>
          <Trash2 className="size-3" />
        </QuickAction>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        isConnectable={editable}
        className={cn('!size-2 !border-background !bg-muted-foreground', !editable && '!opacity-0')}
        aria-label={`Draw a relationship from ${node.title}`}
      />
    </div>
  )
})

/**
 * "inside Storefront Platform", or "at the top of the space".
 *
 * Answers "where does this node sit" in one short line. Further parents are counted
 * rather than named -- a node inside three systems has no single primary one.
 */
function describeLineage(parents: NodeParent[]): string {
  const first = parents[0]
  if (!first) return 'at the top of the space'
  const others = parents.length - 1
  return `in ${first.title}${others > 0 ? ` +${others}` : ''}`
}

/**
 * The way out of a node: up to whatever contains it.
 *
 * One parent is one click. Several is a list, and that case is not an edge case to be
 * rounded away -- containment is many-to-many precisely so that a `users` table can sit
 * inside both Identity and Billing, and a control that silently picked one of them would
 * teach the reader a hierarchy that does not exist. So when there is a choice it is
 * shown, named, and left to the person.
 */
function GoUpControl({
  node,
  parents,
  onGoUp,
}: {
  node: DocumentationNode
  parents: NodeParent[]
  onGoUp: (parent: NodeParent) => void
}) {
  const [open, setOpen] = useState(false)
  const single = parents.length === 1 ? parents[0] : null

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        aria-label={
          single
            ? `Go up to ${single.title}`
            : `${node.title} is inside ${parents.length} nodes. Choose one to go up to.`
        }
        title={single ? `Up to ${single.title}` : `Inside ${parents.length} nodes`}
        aria-expanded={single ? undefined : open}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          if (single) onGoUp(single)
          else setOpen((current) => !current)
        }}
        className="inline-flex items-center gap-0.5 rounded-xs px-0.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ArrowUpFromLine className="size-3" aria-hidden />
      </button>

      {open && !single ? (
        // Dismissed on blur rather than on an outside click: the panel lives inside a
        // transformed canvas, and a document-level listener there would also have to
        // decide what a click on another card means. Losing the focus is the same intent.
        <span
          className="nodrag absolute top-full left-0 z-10 mt-1 flex w-44 flex-col rounded-sm border border-border bg-popover p-0.5 shadow-md"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
          }}
        >
          <span className="px-1.5 py-1 text-[10px] text-muted-foreground">Also lives inside</span>
          {parents.map((parent) => (
            <button
              key={parent.id}
              type="button"
              autoFocus={parent.id === parents[0]?.id}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                setOpen(false)
                onGoUp(parent)
              }}
              className="truncate rounded-xs px-1.5 py-1 text-left text-xs hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
            >
              {parent.title}
            </button>
          ))}
        </span>
      ) : null}
    </span>
  )
}

/**
 * The title, editable in place.
 *
 * Its own component, and that is what makes "start typing and replace the title" work.
 * The draft is initialised at mount, so the input's first painted frame already holds the
 * right text and `select()` on focus has something correct to select. Held in the card
 * instead, the draft arrived a render *after* the input appeared, and updating a
 * controlled input's value collapses the selection to the end of the text -- so the
 * highlight vanished the moment it was set and the user typed onto the end of the old
 * title. Mounting fresh per rename also means there is no stale draft to clear.
 */
function TitleInput({
  title,
  onCommit,
  onCancel,
}: {
  title: string
  onCommit: (draft: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(title)

  /*
   * Focused and selected the instant the input exists, from a ref callback.
   *
   * The rename is already a deliberate act -- a button press or F2 -- so nothing further
   * should be required before the user can type. Landing the caret is not enough: without
   * the selection they would have to reach for the mouse again to clear a title they have
   * already decided to replace.
   *
   * This only works because starting a rename no longer re-creates the React Flow node.
   * It used to, and React Flow hides a node until it has re-measured it -- `focus()` on an
   * element inside a `visibility: hidden` subtree is silently ignored, which left the text
   * selected, the caret nowhere, and the first keystroke going to the page.
   */
  const focusAndSelect = useCallback((element: HTMLInputElement | null) => {
    element?.focus({ preventScroll: true })
    element?.select()
  }, [])

  return (
    /*
      `nodrag` is what lets the pointer select text in here: without it React Flow treats
      a press inside the card as the start of a drag and the caret never lands. Key events
      are stopped for the same reason -- arrow keys and Backspace are canvas commands, and
      typing a title should not move or delete the node.
    */
    <input
      ref={focusAndSelect}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') onCommit(draft)
        if (event.key === 'Escape') onCancel()
      }}
      onBlur={() => onCommit(draft)}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      aria-label={`Rename ${title}`}
      className="nodrag w-full rounded-xs border border-input bg-background px-1 py-0.5 text-sm font-medium leading-tight focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
    />
  )
}

function QuickAction({
  label,
  destructive,
  onClick,
  children,
}: {
  label: string
  destructive?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // `stopPropagation` on pointer-down as well as click: React Flow starts a drag on
      // pointer-down, so without it pressing a button would begin dragging the card.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className={cn(
        'grid size-6 place-items-center rounded-xs text-muted-foreground hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none',
        destructive ? 'hover:text-destructive' : 'hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}
