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
 * The direction each arrow key nudges a card, with Shift held.
 *
 * One grid step per press on the axis the key points along. Arrows without Shift do not
 * move the selection: walking the level card by card was removed.
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
  onDeleteRelationship?: (relationshipId: string) => void
  /**
   * Open a node: the canvas redraws with what it contains.
   *
   * `fromKeyboard` asks the caller to leave something selected on arrival. Only the
   * keyboard needs it -- a mouse user has a pointer to select with, and opening the
   * inspector on every double-click would cover the canvas they just navigated into.
   */
  onDive: (nodeId: string, options?: { fromKeyboard?: boolean }) => void
  /** Leave this level for the one above. Bound to Escape as well as the breadcrumb. */
  onAscend?: (options?: { fromKeyboard?: boolean }) => void
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
   *   Shift+Arrows  nudge the selected card one grid step
   *   Enter         open the selected card, the same as double-clicking it
   *   Escape        leave this level, or abandon a half-drawn link first
   *   F2            rename in place
   *
   * Bare arrows are swallowed and do nothing. React Flow's own keyboard handling drags a
   * focused node with the arrow keys, and a plain arrow press should not move
   * documentation across the canvas, so the event is stopped before it gets there. The
   * nudge is kept on Shift, because a keyboard user still needs some way to place a node.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement

      // A rename input, or any other field, owns its own keys. The inputs stop these
      // events themselves; this is the guard that does not depend on them remembering to.
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return

      const container = event.currentTarget
      const focusedCard = target.closest<HTMLElement>('.react-flow__node-documentation')
      const activeId = focusedCard?.dataset.id ?? selectedNodeId

      if (event.key === 'Escape') {
        event.preventDefault()

        // A half-drawn link is abandoned first: it is the more local piece of state, and
        // leaving the level with one still armed would carry it to a canvas where its
        // source is not even drawn.
        if (linkingFrom) {
          setLinkingFrom(null)
          return
        }

        cancelPendingSelect()
        holdFocus(container)
        onAscend?.({ fromKeyboard: true })
        return
      }

      if (event.key === 'Enter') {
        if (!activeId || !nodes.some((node) => node.id === activeId)) return

        event.preventDefault()
        cancelPendingSelect()
        holdFocus(container)
        onDive(activeId, { fromKeyboard: true })
        return
      }

      if (event.key === 'F2') {
        if (!editable || !onRenameNode) return

        const card =
          focusedCard ??
          (selectedNodeId
            ? container.querySelector<HTMLElement>(
                `.react-flow__node-documentation[data-id="${selectedNodeId}"]`,
              )
            : null)

        if (!card) return

        event.preventDefault()
        card.dispatchEvent(new CustomEvent(RENAME_EVENT, { bubbles: false }))
        return
      }

      const step = ARROW_STEPS[event.key]
      if (!step) return

      // Arrows are swallowed either way. React Flow's own keyboard handling drags a
      // focused card with the arrow keys, and a plain arrow press should not move
      // documentation across the canvas -- so only Shift+arrow nudges, and bare arrows
      // do nothing rather than falling through to it.
      event.preventDefault()

      if (!event.shiftKey) return

      const node = nodes.find((candidate) => candidate.id === activeId)
      if (!node || !editable) return

      onMoveNode(node.id, {
        x: node.position.x + step.dx * GRID_SIZE,
        y: node.position.y + step.dy * GRID_SIZE,
        z: node.position.z,
      })
    },
    [
      cancelPendingSelect,
      editable,
      holdFocus,
      linkingFrom,
      nodes,
      onAscend,
      onDive,
      onMoveNode,
      onRenameNode,
      selectedNodeId,
    ],
  )

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
      onKeyDown={handleKeyDown}
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
        // React Flow's own keyboard model, kept for what it does well: Tab moves the focus
        // ring from card to card. Its arrow-key handling, which moves a focused node, is
        // intercepted in `handleKeyDown` before it gets here -- arrows walk the level
        // instead, and Shift+arrows keep the nudge.
        disableKeyboardA11y={false}
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
