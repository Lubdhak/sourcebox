import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '@/features/documentation/graphql'
import { readingOrder } from '@/features/documentation/readingOrder'
import type { RealtimeEnvelope } from '@/lib/cable'
import { GraphQLRequestError } from '@/lib/graphql'
import { logger } from '@/lib/logger'
import type { DocumentationNode, NodeRelationship, SpaceGraph, SpatialPosition } from '@/types'

/**
 * Owns the client's copy of one space's graph.
 *
 * The contract every page here follows, applied to the largest document in the app:
 *
 *   Inertia  -- seeds the first paint. The canvas draws real nodes immediately.
 *   GraphQL  -- reconciles navigation, mutations and structural realtime changes.
 *   Local    -- optimistic. Applied instantly, rolled back to the last server-confirmed
 *               state on failure.
 *
 * Rolling back to the *confirmed* state rather than to the pre-change value is what makes
 * this correct under rapid edits: after three drags and a failure, the only positions
 * known to be real are the ones the server acknowledged.
 */

const MOVE_DEBOUNCE_MS = 350

/**
 * Remote changes that need a refetch are coalesced over this window.
 *
 * Some collaborator changes cannot be merged from the message alone -- a node created
 * inside the folder we are looking at, for instance, is only recognisable as ours by
 * re-asking the server what this folder contains. With fifty people in a space those
 * arrive in bursts, so they are batched into one query rather than one per message.
 */
const REMOTE_REFRESH_DEBOUNCE_MS = 400
const NO_NODES: DocumentationNode[] = []

interface UseGraphStateOptions {
  spaceId: string
  initialGraph: SpaceGraph
  initialFocusNodeId?: string | null
  /** Opens the inspector on this node as soon as the level containing it has loaded. */
  initialSelectedNodeId?: string | null
}

/**
 * Whether a level change should leave something selected.
 *
 * Off by default, and that default is the mouse: a double-click into a node should not
 * also throw the inspector panel open over the canvas. A keyboard navigation asks for it,
 * because without a selection there is nothing for the next keystroke to act on.
 */
export interface FocusOptions {
  selectOnArrival?: boolean
}

export interface GraphStateApi {
  nodes: DocumentationNode[]
  relationships: NodeRelationship[]
  neighbors: DocumentationNode[]
  nodeCount: number
  relationshipCount: number
  truncated: boolean

  /** The node the canvas is inside, or null at the top of the space. */
  focusNode: DocumentationNode | null
  focusNodeId: string | null
  /** Containment path down to `focusNode`, outermost first. */
  trail: DocumentationNode[]
  dive: (nodeId: string, options?: FocusOptions) => Promise<void>
  ascend: (options?: FocusOptions) => Promise<void>
  focusOn: (nodeId: string | null, selectOnArrival?: 'first' | string) => Promise<void>

  selectedNodeId: string | null
  selectNode: (nodeId: string | null) => void

  saving: boolean
  error: string | null
  dismissError: () => void

  addNode: (attributes: {
    title: string
    x: number
    y: number
    parentNodeId?: string | null
  }) => Promise<DocumentationNode | null>
  moveNode: (nodeId: string, position: SpatialPosition) => void
  renameNode: (nodeId: string, title: string) => Promise<void>
  connectNodes: (sourceNodeId: string, targetNodeId: string, relationshipType: string) => Promise<void>
  reparentNode: (nodeId: string, newParentNodeId: string | null, fromParentNodeId?: string | null) => Promise<void>
  cloneNode: (nodeId: string, includeChildren: boolean) => Promise<void>
  /**
   * Drops nodes the server has already deleted, and reconciles.
   *
   * Deleting is `useNodeDeletion`'s job -- it owns the policy, the impact preview and the
   * mutation. This is only the local aftermath.
   */
  forgetNodes: (nodeIds: string[]) => Promise<void>
  removeRelationship: (relationshipId: string) => Promise<void>
  refresh: () => Promise<void>

  /** Merges one message from the space channel. Everything a collaborator does lands here. */
  applyRealtime: (message: RealtimeEnvelope) => void
}

export function useGraphState({
  spaceId,
  initialGraph,
  initialFocusNodeId = null,
  initialSelectedNodeId = null,
}: UseGraphStateOptions): GraphStateApi {
  const [graph, setGraph] = useState<SpaceGraph>(initialGraph)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(
    initialGraph.focusNode === undefined ? initialFocusNodeId : initialGraph.focusNode?.id ?? null,
  )
  /*
   * The level on screen, for the callbacks that must not be holding an old one.
   *
   * `refresh` is the reason. It re-asks the server for "this level", and a debounced
   * caller runs it up to 400 ms after deciding to -- by which time the level may be a
   * different one, because the thing that prompted the refresh was frequently also a
   * navigation. Reading the focus from a closure meant re-loading the level the user had
   * just left and landing them back at the top of the space: adding a node from the top
   * level put the new node inside the outermost node, followed it in, and then bounced
   * back out as the echo of the creation arrived.
   */
  const focusNodeIdRef = useRef(focusNodeId)
  focusNodeIdRef.current = focusNodeId
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(initialSelectedNodeId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The last state the server acknowledged. A ref, not state: it must not trigger a
  // render, and the rollback path needs its current value without being rebuilt on every
  // change.
  const confirmedGraph = useRef<SpaceGraph>(initialGraph)

  // Positions waiting to be sent, keyed by node id so a node dragged twice inside one
  // debounce window is sent once, with its final position.
  const pendingMoves = useRef<Map<string, SpatialPosition>>(new Map())
  const moveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlightRefetch = useRef<AbortController | null>(null)
  const remoteRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const graphGeneration = useRef(0)
  const seed = useRef({ spaceId, initialGraph })

  useEffect(() => {
    if (seed.current.spaceId !== spaceId || seed.current.initialGraph !== initialGraph) {
      seed.current = { spaceId, initialGraph }
      confirmedGraph.current = initialGraph
      setGraph(initialGraph)
      const focus = initialGraph.focusNode === undefined ? initialFocusNodeId : initialGraph.focusNode?.id ?? null
      focusNodeIdRef.current = focus
      setFocusNodeId(focus)
      setSelectedNodeId(initialSelectedNodeId)
      setError(null)
      setSaving(false)
    }

    return () => {
      graphGeneration.current += 1
      inFlightRefetch.current?.abort()
      if (remoteRefreshTimer.current) clearTimeout(remoteRefreshTimer.current)
      remoteRefreshTimer.current = null
    }
    // Focus and selection are only seeds when Inertia delivers a new snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, initialGraph])

  const reportFailure = useCallback((err: unknown, event: string, fallback: string) => {
    if (err instanceof DOMException && err.name === 'AbortError') return

    if (err instanceof GraphQLRequestError && err.isUnauthenticated) {
      // The session is gone. A full navigation lets Rails redirect, which an XHR cannot
      // follow.
      window.location.replace('/login')
      return
    }

    setError(err instanceof Error ? err.message : fallback)
    logger.warn(event, {
      code: err instanceof GraphQLRequestError ? err.code : undefined,
    })
  }, [])

  const load = useCallback(
    async (focus: string | null, signal?: AbortSignal) => {
      const generation = graphGeneration.current
      const space = await api.fetchSpaceGraph(
        { id: spaceId, limit: undefined, focusNodeId: focus },
        signal ? { signal } : {},
      )

      if (signal?.aborted || generation !== graphGeneration.current) {
        throw new DOMException('Graph snapshot was replaced', 'AbortError')
      }
      setGraph(space.graph)
      confirmedGraph.current = space.graph

      setFocusNodeId(space.graph.focusNode?.id ?? null)

      return space.graph
    },
    [spaceId],
  )

  const refresh = useCallback(async () => {
    inFlightRefetch.current?.abort()
    const controller = new AbortController()
    inFlightRefetch.current = controller

    try {
      await load(focusNodeIdRef.current, controller.signal)
    } catch (err: unknown) {
      reportFailure(err, 'frontend.documentation_refresh_failed', 'Could not reload the graph.')
    }
  }, [load, reportFailure])

  /* --- Drill-down ------------------------------------------------------- */

  /**
   * Moves the canvas into or out of a node.
   *
   * The focus is written into the URL as it changes, because a drill-down is a place: a
   * collaborator can be sent a link to what someone is looking at, and a refresh keeps
   * the user where they were instead of throwing them back to the top of the space.
   * `replaceState` rather than `pushState` -- the breadcrumb is the way back up, and
   * filling the browser's history with every level of a deep dive makes the back button
   * useless for leaving the page.
   */
  const focusOn = useCallback(
    async (nodeId: string | null, selectOnArrival?: 'first' | string) => {
      setSaving(true)
      setSelectedNodeId(null)

      try {
        const arrived = await load(nodeId)

        if (selectOnArrival) {
          const cards = readingOrder(arrived.nodes)
          const wanted =
            selectOnArrival === 'first'
              ? cards[0]
              : cards.find((node) => node.id === selectOnArrival) ?? cards[0]

          setSelectedNodeId(wanted?.id ?? null)
        }

        const url = new URL(window.location.href)
        if (nodeId) url.searchParams.set('focus', nodeId)
        else url.searchParams.delete('focus')
        window.history.replaceState(window.history.state, '', url)
      } catch (err: unknown) {
        reportFailure(err, 'frontend.documentation_focus_failed', 'Could not open that node.')
      } finally {
        setSaving(false)
      }
    },
    [load, reportFailure],
  )

  const dive = useCallback(
    (nodeId: string, options: FocusOptions = {}) =>
      // Inside a node, the first card in reading order is where the keyboard continues
      // from: there is no previous position on a level nobody has been to yet.
      focusOn(nodeId, options.selectOnArrival ? 'first' : undefined),
    [focusOn],
  )

  const ascend = useCallback(
    (options: FocusOptions = {}) => {
      // One rung up is the last entry in the trail: the node that contains the one we are
      // inside. An empty trail means the current focus sits at the top of the space.
      const parent = graph.trail?.at(-1) ?? null
      // Coming up selects the node just left, which is the file-manager behaviour and the
      // only answer that does not lose the reader's place: they came out of that node, so
      // that node is where they are.
      const left = focusNodeId

      return focusOn(parent?.id ?? null, options.selectOnArrival ? left ?? 'first' : undefined)
    },
    [focusNodeId, focusOn, graph.trail],
  )

  /* --- Movement --------------------------------------------------------- */

  const flushMoves = useCallback(async () => {
    const snapshot = seed.current
    const batch = Array.from(pendingMoves.current.entries()).map(([nodeId, position]) => ({
      nodeId,
      x: position.x,
      y: position.y,
      z: position.z,
    }))

    pendingMoves.current.clear()
    if (batch.length === 0) return

    setSaving(true)

    try {
      const confirmed = await api.moveNodes({ spaceId, positions: batch })
      if (snapshot !== seed.current) return
      const byId = new Map(confirmed.map((node) => [node.id, node.position]))

      // Adopt the server's coordinates rather than keeping the optimistic guess. They
      // are normally identical; when they are not -- a clamped value, a node deleted in
      // another tab -- the server is right.
      confirmedGraph.current = {
        ...confirmedGraph.current,
        nodes: confirmedGraph.current.nodes.map((node) => {
          const position = byId.get(node.id)
          return position ? { ...node, position } : node
        }),
      }
    } catch (err: unknown) {
      if (snapshot !== seed.current) return
      setGraph(confirmedGraph.current)
      reportFailure(err, 'frontend.documentation_move_failed', 'Could not save the new position.')
    } finally {
      if (snapshot === seed.current) setSaving(false)
    }
  }, [reportFailure, spaceId])

  /**
   * Applies a position locally and schedules it for persistence.
   *
   * Debounced because a drag emits positions at pointer frequency: without this, moving
   * one node across the canvas would be a hundred mutations, each with its own
   * transaction and its own event.
   */
  const moveNode = useCallback(
    (nodeId: string, position: SpatialPosition) => {
      setGraph((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
      }))

      pendingMoves.current.set(nodeId, position)

      if (moveTimer.current) clearTimeout(moveTimer.current)
      moveTimer.current = setTimeout(() => {
        moveTimer.current = null
        void flushMoves()
      }, MOVE_DEBOUNCE_MS)
    },
    [flushMoves],
  )

  // A pending position must not be lost because the user navigated away mid-drag.
  useEffect(
    () => () => {
      if (moveTimer.current) clearTimeout(moveTimer.current)
      if (pendingMoves.current.size > 0) void flushMoves()
    },
    [flushMoves, initialGraph],
  )

  /* --- Structure -------------------------------------------------------- */

  const addNode = useCallback<GraphStateApi['addNode']>(
    async (attributes) => {
      setSaving(true)

      try {
        const node = await api.createNode({
          spaceId,
          title: attributes.title,
          x: attributes.x,
          y: attributes.y,
          parentNodeId: attributes.parentNodeId ?? null,
        })

        /*
         * Not optimistic. A node's id comes from the database and the inspector, the
         * edges and every later mutation are keyed by it, so inventing a temporary id
         * would mean reconciling it afterwards for no perceptible gain -- creation is one
         * deliberate click, not a continuous gesture.
         *
         * Where it landed is also the server's answer rather than the client's: asking
         * for a node with no parent gets one adopted by the space's root, so the level
         * the user is looking at may not be the level the node is on. Following it is the
         * only honest outcome -- the alternative is a click that appears to do nothing,
         * because the node is real but a level away.
         */
        const parentNodeId = node.parents?.[0]?.id ?? null

        if (parentNodeId !== focusNodeId) await focusOn(parentNodeId)
        else await refresh()

        return node
      } catch (err: unknown) {
        reportFailure(err, 'frontend.documentation_create_node_failed', 'Could not create the node.')
        return null
      } finally {
        setSaving(false)
      }
    },
    [focusNodeId, focusOn, refresh, reportFailure, spaceId],
  )

  /**
   * Retitling in place.
   *
   * Optimistic, unlike creating a node: the title is already on screen, the change is a
   * single field, and waiting a round trip to see the word you just typed appear is the
   * kind of lag that makes an inline edit feel worse than a form. A failure puts the old
   * title back.
   */
  const renameNode = useCallback(
    async (nodeId: string, title: string) => {
      const previous = confirmedGraph.current

      setGraph((current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, title } : node)),
      }))
      setSaving(true)

      try {
        const node = await api.updateNode({ nodeId, title })

        confirmedGraph.current = {
          ...confirmedGraph.current,
          nodes: confirmedGraph.current.nodes.map((existing) => (existing.id === node.id ? node : existing)),
        }
        setGraph(confirmedGraph.current)
      } catch (err: unknown) {
        setGraph(previous)
        confirmedGraph.current = previous
        reportFailure(err, 'frontend.documentation_rename_node_failed', 'Could not rename that node.')
      } finally {
        setSaving(false)
      }
    },
    [reportFailure],
  )

  const connectNodes = useCallback(
    async (sourceNodeId: string, targetNodeId: string, relationshipType: string) => {
      setSaving(true)

      try {
        const relationship = await api.createRelationship({
          spaceId,
          sourceNodeId,
          targetNodeId,
          relationshipType,
        })

        setGraph((current) =>
          current.relationships.some((existing) => existing.id === relationship.id)
            ? current
            : {
                ...current,
                relationships: [...current.relationships, relationship],
                relationshipCount: current.relationshipCount + 1,
              },
        )
        confirmedGraph.current = {
          ...confirmedGraph.current,
          relationships: [
            ...confirmedGraph.current.relationships.filter((existing) => existing.id !== relationship.id),
            relationship,
          ],
        }
      } catch (err: unknown) {
        reportFailure(err, 'frontend.documentation_connect_failed', 'Could not connect those nodes.')
      } finally {
        setSaving(false)
      }
    },
    [reportFailure, spaceId],
  )

  /**
   * Moving a node between levels.
   *
   * Refetched rather than patched, and for once that is not caution: the node is leaving
   * the level being drawn, or arriving on it, so the correct local edit is "recompute
   * which nodes belong here" -- which is the query. The neighbours and child counts move
   * with it too.
   */
  const reparentNode = useCallback(
    async (nodeId: string, newParentNodeId: string | null, fromParentNodeId?: string | null) => {
      setSaving(true)

      try {
        await api.reparentNode({ nodeId, newParentId: newParentNodeId, fromParentId: fromParentNodeId ?? null })
        await refresh()
      } catch (err: unknown) {
        reportFailure(err, 'frontend.documentation_reparent_failed', 'Could not move that node.')
      } finally {
        setSaving(false)
      }
    },
    [refresh, reportFailure],
  )

  const cloneNode = useCallback(
    async (nodeId: string, includeChildren: boolean) => {
      setSaving(true)

      try {
        const copy = await api.cloneNode(nodeId, includeChildren)

        await refresh()
        // Selected, because a copy is almost always about to be edited -- it arrives
        // titled "… copy" and has to become its own thing.
        setSelectedNodeId(copy.id)
      } catch (err: unknown) {
        reportFailure(err, 'frontend.documentation_clone_failed', 'Could not copy that node.')
      } finally {
        setSaving(false)
      }
    },
    [refresh, reportFailure],
  )

  /**
   * Drops nodes the server has already deleted.
   *
   * The deletion itself is not here: it belongs to `useNodeDeletion`, which owns the
   * policy and the impact and is the only caller of the delete mutation. This is the
   * local consequence -- clear the selection if it pointed at one of them, then refetch,
   * because a deletion also removes every edge touching those nodes and may re-home their
   * children, and reproducing those rules client-side would be a second implementation of
   * the thing the server just did.
   */
  const forgetNodes = useCallback(
    async (nodeIds: string[]) => {
      if (nodeIds.length === 0) return

      const gone = new Set(nodeIds)

      if (selectedNodeId && gone.has(selectedNodeId)) setSelectedNodeId(null)
      // Spliced out immediately so the cards disappear on the click rather than after the
      // round trip, then reconciled by the refetch below.
      setGraph((current) => ({
        ...current,
        nodes: current.nodes.filter((node) => !gone.has(node.id)),
        relationships: current.relationships.filter(
          (edge) => !gone.has(edge.sourceNodeId) && !gone.has(edge.targetNodeId),
        ),
        nodeCount: Math.max(0, current.nodeCount - nodeIds.length),
      }))

      if (focusNodeId && gone.has(focusNodeId)) {
        // The canvas was inside one of them. There is no folder left to show.
        await focusOn(null)
        return
      }

      await refresh()
    },
    [focusNodeId, focusOn, refresh, selectedNodeId],
  )

  const removeRelationship = useCallback(
    async (relationshipId: string) => {
      const previous = confirmedGraph.current

      // Optimistic: removing a line is instantly visible and trivially reversible.
      setGraph((current) => ({
        ...current,
        relationships: current.relationships.filter((relationship) => relationship.id !== relationshipId),
        relationshipCount: Math.max(0, current.relationshipCount - 1),
      }))
      setSaving(true)

      try {
        await api.deleteRelationship(relationshipId)
        confirmedGraph.current = {
          ...confirmedGraph.current,
          relationships: confirmedGraph.current.relationships.filter(
            (relationship) => relationship.id !== relationshipId,
          ),
        }
      } catch (err: unknown) {
        setGraph(previous)
        reportFailure(err, 'frontend.documentation_delete_relationship_failed', 'Could not remove the relationship.')
      } finally {
        setSaving(false)
      }
    },
    [reportFailure],
  )

  /* --- Collaboration ---------------------------------------------------- */

  const scheduleRemoteRefresh = useCallback(() => {
    if (remoteRefreshTimer.current) return

    remoteRefreshTimer.current = setTimeout(() => {
      remoteRefreshTimer.current = null
      void refresh()
    }, REMOTE_REFRESH_DEBOUNCE_MS)
  }, [refresh])

  useEffect(
    () => () => {
      if (remoteRefreshTimer.current) clearTimeout(remoteRefreshTimer.current)
    },
    [],
  )

  /**
   * Merges a collaborator's change into the canvas.
   *
   * Two kinds of message, and the distinction is what keeps fifty people in one space
   * from generating fifty queries per edit. A change to something already on screen is
   * applied from the message itself. A change that might alter *which* nodes belong on
   * screen -- a new node, a new containment edge while we are inside a folder -- cannot
   * be judged locally, so it schedules one coalesced refetch.
   */
  const applyRealtime = useCallback(
    (message: RealtimeEnvelope) => {
      const patchNodes = (updater: (nodes: DocumentationNode[]) => DocumentationNode[]) => {
        setGraph((current) => ({ ...current, nodes: updater(current.nodes) }))
        confirmedGraph.current = { ...confirmedGraph.current, nodes: updater(confirmedGraph.current.nodes) }
      }

      switch (message.type) {
        case 'documentation.node_moved': {
          const incoming = (message.nodes ?? []) as DocumentationNode[]
          const byId = new Map(incoming.map((node) => [node.id, node]))

          // Never applied to a node this user is dragging right now: their pointer is
          // the more recent truth, and adopting the server's older position would jerk
          // the card out from under them.
          patchNodes((nodes) =>
            nodes.map((node) => {
              const next = byId.get(node.id)
              if (!next || pendingMoves.current.has(node.id)) return node
              return { ...node, position: next.position }
            }),
          )
          return
        }

        case 'documentation.node_updated': {
          const node = message.node as DocumentationNode | undefined
          if (!node) return

          patchNodes((nodes) => nodes.map((existing) => (existing.id === node.id ? { ...existing, ...node } : existing)))
          return
        }

        case 'documentation.node_deleted': {
          const nodeId = String(message.nodeId)
          // A cascading delete removes a whole subtree, so the message names every id.
          // Older messages carried only the root, hence the fallback.
          const deleted = new Set<string>(
            ((message.nodeIds as string[] | undefined) ?? [nodeId]).map(String).concat(nodeId),
          )

          setGraph((current) => {
            const remaining = current.nodes.filter((node) => !deleted.has(node.id))

            return {
              ...current,
              nodes: remaining,
              // Every edge touching them is gone too, which is a rule the server applied
              // and the client can safely mirror rather than refetch for.
              relationships: current.relationships.filter(
                (edge) => !deleted.has(edge.sourceNodeId) && !deleted.has(edge.targetNodeId),
              ),
              nodeCount: Math.max(0, current.nodeCount - (current.nodes.length - remaining.length)),
            }
          })

          if (selectedNodeId && deleted.has(selectedNodeId)) setSelectedNodeId(null)
          // Being inside a node somebody else just deleted is the one case that must not
          // be merged locally: there is no folder left to show.
          if (focusNodeId && deleted.has(focusNodeId)) void focusOn(null)
          // A non-cascading delete lifts the deleted node's children into its place, so
          // the level being drawn may have gained nodes as well as lost one.
          else scheduleRemoteRefresh()
          return
        }

        case 'documentation.relationship_deleted': {
          const relationshipId = String(message.relationshipId)

          setGraph((current) => ({
            ...current,
            relationships: current.relationships.filter((edge) => edge.id !== relationshipId),
            relationshipCount: Math.max(0, current.relationshipCount - 1),
          }))
          return
        }

        case 'documentation.relationship_created': {
          const relationship = message.relationship as NodeRelationship | undefined
          if (!relationship) return

          // A containment edge is a membership question rather than a drawing one, at
          // every level: it decides which node holds the target, and therefore which
          // canvas the target appears on -- including the top of the space, which now
          // shows only what nothing else contains.
          if (relationship.relationshipType === 'contains') {
            scheduleRemoteRefresh()
            return
          }

          setGraph((current) => {
            if (current.relationships.some((edge) => edge.id === relationship.id)) return current

            // An edge with an end outside this level needs the node at that end, which
            // only the server can decide and send. Drawing the edge without it would
            // leave a line anchored to nothing.
            const onLevel = new Set(current.nodes.map((node) => node.id))
            if (!onLevel.has(relationship.sourceNodeId) || !onLevel.has(relationship.targetNodeId)) {
              scheduleRemoteRefresh()
              return current
            }

            return {
              ...current,
              relationships: [...current.relationships, relationship],
              relationshipCount: current.relationshipCount + 1,
            }
          })
          return
        }

        case 'documentation.node_created':
        case 'documentation.node_reparented':
        case 'documentation.node_cloned':
          scheduleRemoteRefresh()
          return

        default:
          break
      }
    },
    [focusNodeId, focusOn, scheduleRemoteRefresh, selectedNodeId],
  )

  /**
   * Opens or closes the inspector, and writes which node it is open on into the URL.
   *
   * The same reasoning `focusOn` gives for `focus` applies here one level down: a
   * selection is a place too, just a page rather than a level, and every path that
   * selects a node -- the canvas, search, a mention followed inside the panel -- goes
   * through here, so all of them produce a link that reopens on the right page instead of
   * only the right level.
   *
   * `block` is deliberately left alone. It names a paragraph inside the page this URL
   * points at, and a selection made by clicking around is not a claim about which
   * paragraph matters -- only a link copied from inside a page is that specific, and nulls
   * out on the next selection, `focus` and `node` come from *how you got here*.
   */
  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId)

    const url = new URL(window.location.href)
    if (nodeId) url.searchParams.set('node', nodeId)
    else url.searchParams.delete('node')
    url.searchParams.delete('block')
    window.history.replaceState(window.history.state, '', url)
  }, [])
  const dismissError = useCallback(() => setError(null), [])

  return useMemo(
    () => ({
      nodes: graph.nodes,
      relationships: graph.relationships,
      neighbors: graph.neighbors ?? NO_NODES,
      nodeCount: graph.nodeCount,
      relationshipCount: graph.relationshipCount,
      truncated: graph.truncated,
      focusNode: graph.focusNode ?? null,
      focusNodeId,
      trail: graph.trail ?? NO_NODES,
      dive,
      ascend,
      focusOn,
      selectedNodeId,
      selectNode,
      saving,
      error,
      dismissError,
      addNode,
      moveNode,
      renameNode,
      connectNodes,
      reparentNode,
      cloneNode,
      forgetNodes,
      removeRelationship,
      refresh,
      applyRealtime,
    }),
    [
      addNode,
      applyRealtime,
      ascend,
      connectNodes,
      dismissError,
      dive,
      error,
      focusNodeId,
      focusOn,
      graph,
      moveNode,
      refresh,
      forgetNodes,
      cloneNode,
      removeRelationship,
      renameNode,
      reparentNode,
      saving,
      selectNode,
      selectedNodeId,
    ],
  )
}
