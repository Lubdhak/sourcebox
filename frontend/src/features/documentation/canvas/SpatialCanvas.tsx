import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ViewportPortal,
  applyNodeChanges,
  type Edge,
  type Node as FlowNode,
  type NodeChange,
  type OnConnect,
  type ReactFlowInstance,
} from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import {
  NeighborCard,
  neighborStroke,
  type NeighborCardData,
  type NeighborTone,
} from '@/features/documentation/canvas/NeighborCard'
import {
  NodeCard,
  RENAME_EVENT,
  type NodeCardActions,
  type NodeCardData,
} from '@/features/documentation/canvas/NodeCard'
import type { Peer } from '@/features/documentation/collaboration/useSpaceChannel'
import { collaboratorColor } from '@/features/documentation/collaboration/colors'
import { isDisconnected } from '@/features/documentation/disconnected'
import { readingOrder } from '@/features/documentation/readingOrder'
import type { DocumentationNode, NodeParent, NodeRelationship, SpatialPosition } from '@/types'

import '@xyflow/react/dist/style.css'

/**
 * The spatial view over the graph.
 *
 * Why React Flow rather than hand-rolled SVG: pan and zoom with correct coordinate
 * transforms, edge routing, drag with pointer capture, viewport culling, and a keyboard
 * and ARIA model for a canvas are each individually more subtle than they look, and
 * together they are the bulk of a custom implementation. None of that is domain logic, so
 * it is worth a dependency.
 *
 * Why it is only a *view*: this component owns nothing but React Flow's transient state
 * -- the viewport transform, the positions a drag is currently producing, and which node
 * a link is being drawn from. Every durable fact comes in as a prop and every change goes
 * out as a callback. That is what makes replacing it with a WebGL renderer a local
 * change: the domain model has no idea which renderer is reading it.
 */

// Module-level, not inline. React Flow warns and remounts every node when this object
// changes identity, which an inline literal does on every render.
const nodeTypes = { documentation: NodeCard, neighbor: NeighborCard }

const GRID_SIZE = 16

/*
 * Module-level empties for the optional list props.
 *
 * `= []` in the parameter list would allocate a new array on every render, and these feed
 * the memos that build the React Flow node array -- so a caller that left one out would
 * make that array rebuild forever, each render scheduling the next. The identity of an
 * empty list has to be as stable as the identity of a full one.
 */
const NO_NODES: DocumentationNode[] = []
const NO_PEERS: Peer[] = []

/**
 * What each arrow key points at.
 *
 * Read twice, for the two things the arrows do. Held with Shift it is a direction, and
 * the card under the cursor moves one grid step along it. On its own only the sign is
 * used: forward through the level for the two keys that point right and down, back for
 * the two that point left and up.
 */
const ARROW_STEPS: Record<string, { dx: number; dy: number }> = {
  ArrowRight: { dx: 1, dy: 0 },
  ArrowDown: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
}

/**
 * A card on this level, or a ghost of one that lives on another.
 *
 * They are one React Flow collection rather than two because edges only render between
 * nodes the renderer knows about, and the whole point of a ghost is to be the far end of
 * an edge. They stay two distinct data shapes because nothing else about them is alike:
 * a ghost has no position anyone chose, cannot be dragged, selected or edited, and is
 * not part of what this level contains.
 */
type CanvasNode = FlowNode<NodeCardData, 'documentation'> | FlowNode<NeighborCardData, 'neighbor'>

/**
 * Where a dragged card would be filed if it were let go now.
 *
 * `nodeId` is the new parent, and null is the top of the space -- the same shape the
 * reparent callback takes, so the drop is handed on without being reinterpreted.
 * `element` is kept only for breadcrumb targets, whose highlight is applied to the DOM
 * node directly.
 */
type DropTarget = {
  kind: 'node' | 'ancestor'
  nodeId: string | null
  element: HTMLElement | null
}

/**
 * Where the pointer is, from either kind of drag event.
 *
 * React Flow reports a drag as a mouse or a touch event, and a touch that has just ended
 * has moved from `touches` to `changedTouches` -- which is exactly the event a drop is
 * decided on, so missing that case would make drag-to-nest work with a mouse and
 * silently not with a finger.
 */
function pointerOf(event: MouseEvent | TouchEvent): { clientX: number; clientY: number } | null {
  if ('clientX' in event) return { clientX: event.clientX, clientY: event.clientY }

  const touch = event.touches[0] ?? event.changedTouches[0]

  return touch ? { clientX: touch.clientX, clientY: touch.clientY } : null
}

/** Where the row of off-level neighbours is drawn, relative to the level's own bounds. */
const NEIGHBOR_ROW_GAP = 220
const NEIGHBOR_COLUMN_WIDTH = 200

/**
 * How long the camera takes to settle after diving into a node or coming back up.
 *
 * The animation is not decoration. Drilling in replaces every node on screen at once,
 * and a cut leaves no clue whether the user went deeper, went up, or landed somewhere
 * else entirely. Moving the camera to the new contents preserves the sense that the
 * space persisted and they moved through it -- the same reason a file manager slides
 * rather than blinks. Short enough not to be waited on.
 */
const DIVE_ANIMATION_MS = 420

/**
 * How long a click on a card waits before it opens the inspector.
 *
 * A double-click is delivered as two clicks and then a `dblclick`, so the gesture that
 * dives into a node necessarily passes through the one that selects it. Acting on the
 * first click immediately meant every dive flashed the inspector open and shut: the panel
 * mounted and began its slide-in, and the dive cleared the selection a moment later.
 *
 * So the selection is held for long enough to find out which gesture this was. Nothing
 * visible waits on it -- React Flow marks the card selected from its own store on
 * pointer-down, so the ring still appears at once -- which leaves only the panel, and a
 * panel that takes a quarter-second to arrive reads as it opening rather than as lag.
 */
const SELECT_ON_CLICK_DELAY_MS = 250

/**
 * Imperative handle exposed to the parent via a ref.
 *
 * Kept intentionally minimal: only the things the parent genuinely cannot compute
 * without reaching into the canvas (viewport-to-flow coordinate conversion).
 */
export interface SpatialCanvasHandle {
  /**
   * Returns the flow coordinate at the visual centre of the canvas container.
   * Used so the toolbar "Add node" button places new nodes where the user is looking,
   * not at the graph origin.
   */
  getViewportCenter(): { x: number; y: number; z: number }
  /**
   * Put the keyboard back on the canvas.
   *
   * For the page to call when it closes something that was holding the focus. The
   * inspector's close button leaves the DOM with the panel it is in, and the browser's
   * answer to that is to drop the focus onto the body -- where the next arrow key reaches
   * nothing and the user has to click the canvas before it answers again.
   */
  focus(): void
}

export interface SpatialCanvasProps {
  nodes: DocumentationNode[]
  relationships: NodeRelationship[]
  /**
   * Nodes on other levels that something here connects to.
   *
   * Drawn as ghosts above the level. Deliberately not merged into `nodes`: they are the
   * far ends of edges that leave this level, not part of what it holds.
   */
  neighbors?: DocumentationNode[]
  selectedNodeId: string | null
  /**
   * The node whose contents are on screen, or null at the top of the space.
   *
   * Needed because every write that moves a node has to name the containment it is
   * leaving: a node filed in two places dragged out of one must stay in the other, and
   * this is the one that was on screen.
   */
  focusNodeId?: string | null
  /** Changes whenever the canvas descends or ascends, which is what triggers the camera move. */
  focusKey: string
  /**
   * Whether this person may change the graph.
   *
   * Drives dragging, linking, the card toolbars and node creation together, because
   * they are one question asked five times. Viewers keep everything that is navigation
   * -- pan, zoom, select, dive -- and lose everything that is a write.
   */
  editable?: boolean
  blockCounts?: Record<string, number>
  peers?: Peer[]
  onSelectNode: (nodeId: string | null) => void
  onMoveNode: (nodeId: string, position: SpatialPosition) => void
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void
  onCreateNodeAt?: (position: SpatialPosition) => void
  /**
   * Add a node wherever the page thinks best. Bound to `n`.
   *
   * Deliberately without a position, unlike `onCreateNodeAt`: a double-click names the
   * spot it happened on, and a keystroke has no spot. Where an unplaced node should land
   * -- the middle of the view, nudged off the last one so a run of them does not stack --
   * is the page's policy, and it already applies it to the toolbar button.
   */
  onCreateNode?: () => void
  onDeleteRelationship?: (relationshipId: string) => void
  /**
   * Open a node: the canvas redraws with what it contains.
   *
   * Nothing is asked of the caller about arrival. The canvas puts its own keyboard cursor
   * on the first card of the level it lands on, which is what continues a keyboard run --
   * the selection used to do that job, and it dragged the inspector open over the canvas
   * the user had just navigated into.
   */
  onDive: (nodeId: string) => void
  /** Leave this level for the one above. Bound to Escape as well as the breadcrumb. */
  onAscend?: () => void
  onDeleteNode: (nodeId: string) => void
  onRenameNode?: (nodeId: string, title: string) => void
  onDuplicateNode?: (nodeId: string) => void
  /**
   * Called when the user has drag-selected (or Ctrl-clicked) several nodes and
   * triggered a bulk delete. The caller is responsible for the confirmation dialog.
   */
  onDeleteNodes?: (nodeIds: string[]) => void
  /**
   * The id of a node that should immediately enter inline rename mode once React Flow
   * has measured and shown its card. Set when a node is freshly created, so the user
   * can type its name without opening the inspector.
   */
  autoRenameNodeId?: string | null
  /** Called once the auto-rename has been triggered, so the caller can clear the id. */
  onAutoRenameStarted?: () => void
  /**
   * Width of the inspector panel in pixels (0 when closed).
   * Used to offset the pan-to-selected animation so the node lands in the centre of
   * the visible canvas rather than behind the panel.
   */
  inspectorWidth?: number
  /**
   * File a node somewhere else: inside the node it was dropped on, or out to the ancestor
   * whose breadcrumb it was dropped on. Null means the top of the space.
   */
  onReparentNode?: (nodeId: string, newParentNodeId: string | null) => void
  /** Leave this level for the one a neighbour lives on. */
  onOpenNeighbor?: (node: DocumentationNode) => void
  /** Go to the level a containing node lives on. Navigation only: nothing is selected. */
  onGoUp?: (parent: NodeParent) => void
  onPointerPosition?: (position: { x: number; y: number }) => void
}

export const SpatialCanvas = forwardRef<SpatialCanvasHandle, SpatialCanvasProps>(function SpatialCanvas({
  nodes,
  relationships,
  neighbors = NO_NODES,
  selectedNodeId,
  focusNodeId = null,
  focusKey,
  editable = true,
  blockCounts,
  peers = NO_PEERS,
  onSelectNode,
  onMoveNode,
  onConnectNodes,
  onCreateNodeAt,
  onCreateNode,
  onDeleteRelationship,
  onDive,
  onAscend,
  onDeleteNode,
  onRenameNode,
  onDuplicateNode,
  onDeleteNodes,
  autoRenameNodeId = null,
  onAutoRenameStarted,
  inspectorWidth = 0,
  onReparentNode,
  onOpenNeighbor,
  onGoUp,
  onPointerPosition,
}: SpatialCanvasProps, ref) {
  const instance = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Always up-to-date nodes without being a dep of the selection effect.
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes

  // Whether the inspector was open on the *previous* selection, to detect open vs already-open.
  const inspectorWasOpenRef = useRef(false)

  /**
   * Exposes the viewport centre in flow coordinates so the parent can place new nodes
   * where the user is looking rather than at the graph origin.
   */
  useImperativeHandle(ref, () => ({
    getViewportCenter() {
      if (!instance.current || !containerRef.current) return { x: 0, y: 0, z: 0 }
      const rect = containerRef.current.getBoundingClientRect()
      const center = instance.current.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
      return { x: center.x, y: center.y, z: 0 }
    },
    focus() {
      containerRef.current?.focus({ preventScroll: true })
    },
  }))

  /*
   * Pan to the selected node without touching the zoom.
   *
   * Both happen in the same 350 ms ease as the inspector sliding in, so the node drifts
   * toward the centre of the narrower canvas at exactly the rate the panel claims the
   * space on the right. The pan is triggered by `selectedNodeId` changing, not by any
   * node position update, so drags and collaborator edits do not interrupt reading.
   *
   * Offset maths: when the inspector is OPENING (was closed before this click), React
   * Flow still thinks the canvas is full-width because its ResizeObserver fires after the
   * CSS transition starts. `setCenter(cx, cy)` would therefore target the midpoint of the
   * OLD width, placing the node behind the panel once it opens. Subtracting half the
   * inspector width (in flow-space) from the x target corrects this so the node lands in
   * the centre of the VISIBLE canvas. When the inspector was already open, React Flow
   * already knows the narrower width and no correction is needed.
   */
  useEffect(() => {
    if (!selectedNodeId) {
      inspectorWasOpenRef.current = false
      return
    }

    const isOpening = !inspectorWasOpenRef.current
    inspectorWasOpenRef.current = true

    const node = nodesRef.current.find((n) => n.id === selectedNodeId)
    if (!node) return

    const cx = node.position.x + (node.size?.width ?? 240) / 2
    const cy = node.position.y + (node.size?.height ?? 120) / 2

    const frame = requestAnimationFrame(() => {
      if (!instance.current) return
      const zoom = instance.current.getZoom()
      // Only apply the offset when the panel is transitioning from closed to open.
      // Inspector sits on the RIGHT. To center the node in the VISIBLE canvas we need
      // to shift the pan target RIGHT in flow-space (cx + offset) so the canvas scrolls
      // LEFT, revealing the node to the left of the panel.
      const panelOffset = isOpening ? inspectorWidth / 2 / zoom : 0
      instance.current.setCenter(cx + panelOffset, cy, { zoom, duration: 350 })
    })

    return () => cancelAnimationFrame(frame)
  }, [selectedNodeId, inspectorWidth])

  /**
   * Where the keyboard is on this level.
   *
   * A second marker beside the selection, and the reason for it is what selecting costs:
   * the selection opens the inspector, fetches the node's page and pans the canvas to
   * clear the panel. That is right for "show me this" and wrong for "next", so walking a
   * level of forty cards would have meant forty page loads behind a panel covering the
   * map being walked. The cursor is free: a ring on a card and nothing else.
   *
   * It is one anchor for both hands, which is what makes picking one up mid-gesture work.
   * Clicking, tabbing or dragging a card moves the cursor to it, so an arrow key always
   * continues from whatever the user last touched rather than from wherever the keyboard
   * had got to before they reached for the mouse.
   *
   * Not cleared by a click on empty canvas. That gesture means "nothing is selected" --
   * it closes the inspector -- and the keyboard's place is not the selection. Losing it
   * there would send the next arrow key back to the first card of the level.
   */
  const [cursorId, setCursorId] = useState<string | null>(null)

  /**
   * Where the cursor should land on the level being navigated to.
   *
   * Set as a level is left, read once its cards arrive, because the two happen in that
   * order and the id has to outlive the level it was decided on. `'first'` is a dive --
   * there is no previous position inside a node nobody has opened -- and an id is the way
   * back out, which lands on the node just left, as a file manager does.
   *
   * Null means the level was left by some other route: a double-click, a breadcrumb, a
   * ghost card. Those are all the mouse, and the mouse does not want a cursor placed.
   */
  const arrival = useRef<{ want: 'first' | string } | null>(null)

  /** The level the cursor currently belongs to, so a *change* of level can be told. */
  const cursorLevel = useRef(focusKey)

  /**
   * Cards, in the order the arrow keys walk them.
   *
   * One cycle for all four arrows rather than a hit test per direction: cards sit where a
   * person dropped them, so "the node to the right" is frequently nothing at all, and a
   * key that does nothing on a canvas with forty cards on it reads as broken. A cycle
   * reaches every card on the level from every other one, and taking it in reading order
   * -- rows down the screen, left to right -- keeps each step next to the last one on
   * screen. Right and Down go forward, Left and Up back.
   */
  const order = useMemo(() => readingOrder(nodes), [nodes])

  /*
   * The cursor follows the selection, so the mouse hands over to the keyboard.
   *
   * Only ever onto something: clearing the selection -- closing the inspector, clicking
   * the canvas -- says nothing about where the keyboard is.
   */
  useEffect(() => {
    if (selectedNodeId) setCursorId(selectedNodeId)
  }, [selectedNodeId])

  /*
   * Land the cursor on arrival, or drop it.
   *
   * `focusKey` and the new level's cards appear in the same render -- the graph state sets
   * both from one response -- so by the time this runs, `order` is the level being
   * arrived at. With nothing requested the cursor is dropped rather than carried: the id
   * it held belongs to a level that is no longer on screen.
   */
  useEffect(() => {
    // Including the first run, where there is a level but nobody has gone anywhere. The
    // cursor may already have been placed by the initial selection, and this must not
    // take it away again.
    if (cursorLevel.current === focusKey) return

    cursorLevel.current = focusKey

    const requested = arrival.current
    arrival.current = null

    if (!requested) {
      setCursorId(null)
      return
    }

    const cards = readingOrder(nodesRef.current)
    const wanted =
      requested.want === 'first'
        ? cards[0]
        : cards.find((node) => node.id === requested.want) ?? cards[0]

    setCursorId(wanted?.id ?? null)
    // `order` is deliberately not a dependency: this is about arriving somewhere, not
    // about the cards on the level changing while the user is there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])

  /**
   * The cursor, said out loud.
   *
   * The arrow keys move a ring on a canvas, which is nothing at all to a screen reader,
   * and they deliberately do not move the focus -- a card outside the viewport is not in
   * the DOM to be focused, and one that is can be culled the moment the canvas pans,
   * dropping the focus and with it the next keystroke. So the position is announced
   * instead, with the count, which is also the only way to tell that the cycle has come
   * round.
   */
  const cursorAnnouncement = useMemo(() => {
    const index = order.findIndex((node) => node.id === cursorId)
    const node = index < 0 ? null : order[index]

    return node ? `${node.title}, ${index + 1} of ${order.length}` : ''
  }, [cursorId, order])

  /**
   * Bring a card into view, if it is not already.
   *
   * Only when it is off screen, because panning on every step would mean the canvas
   * sliding under the reader while they walk a row of cards they can already see. Off
   * screen it is not optional: `onlyRenderVisibleElements` means a card outside the
   * viewport is not in the DOM at all, so a cursor there would be invisible rather than
   * merely out of frame.
   */
  const revealNode = useCallback((node: DocumentationNode) => {
    const flow = instance.current
    const container = containerRef.current
    if (!flow || !container) return

    const width = node.size?.width ?? 240
    const height = node.size?.height ?? 120
    const rect = container.getBoundingClientRect()
    const topLeft = flow.flowToScreenPosition({ x: node.position.x, y: node.position.y })
    const bottomRight = flow.flowToScreenPosition({
      x: node.position.x + width,
      y: node.position.y + height,
    })

    // A margin, so a card that is merely touching the edge is still brought in: half of
    // one hanging off the side is legible but reads as the end of the canvas.
    const margin = 32
    const visible =
      topLeft.x >= rect.left + margin &&
      topLeft.y >= rect.top + margin &&
      bottomRight.x <= rect.right - margin &&
      bottomRight.y <= rect.bottom - margin

    if (visible) return

    flow.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: flow.getZoom(),
      duration: 180,
    })
  }, [])

  /**
   * One step along the cycle.
   *
   * A cursor that is no longer on the level -- its card deleted, or the level changed
   * under it -- is treated as no cursor, so the step starts from the near end: the first
   * card going forward, the last going back. That is also what the first arrow key of a
   * session does, which is the same situation described a different way.
   */
  const stepCursor = useCallback(
    (delta: 1 | -1) => {
      if (order.length === 0) return

      const from = order.findIndex((node) => node.id === cursorId)
      const next =
        from < 0
          ? order[delta === 1 ? 0 : order.length - 1]
          : order[(from + delta + order.length) % order.length]

      if (!next) return

      setCursorId(next.id)
      revealNode(next)
    },
    [cursorId, order, revealNode],
  )

  /**
   * Click-to-connect, as an alternative to dragging between handles.
   *
   * Dragging a two-pixel handle across a zoomed-out canvas to another two-pixel handle is
   * precise work, and it is the one gesture people reliably fail at here. Picking the
   * source from the card's own toolbar and then clicking the target asks for no accuracy
   * at all.
   */
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null)

  /**
   * IDs of all nodes currently selected by the drag-selection rect or Ctrl/Meta+click.
   *
   * Kept separately from `selectedNodeId` (which drives the inspector) so that an area
   * selection can include many nodes without opening multiple panels. When the count
   * exceeds one, a floating action bar appears offering bulk operations.
   */
  const [multiSelectedIds, setMultiSelectedIds] = useState<ReadonlySet<string>>(new Set())

  /**
   * Read inside the flow-node sync without being one of its dependencies: the sync must
   * not re-run merely because the selection count changed, or it would write to the
   * store that produced the selection.
   */
  const multiSelectActiveRef = useRef(false)
  multiSelectActiveRef.current = multiSelectedIds.size > 1

  /**
   * Tracks the area selection without feeding a render loop.
   *
   * React Flow calls this on every store update, so building a fresh Set each time would
   * change state identity on every call -- which re-renders, which rebuilds the flow-node
   * array, which updates the store, which calls this again. The ids are compared by
   * content and the previous Set returned unchanged when nothing moved, so the cycle
   * terminates. Nothing here writes back into React Flow's store, for the same reason.
   */
  const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: CanvasNode[] }) => {
    const ids = selected.filter((node) => node.type === 'documentation').map((node) => node.id)

    setMultiSelectedIds((current) => {
      if (current.size === ids.length && ids.every((id) => current.has(id))) return current

      return new Set(ids)
    })
  }, [])

  /*
   * An area selection describes many nodes, so the single-node inspector is closed.
   *
   * Done here rather than inside the selection callback: writing the parent's selection
   * state from within React Flow's own change callback re-enters its store and loops.
   * The `selectedNodeId` guard means this fires once per selection, not once per render.
   */
  useEffect(() => {
    if (multiSelectedIds.size > 1 && selectedNodeId) onSelectNode(null)
  }, [multiSelectedIds, onSelectNode, selectedNodeId])

  // Which collaborators are sitting on which node, so a card can say who is there. Built
  // once per presence change rather than per card.
  const editorsByNode = useMemo(() => {
    const map = new Map<string, string[]>()

    for (const peer of peers) {
      const nodeId = peer.selectedNodeId
      if (!nodeId) continue
      map.set(nodeId, [...(map.get(nodeId) ?? []), peer.actor.name])
    }

    return map
  }, [peers])

  /**
   * Everyone whose attention is on a node right now, counting the level below.
   *
   * Wider than `editorsByNode` on purpose: a colleague who has dived *into* a node is
   * reading it as surely as one who has its page open, and from out here they would
   * otherwise vanish -- their level is not on screen, so nothing would show them at all.
   * Both collapse onto the one card that is: the node they are in.
   *
   * Deduplicated by session, because diving with the keyboard also selects on arrival,
   * which would otherwise count one person twice.
   */
  const readersByNode = useMemo(() => {
    const map = new Map<string, Map<string, string>>()

    for (const peer of peers) {
      for (const nodeId of new Set([peer.selectedNodeId, peer.focusNodeId])) {
        if (!nodeId) continue

        const readers = map.get(nodeId) ?? new Map<string, string>()
        readers.set(peer.sessionId, peer.actor.name)
        map.set(nodeId, readers)
      }
    }

    return map
  }, [peers])

  const actions = useMemo<NodeCardActions>(
    () => ({
      onDive,
      onInspect: onSelectNode,
      onDelete: onDeleteNode,
      onStartLink: (nodeId) => setLinkingFrom((current) => (current === nodeId ? null : nodeId)),
      onRename: (nodeId, title) => onRenameNode?.(nodeId, title),
      onGoUp: (parent) => onGoUp?.(parent),
      onDuplicate: (nodeId) => onDuplicateNode?.(nodeId),
    }),
    [onDeleteNode, onDive, onDuplicateNode, onGoUp, onRenameNode, onSelectNode],
  )

  /**
   * Where the card currently being dragged would land if it were dropped.
   *
   * Two kinds of destination, because there are two directions to go. A card dropped on
   * another card goes *inside* it, which is the gesture people already know from every
   * file manager. Going back out has no such target on screen -- this level is the inside
   * of one node, so there is no "outside" to drop onto -- so the breadcrumb serves as it,
   * exactly as a file manager's path bar does. Dropping on empty canvas keeps its
   * original meaning of moving the card to those coordinates, which is why neither
   * gesture had to take it over.
   */
  const [drop, setDrop] = useState<DropTarget | null>(null)
  // Read by the position handler, which has to know a drop happened *before* React has
  // re-rendered with it.
  const dropRef = useRef<DropTarget | null>(null)

  /**
   * Without layer depths, all neighbors are "related but off-level" — we do not know
   * if they are above or below, so we use a neutral tone.
   */
  const toneFor = useCallback(
    (_node: DocumentationNode): NeighborTone => 'unknown',
    [],
  )

  // Which verbs tie each off-level node to this one, so a ghost can say why it is there
  // rather than just that it is.
  const verbsByNeighbor = useMemo(() => {
    const onLevel = new Set(nodes.map((node) => node.id))
    const map = new Map<string, string[]>()

    for (const relationship of relationships) {
      const outside = onLevel.has(relationship.sourceNodeId)
        ? relationship.targetNodeId
        : relationship.sourceNodeId

      if (onLevel.has(outside)) continue

      const verbs = map.get(outside) ?? []
      if (!verbs.includes(relationship.relationshipType)) verbs.push(relationship.relationshipType)
      map.set(outside, verbs)
    }

    return map
  }, [nodes, relationships])

  /**
   * Every node with an edge drawn on this canvas right now.
   *
   * Used only to *un*-mark a node the server counted as connected to nothing, never to
   * mark one: this is one level's slice of the edges, so a node absent from it may simply
   * connect to something off screen. The case it exists for is the edge just drawn --
   * connecting two nodes adds the edge to the canvas without refetching the nodes, so the
   * count the cards are holding is a moment out of date, and a card would otherwise stay
   * greyed as unconnected immediately after being connected.
   */
  const connectedOnLevel = useMemo(() => {
    const ids = new Set<string>()

    for (const relationship of relationships) {
      ids.add(relationship.sourceNodeId)
      ids.add(relationship.targetNodeId)
    }

    return ids
  }, [relationships])

  const toFlowNodes = useCallback(
    (source: DocumentationNode[]): CanvasNode[] => {
      const cards: CanvasNode[] = source.map((node) => ({
        id: node.id,
        type: 'documentation' as const,
        position: { x: node.position.x, y: node.position.y },
        // `z` becomes stacking order. The renderer flattens the third dimension; the
        // domain keeps it.
        zIndex: Math.round(node.position.z),
        selected: node.id === selectedNodeId,
        data: {
          node,
          blockCount: blockCounts?.[node.id] ?? null,
          actions,
          linking: linkingFrom !== null && linkingFrom !== node.id,
          editable,
          presentEditors: editorsByNode.get(node.id) ?? [],
          readers: [...(readersByNode.get(node.id)?.values() ?? [])],
          dropTarget: drop?.kind === 'node' && drop.nodeId === node.id,
          disconnected: isDisconnected(node.relationshipCount) && !connectedOnLevel.has(node.id),
          cursor: node.id === cursorId,
        },
      }))

      if (neighbors.length === 0 || !onOpenNeighbor) return cards

      /*
       * Ghosts are laid out in a row above the level rather than at their own stored
       * coordinates.
       *
       * Their coordinates are real -- every node in a space shares one coordinate system
       * -- but they were chosen for a different level, so honouring them here would drop
       * cards at arbitrary distances, in among this level's nodes or a screen away from
       * them, and the camera would have to zoom out over empty space to include them.
       * A row along the top reads as what it is: a margin, holding the things this level
       * reaches out to.
       */
      const left = source.length > 0 ? Math.min(...source.map((node) => node.position.x)) : 0
      const top = source.length > 0 ? Math.min(...source.map((node) => node.position.y)) : 0

      return cards.concat(
        neighbors.map((node, index) => ({
          id: node.id,
          type: 'neighbor' as const,
          position: { x: left + index * NEIGHBOR_COLUMN_WIDTH, y: top - NEIGHBOR_ROW_GAP },
          // Nothing about a ghost is the user's to change: its place on screen is this
          // component's arrangement, and it belongs to another level.
          draggable: false,
          selectable: false,
          connectable: false,
          data: {
            node,
            tone: toneFor(node),
            verbs: verbsByNeighbor.get(node.id) ?? [],
            onOpen: onOpenNeighbor,
          },
        })),
      )
    },
    [
      actions,
      blockCounts,
      connectedOnLevel,
      cursorId,
      drop,
      editable,
      editorsByNode,
      linkingFrom,
      neighbors,
      onOpenNeighbor,
      readersByNode,
      selectedNodeId,
      toneFor,
      verbsByNeighbor,
    ],
  )

  // React Flow's nodes are local state, synced from the domain.
  //
  // This is the one place a second copy of the data is justified: a drag produces a
  // position per pointer event, and routing each one through the domain state would
  // re-render every node on the canvas at pointer frequency. So the drag is local and the
  // domain is told once, when it ends.
  const [flowNodes, setFlowNodes] = useState<CanvasNode[]>(() => toFlowNodes(nodes))

  /*
   * Re-synced in place, keeping each card's measurements.
   *
   * React Flow measures every node it renders and hides it -- `visibility: hidden` --
   * until it has. Those measurements live on the node objects, which means replacing the
   * array wholesale throws them away and the entire canvas blinks out for a frame while
   * it is measured again. That was visible as a flicker on anything that rebuilt the
   * array, which is to say on every selection, presence update and rename, and it made
   * renaming outright fail: the input mounted inside a hidden subtree, and a hidden
   * element cannot take the focus.
   */
  useEffect(() => {
    setFlowNodes((current) => {
      const previous = new Map(current.map((node) => [node.id, node]))

      return toFlowNodes(nodes).map((node) => {
        const prior = previous.get(node.id)
        if (!prior) return node

        return {
          ...node,
          // While an area selection is active, React Flow owns the selection: a server
          // sync must not wipe what the user has just rubber-banded. Otherwise the
          // domain owns it, so a selection made from search or navigation still lands.
          selected: multiSelectActiveRef.current ? prior.selected ?? node.selected : node.selected,
          measured: prior.measured ?? node.measured,
          // A card under the pointer keeps the position the drag is giving it. The domain
          // still holds where it started -- it is not told until the drag ends -- so
          // taking the position from there mid-gesture would snap the card out of the
          // user's hand. That happens whenever anything re-syncs during a drag, including
          // a collaborator's edit arriving.
          ...(prior.dragging ? { position: prior.position, dragging: true } : {}),
        }
      })
    })
  }, [nodes, toFlowNodes])

  /*
   * Auto-rename a freshly created card as soon as React Flow measures and shows it.
   *
   * React Flow hides every node with `visibility: hidden` until it has measured it.
   * Triggering a rename before that measurement means the focus call lands on a hidden
   * input and is silently dropped. Watching `flowNodes` lets us detect the exact moment
   * the node is measured (React Flow sets `measured` on the node object), dispatch the
   * rename event, and immediately tell the parent to clear `autoRenameNodeId` so the
   * effect does not fire again.
   */
  useEffect(() => {
    if (!autoRenameNodeId) return

    const flow = flowNodes.find((n) => n.id === autoRenameNodeId && n.type === 'documentation')
    if (!flow?.measured) return

    // Node is measured and visible. Tell the parent it's handled, then fire the event.
    onAutoRenameStarted?.()

    const element = containerRef.current?.querySelector<HTMLElement>(
      `.react-flow__node-documentation[data-id="${autoRenameNodeId}"]`,
    )
    element?.dispatchEvent(new CustomEvent(RENAME_EVENT, { bubbles: false }))
  }, [autoRenameNodeId, flowNodes, onAutoRenameStarted])

  // The camera move that makes a dive feel like movement rather than a page swap. Runs on
  // focus change only -- refitting whenever `nodes` changed would yank the viewport every
  // time a collaborator added something.
  useEffect(() => {
    instance.current?.fitView({ padding: 0.25, maxZoom: 1.2, duration: DIVE_ANIMATION_MS })
  }, [focusKey])

  const edges = useMemo<Edge[]>(() => {
    const ghostTones = new Map(neighbors.map((node) => [node.id, toneFor(node)]))

    return relationships.map((relationship) => {
      // An edge is "leaving" when one of its ends is a ghost. Drawn in that ghost's own
      // colour and thinned down, so it reads as the edge of the map rather than as one
      // more connection between the things on it.
      const tone = ghostTones.get(relationship.sourceNodeId) ?? ghostTones.get(relationship.targetNodeId)

      return {
        id: relationship.id,
        source: relationship.sourceNodeId,
        target: relationship.targetNodeId,
        label: relationship.relationshipType.replace(/_/g, ' '),
        type: 'smoothstep',
        // `contains` is the hierarchical verb, and showing it differently is what lets a
        // reader see the tree inside the graph without the storage privileging it.
        animated: false,
        style: tone
          ? { stroke: neighborStroke(tone), strokeWidth: 1, strokeDasharray: '2 4', opacity: 0.7 }
          : relationship.relationshipType === 'contains'
            ? undefined
            : { strokeDasharray: '4 3' },
        labelStyle: { fontSize: 10 },
        labelBgPadding: [4, 2] as [number, number],
      }
    })
  }, [neighbors, relationships, toneFor])

  /**
   * Position changes arrive here from two sources, and both are handled the same way:
   * a pointer drag, and the arrow keys on a focused node (React Flow's own keyboard
   * accessibility). `dragging === false` marks the end of either, which is the moment to
   * persist -- so keyboard movement is saved without a second code path.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      setFlowNodes((current) => applyNodeChanges(changes, current))

      for (const change of changes) {
        if (change.type !== 'position' || change.dragging || !change.position) continue
        // A card let go over another card, or over the breadcrumb, is being filed
        // somewhere else rather than moved to a coordinate.
        if (dropRef.current) continue

        const existing = nodes.find((node) => node.id === change.id)
        if (!existing) continue
        if (existing.position.x === change.position.x && existing.position.y === change.position.y) continue

        onMoveNode(change.id, {
          x: change.position.x,
          y: change.position.y,
          z: existing.position.z,
        })
      }
    },
    [nodes, onMoveNode],
  )

  /**
   * What the pointer is over, in the middle of dragging a card.
   *
   * Hit-tested against the pointer rather than against the dragged card's own rectangle,
   * which is the difference between a gesture that feels aimed and one that feels
   * accidental. Two overlapping cards both "intersect" a third the moment they touch it,
   * and nesting a node because its corner brushed another is not something a user can
   * undo without first working out what happened. Where they are pointing is
   * unambiguous, and the card is already under their pointer.
   */
  const findDropTarget = useCallback(
    (event: MouseEvent | TouchEvent, dragged: CanvasNode): DropTarget | null => {
      const pointer = pointerOf(event)
      if (!pointer) return null

      // The breadcrumb wins when the pointer is on it: it sits outside the canvas, so a
      // pointer there is plainly not aimed at any card.
      const crumb = document
        .elementFromPoint(pointer.clientX, pointer.clientY)
        ?.closest<HTMLElement>('[data-drop-ancestor]')

      if (crumb) {
        const value = crumb.dataset.dropAncestor
        // The space's own crumb carries "root": there is no node above it.
        return { kind: 'ancestor', nodeId: value === 'root' ? null : value ?? null, element: crumb }
      }

      if (!instance.current) return null
      const point = instance.current.screenToFlowPosition({ x: pointer.clientX, y: pointer.clientY })

      const hit = flowNodes
        .filter((node) => node.type === 'documentation' && node.id !== dragged.id)
        .filter((node) => {
          const width = node.measured?.width ?? 240
          const height = node.measured?.height ?? 96

          return (
            point.x >= node.position.x &&
            point.x <= node.position.x + width &&
            point.y >= node.position.y &&
            point.y <= node.position.y + height
          )
        })
        // Topmost, so stacked cards behave the way they look: `z` is the depth cue the
        // cards are drawn with, so it is also what decides which one is on top here.
        .sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))
        .at(0)

      return hit ? { kind: 'node', nodeId: hit.id, element: null } : null
    },
    [flowNodes],
  )

  const onNodeDrag = useCallback(
    (event: MouseEvent | TouchEvent, node: CanvasNode) => {
      if (!editable || !onReparentNode || node.type !== 'documentation') return

      const target = findDropTarget(event, node)

      setDrop((current) => {
        if (current?.kind === target?.kind && current?.nodeId === target?.nodeId) return current

        // The breadcrumb is highlighted by marking its own element rather than by lifting
        // this state up to the page. The crumbs are rendered by a sibling component, and
        // threading a transient drag hover through the page to reach them would put a
        // pointer-frequency value in the one place that re-renders everything.
        current?.element?.removeAttribute('data-drop-active')
        target?.element?.setAttribute('data-drop-active', 'true')

        return target
      })

      dropRef.current = target
    },
    [editable, findDropTarget, onReparentNode],
  )

  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: CanvasNode) => {
      const target = dropRef.current

      // A card that has just been dragged is the card being worked on, so the keyboard
      // picks up from there: Shift+arrows continue the placement the drag started.
      if (node.type === 'documentation') setCursorId(node.id)

      drop?.element?.removeAttribute('data-drop-active')
      setDrop(null)

      if (!target || node.type !== 'documentation') {
        dropRef.current = null
        return
      }

      // Dropping a node on the breadcrumb of the level it is already on is a no-op, not a
      // move: the user has changed their mind mid-drag and let go over the path bar.
      if (target.kind === 'node' || target.nodeId !== focusNodeId) {
        onReparentNode?.(node.id, target.nodeId)
      }

      // Cleared a tick later, because the position change that ends a drag and this
      // callback arrive in the same batch, and the order between them is React Flow's
      // business. While the ref is set the position handler stays out of the way -- the
      // node is leaving this level, and saving the coordinates it happened to be let go
      // at would file a stale position for a canvas nobody was looking at.
      setTimeout(() => {
        dropRef.current = null
      }, 0)
    },
    [drop, focusNodeId, onReparentNode],
  )

  const onConnect = useCallback<OnConnect>(
    (connection) => {
      if (!connection.source || !connection.target) return
      if (connection.source === connection.target) return

      onConnectNodes(connection.source, connection.target)
    },
    [onConnectNodes],
  )

  /**
   * A click's selection, waiting to see whether a second click is coming.
   *
   * Cancelled by everything that reinterprets the click it came from -- a dive, a click
   * on the pane, leaving the level -- because until it fires it is a selection nobody has
   * asked for yet, and letting it land afterwards would open a panel for a card on a
   * canvas the user has already left.
   */
  const pendingSelect = useRef<number | null>(null)

  const cancelPendingSelect = useCallback(() => {
    if (pendingSelect.current === null) return

    window.clearTimeout(pendingSelect.current)
    pendingSelect.current = null
  }, [])

  useEffect(() => cancelPendingSelect, [cancelPendingSelect])

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      cancelPendingSelect()

      // Immediately, unlike the selection: the keyboard's place is not worth waiting on a
      // double-click for, and an arrow pressed inside that quarter-second would otherwise
      // carry on from the card clicked before this one.
      setCursorId(nodeId)

      // Completing a link is unambiguous -- the gesture began on another card's toolbar
      // -- so it is not held back to wait for a double-click that would mean nothing here.
      if (linkingFrom && linkingFrom !== nodeId) {
        onConnectNodes(linkingFrom, nodeId)
        setLinkingFrom(null)
        return
      }

      pendingSelect.current = window.setTimeout(() => {
        pendingSelect.current = null
        onSelectNode(nodeId)
      }, SELECT_ON_CLICK_DELAY_MS)
    },
    [cancelPendingSelect, linkingFrom, onConnectNodes, onSelectNode],
  )

  /**
   * Double-clicking empty canvas creates a node there; double-clicking a card dives into
   * it.
   *
   * Handled on the wrapper rather than through React Flow props because there is no pane
   * double-click event, and the target check is what distinguishes "empty space" from
   * "something that is already there".
   */
  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!instance.current) return

      // The clicks that got here were the halves of this gesture, not a selection.
      cancelPendingSelect()

      const target = event.target as HTMLElement
      const card = target.closest<HTMLElement>('.react-flow__node')

      // A ghost cannot be dived into: there is nothing of it on this level to descend
      // through. Its own click handler leaves for the level it belongs to.
      if (card?.classList.contains('react-flow__node-neighbor')) return

      if (card?.dataset.id) {
        onDive(card.dataset.id)
        return
      }

      if (!editable || !onCreateNodeAt || !target.classList.contains('react-flow__pane')) return

      // Screen coordinates are meaningless to the domain. This converts the click into
      // the graph's own coordinate space, so a node lands where it was dropped at any
      // zoom or pan.
      const position = instance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })

      onCreateNodeAt({ x: position.x, y: position.y, z: 0 })
    },
    [cancelPendingSelect, editable, onCreateNodeAt, onDive],
  )

  /**
   * Parks the keyboard focus on the canvas itself before the level changes.
   *
   * Every card on this level is about to be unmounted, including the one holding the
   * focus, and the browser's answer to that is to drop the focus onto the body -- where
   * the next Escape or arrow key reaches nothing and the keyboard run is over after one
   * step. The canvas is focusable for exactly this reason, and it handles the same keys,
   * so the next keystroke lands whether or not a card has appeared yet.
   */
  const holdFocus = useCallback((container: HTMLElement) => {
    container.focus({ preventScroll: true })
  }, [])

  /**
   * The canvas from the keyboard alone.
   *
   * Worth the code because this is a spatial interface, which is exactly the kind that
   * ends up mouse-only by default: every gesture here started as a drag, a double-click
   * or a hover-revealed button. The bindings are taken from file managers rather than
   * invented, since that is the interface a drill-down canvas most resembles -- Enter to
   * go in, Escape to come back out.
   *
   *   Arrows        move the cursor to the next card, round the level and round again
   *   Shift+Arrows  nudge the card under the cursor one grid step
   *   Enter         go inside the card under the cursor
   *   Escape        come back out, or abandon a half-drawn link first
   *   n             add a node
   *   F2            rename in place
   *
   * Taken in the capture phase, which is what makes them ours. React Flow binds Enter,
   * Escape and the arrows on each card, and a card holds the focus as soon as it is
   * clicked or tabbed to -- so in the bubble phase its handlers have already run by the
   * time these do, and Enter would have selected the card and an arrow would have dragged
   * it across the canvas before either reached here. Capturing on the container and
   * stopping the keys we own means the cards never see them. `disableKeyboardA11y` is set
   * for the same reason, and between them this component owns the whole keyboard.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement

      /*
       * A field owns its own keys, and this is the guard that does not depend on each one
       * remembering to say so. It matters more in the capture phase than it did in the
       * bubble phase: an input's own handler has not run yet, so stopping a key here would
       * take it out of the input rather than merely duplicating it.
       */
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return

      const container = event.currentTarget
      // The cursor is the anchor for everything that acts on "the current card", and it
      // is kept on whatever the mouse last touched as well -- so this is the same id
      // whether the user has been clicking or arrowing.
      const active = order.find((node) => node.id === cursorId) ?? null

      // Ours from here on: whatever we do with it, no card is going to see it.
      const claim = () => {
        event.preventDefault()
        event.stopPropagation()
      }

      if (event.key === 'Escape') {
        claim()

        // A half-drawn link is abandoned first: it is the more local piece of state, and
        // leaving the level with one still armed would carry it to a canvas where its
        // source is not even drawn.
        if (linkingFrom) {
          setLinkingFrom(null)
          return
        }

        cancelPendingSelect()
        holdFocus(container)
        // Land on the node just left, the way a file manager does: the user came out of
        // it, so that is where they are.
        arrival.current = { want: focusNodeId ?? 'first' }
        onAscend?.()
        return
      }

      if (event.key === 'Enter') {
        if (!active) return

        claim()
        cancelPendingSelect()
        holdFocus(container)
        arrival.current = { want: 'first' }
        onDive(active.id)
        return
      }

      /*
       * `n` for a new node, and only bare `n`: Cmd+N and Ctrl+N belong to the browser,
       * and a shortcut that opened a window sometimes and a node other times would be
       * worse than not having one.
       */
      if (event.key === 'n' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (!editable || !onCreateNode) return

        claim()
        onCreateNode()
        return
      }

      if (event.key === 'F2') {
        if (!editable || !onRenameNode || !active) return

        const card = container.querySelector<HTMLElement>(
          `.react-flow__node-documentation[data-id="${active.id}"]`,
        )
        if (!card) return

        claim()
        card.dispatchEvent(new CustomEvent(RENAME_EVENT, { bubbles: false }))
        return
      }

      const step = ARROW_STEPS[event.key]
      if (!step) return

      claim()

      if (!event.shiftKey) {
        // Right and Down forward, Left and Up back: the cycle is one-dimensional, so the
        // four keys are two. Nothing is selected by this, so the inspector stays shut.
        stepCursor(step.dx + step.dy > 0 ? 1 : -1)
        holdFocus(container)
        return
      }

      // Shift makes the same keys move the card instead of the cursor, which is the one
      // way a keyboard has of placing anything on a spatial canvas.
      if (!active || !editable) return

      onMoveNode(active.id, {
        x: active.position.x + step.dx * GRID_SIZE,
        y: active.position.y + step.dy * GRID_SIZE,
        z: active.position.z,
      })
    },
    [
      cancelPendingSelect,
      cursorId,
      editable,
      focusNodeId,
      holdFocus,
      linkingFrom,
      onAscend,
      onCreateNode,
      onDive,
      onMoveNode,
      onRenameNode,
      order,
      stepCursor,
    ],
  )

  /**
   * Hands the keyboard back to the canvas when the pointer lands on it.
   *
   * The half of "works whichever hand you reach for" that focus does not do by itself. A
   * click on a card focuses it, and a click on empty canvas focuses this container, but a
   * click that *follows* one on the inspector -- a panel, a dialog, the header -- leaves
   * the focus wherever that was, and the arrow keys then go to that instead. Anyone who
   * has just pointed at the canvas plainly means the canvas.
   *
   * Text fields are exempt: a pointer going into the rename input is going there to type.
   */
  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const container = event.currentTarget
    const target = event.target as HTMLElement

    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    if (container.contains(document.activeElement)) return

    container.focus({ preventScroll: true })
  }, [])

  /**
   * Keeps the cursor under the focus ring when the focus moves on its own.
   *
   * Tab walks the cards -- React Flow makes each one focusable, and that is worth keeping
   * -- and it would otherwise leave two indicators on two different cards, with the arrow
   * keys continuing from the one the user was not looking at.
   */
  const handleFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.react-flow__node-documentation')

    if (card?.dataset.id) setCursorId(card.dataset.id)
  }, [])

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!onPointerPosition || !instance.current) return

      // Published in graph coordinates, not screen coordinates: everyone is looking at
      // the same space through a different viewport, and a cursor at "400, 300 on my
      // screen" means nothing on anyone else's.
      onPointerPosition(instance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }))
    },
    [onPointerPosition],
  )

  return (
    <div
      ref={containerRef}
      className="h-full w-full focus-visible:outline-none"
      data-testid="spatial-canvas"
      // Focusable so the keyboard reaches the canvas before anything in it has been
      // clicked: tab to the canvas, then arrow through the level. React Flow's own
      // tabbing through individual cards still works from here.
      tabIndex={0}
      role="application"
      onDoubleClick={handleDoubleClick}
      // Capture, not bubble: the cards bind the same keys, and in the bubble phase they
      // would have acted on them first. See `handleKeyDown`.
      onKeyDownCapture={handleKeyDown}
      onPointerDown={handlePointerDown}
      onFocus={handleFocus}
      onPointerMove={handlePointerMove}
    >
      <ReactFlow<CanvasNode, Edge>
        nodes={flowNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={(flow) => {
          instance.current = flow
        }}
        onNodesChange={onNodesChange}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onConnect={onConnect}
        // Ghosts are excluded: clicking one is navigation, handled by the card itself,
        // and treating it as a selection would open an inspector for a node that is not
        // on this level -- or aim a half-drawn link at it.
        onNodeClick={(_event, node) => node.type === 'documentation' && handleNodeClick(node.id)}
        onEdgeDoubleClick={(_event, edge) => editable && onDeleteRelationship?.(edge.id)}
        nodesDraggable={editable}
        nodesConnectable={editable}
        // Clicking empty space clears the selection, which closes the inspector. The
        // obvious alternative -- leaving it open -- makes it ambiguous what the panel is
        // describing. It also abandons a half-drawn link, which is the only way out of
        // link mode that does not require aiming at anything.
        onPaneClick={() => {
          cancelPendingSelect()
          setLinkingFrom(null)
          setMultiSelectedIds(new Set())
          onSelectNode(null)
        }}
        onSelectionChange={handleSelectionChange}
        // The performance switch that matters: React Flow mounts only the nodes inside
        // the viewport, so a space with 10,000 nodes still renders the hundred on screen.
        onlyRenderVisibleElements
        nodesFocusable
        edgesFocusable
        panOnScroll
        // Left-button drag draws the multi-select rectangle; scroll-wheel pans (panOnScroll).
        // panOnDrag defaults to true which conflicts with selectionOnDrag -- disabling it
        // means the user pans by scrolling (two-finger trackpad / scroll wheel) and draws
        // a selection box by dragging on empty canvas.
        panOnDrag={false}
        selectionOnDrag
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.2 }}
        minZoom={0.1}
        maxZoom={2.5}
        /*
          React Flow's keyboard model is off, and this component's is on instead.

          Not a rejection of it -- it is a good model for a flow chart. It is that every
          key in it means something else here: its arrows drag the focused node, where
          ours walk the level; its Enter selects a node, where ours goes inside one; its
          Escape deselects, where ours comes back up. Two models over one set of keys is
          not a thing that can be tuned into working, so there is one.

          Tab is unaffected and still walks the cards: `nodesFocusable` is what makes them
          focusable, and this flag does not touch it.
        */
        disableKeyboardA11y
        /*
          The canvas moves itself to the keyboard cursor, in `revealNode`.

          React Flow would otherwise do something almost the same on focus, and "almost"
          is the problem: it fires only when the browser judges a focus to be
          `:focus-visible`, which is a heuristic about how the user got there. Panning the
          canvas is not a thing to be right about most of the time.
        */
        autoPanOnNodeFocus={false}
        // Backspace must not delete documentation. Deletion is an explicit action on the
        // card, where the user can see what they are removing.
        deleteKeyCode={null}
        aria-label="Documentation graph"
      >
        <Background variant={BackgroundVariant.Dots} gap={GRID_SIZE} size={1} />
        <Controls showInteractive={false} />
        {/*
          A minimap earns its space here rather than being decoration: in a spatial
          interface the single most common question is "where am I in the whole graph",
          and nothing else on screen answers it.
        */}
        <MiniMap pannable zoomable ariaLabel="Graph overview" className="!bg-muted" />

        {/*
          Cursors are rendered inside the viewport portal so React Flow applies the pan
          and zoom transform to them. Positioning them by hand would mean recomputing
          every cursor on every scroll wheel tick.
        */}
        <ViewportPortal>
          {peers
            .filter((peer) => typeof peer.x === 'number' && typeof peer.y === 'number')
            .map((peer) => (
              <PeerCursor key={peer.sessionId} peer={peer} />
            ))}
        </ViewportPortal>
      </ReactFlow>

      {/*
        Floating action bar shown when the user has drag-selected (or Ctrl/Meta-clicked)
        two or more nodes. Sits at the top-centre of the canvas, above any content, so it
        never covers the selection it describes.
      */}
      {multiSelectedIds.size > 1 && editable ? (
        <div
          role="toolbar"
          aria-label={`${multiSelectedIds.size} nodes selected`}
          className="pointer-events-auto absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-sm border border-border bg-popover px-3 py-1.5 shadow-md"
        >
          <span className="text-xs text-muted-foreground">
            {multiSelectedIds.size} nodes selected
          </span>
          <div className="h-3 w-px bg-border" aria-hidden />
          <button
            type="button"
            onClick={() => {
              onDeleteNodes?.(Array.from(multiSelectedIds))
              setMultiSelectedIds(new Set())
            }}
            className="flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10 focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Trash2 className="size-3" aria-hidden />
            Delete selected
          </button>
        </div>
      ) : null}

      <p className="sr-only" aria-live="polite">
        {cursorAnnouncement}
      </p>

      {drop && editable ? (
        <div
          role="status"
          className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded-sm border border-brand-400 bg-popover px-3 py-1.5 text-xs shadow-sm"
        >
          {drop.kind === 'node'
            ? 'Drop to put this node inside'
            : drop.nodeId === focusNodeId
              ? 'Drop here to leave it where it is'
              : 'Drop to move this node out to here'}
        </div>
      ) : null}

      {linkingFrom ? (
        <div
          role="status"
          className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-sm border border-border bg-popover px-3 py-1.5 text-xs shadow-sm"
        >
          Pick the node to connect to, or click empty space to cancel.
        </div>
      ) : null}
    </div>
  )
})

function PeerCursor({ peer }: { peer: Peer }) {
  const color = collaboratorColor(peer.actor.colorSeed)

  return (
    <div
      className="pointer-events-none absolute z-50 flex items-center gap-1"
      style={{ transform: `translate(${peer.x ?? 0}px, ${peer.y ?? 0}px)` }}
    >
      <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden className="drop-shadow-sm">
        <path d="M0 0l12 6-5 1.5L4 14z" fill={color} />
      </svg>
      <span
        className="rounded-xs px-1 py-0.5 text-[10px] font-medium text-white"
        style={{ backgroundColor: color }}
      >
        {peer.actor.name}
      </span>
    </div>
  )
}
