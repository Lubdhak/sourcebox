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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { readingOrder } from '@/features/documentation/readingOrder'
import { collaboratorColor } from '@/features/documentation/collaboration/colors'
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
 * What each arrow key means: a direction for nudging a card, and a step for walking the
 * level.
 *
 * Right and Down both go forward through the reading order, Left and Up both go back.
 * Four keys for two directions looks redundant, but the cards are laid out in two
 * dimensions and a person reaches for whichever arrow points at the card they can see.
 */
const ARROW_STEPS: Record<string, { dx: number; dy: number; forward: number }> = {
  ArrowRight: { dx: 1, dy: 0, forward: 1 },
  ArrowDown: { dx: 0, dy: 1, forward: 1 },
  ArrowLeft: { dx: -1, dy: 0, forward: -1 },
  ArrowUp: { dx: 0, dy: -1, forward: -1 },
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
   * File a node somewhere else: inside the node it was dropped on, or out to the ancestor
   * whose breadcrumb it was dropped on. Null means the top of the space.
   */
  onReparentNode?: (nodeId: string, newParentNodeId: string | null) => void
  /** Leave this level for the one a neighbour lives on. */
  onOpenNeighbor?: (node: DocumentationNode) => void
  /** Go to the level a containing node lives on, with that node selected. */
  onGoUp?: (parent: NodeParent) => void
  onPointerPosition?: (position: { x: number; y: number }) => void
}

export function SpatialCanvas({
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
  onReparentNode,
  onOpenNeighbor,
  onGoUp,
  onPointerPosition,
}: SpatialCanvasProps) {
  const instance = useRef<ReactFlowInstance<CanvasNode, Edge> | null>(null)

  /**
   * Click-to-connect, as an alternative to dragging between handles.
   *
   * Dragging a two-pixel handle across a zoomed-out canvas to another two-pixel handle is
   * precise work, and it is the one gesture people reliably fail at here. Picking the
   * source from the card's own toolbar and then clicking the target asks for no accuracy
   * at all.
   */
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null)

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
          dropTarget: drop?.kind === 'node' && drop.nodeId === node.id,
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
      drop,
      editable,
      editorsByNode,
      linkingFrom,
      neighbors,
      onOpenNeighbor,
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

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      if (linkingFrom && linkingFrom !== nodeId) {
        onConnectNodes(linkingFrom, nodeId)
        setLinkingFrom(null)
        return
      }

      onSelectNode(nodeId)
    },
    [linkingFrom, onConnectNodes, onSelectNode],
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
    [editable, onCreateNodeAt, onDive],
  )

  // The order the arrow keys walk, shared with the graph state so that a level arrived at
  // by keyboard selects the same card the arrows would have started from.
  const order = useMemo(() => readingOrder(nodes), [nodes])

  /**
   * Moves the selection to another card and takes the keyboard focus with it.
   *
   * The focus move is what makes the rest of the keyboard work: F2, Enter and the next
   * arrow press are all read from the canvas, and a selection the browser has not
   * followed would leave them firing at whatever was clicked last. The camera follows too
   * -- cycling onto a card that is off-screen would otherwise look like the selection
   * disappearing -- at the zoom the user is already at, so navigating never re-frames
   * the level under them.
   */
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

  const selectAndReveal = useCallback(
    (nodeId: string, container: HTMLElement) => {
      onSelectNode(nodeId)

      const card = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
      card?.focus({ preventScroll: true })

      const zoom = instance.current?.getZoom() ?? 1
      instance.current?.fitView({ nodes: [{ id: nodeId }], maxZoom: zoom, duration: 160, padding: 0.4 })
    },
    [onSelectNode],
  )

  /**
   * The canvas from the keyboard alone.
   *
   * Worth the code because this is a spatial interface, which is exactly the kind that
   * ends up mouse-only by default: every gesture here started as a drag, a double-click
   * or a hover-revealed button. The bindings are taken from file managers rather than
   * invented, since that is the interface a drill-down canvas most resembles -- arrows to
   * move through what is in front of you, Enter to go in, Escape to come back out.
   *
   *   Arrows        next/previous card on this level, wrapping round
   *   Shift+Arrows  nudge the selected card, which is what arrows alone used to do
   *   Enter         open the selected card, the same as double-clicking it
   *   Escape        leave this level, or abandon a half-drawn link first
   *   F2            rename in place
   *
   * Every branch stops the event rather than letting React Flow also act on it: its own
   * keyboard handling moves a focused node with the arrow keys, which would otherwise
   * drag a card across the canvas while the user was only trying to look at the next one.
   * That gesture is kept, on Shift, because a keyboard user still needs some way to place
   * a node.
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

        holdFocus(container)
        onAscend?.({ fromKeyboard: true })
        return
      }

      if (event.key === 'Enter') {
        if (!activeId || !nodes.some((node) => node.id === activeId)) return

        event.preventDefault()
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
      if (!step || order.length === 0) return

      event.preventDefault()

      if (event.shiftKey) {
        const node = nodes.find((candidate) => candidate.id === activeId)
        if (!node || !editable) return

        onMoveNode(node.id, {
          x: node.position.x + step.dx * GRID_SIZE,
          y: node.position.y + step.dy * GRID_SIZE,
          z: node.position.z,
        })

        return
      }

      const current = order.findIndex((node) => node.id === activeId)
      // Wrapping, so the level is a loop rather than a line with two dead ends: on a
      // canvas there is no "last" card in any direction a person can see.
      const next =
        current === -1
          ? order[0]
          : order[(current + step.forward + order.length) % order.length]

      if (next) selectAndReveal(next.id, container)
    },
    [
      editable,
      holdFocus,
      linkingFrom,
      nodes,
      onAscend,
      onDive,
      onMoveNode,
      onRenameNode,
      order,
      selectAndReveal,
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
          setLinkingFrom(null)
          onSelectNode(null)
        }}
        // The performance switch that matters: React Flow mounts only the nodes inside
        // the viewport, so a space with 10,000 nodes still renders the hundred on screen.
        onlyRenderVisibleElements
        nodesFocusable
        edgesFocusable
        panOnScroll
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
}

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
