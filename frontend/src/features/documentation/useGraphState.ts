import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '@/features/documentation/graphql'
import { readingOrder } from '@/features/documentation/readingOrder'
import type { RealtimeEnvelope } from '@/lib/cable'
import { GraphQLRequestError } from '@/lib/graphql'
import { logger } from '@/lib/logger'
import type { DocumentationNode, Layer, NodeRelationship, SpaceGraph, SpatialPosition } from '@/types'

/**
 * Owns the client's copy of one space's graph.
 *
 * The same contract the dashboard page established, applied to a much larger document:
 *
 *   Inertia  -- seeds the first paint. The canvas draws real nodes immediately.
 *   GraphQL  -- the authority. Refetched on mount and after every mutation.
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

interface UseGraphStateOptions {
  spaceId: string
  initialGraph: SpaceGraph
  initialLayers: Layer[]
  /** Restores a drill-down from the URL, so a refresh keeps the user where they were. */
  initialFocusNodeId?: string | null
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
  /**
   * Nodes on other levels that something on this one connects to.
   *
   * Context rather than content: the canvas draws them faintly and clicking one leaves
   * this level for theirs. Kept separate from `nodes` throughout, because anything that
   * treated them as contents -- a layer count, a selection, a drag -- would be wrong.
   */
  neighbors: DocumentationNode[]
  layers: Layer[]
  nodeCount: number
  relationshipCount: number
  truncated: boolean

  layerFilter: string | null
  setLayerFilter: (layerId: string | null) => void

  /** The node the canvas is inside, or null at the top of the space. */
  focusNode: DocumentationNode | null
  focusNodeId: string | null
  /** Containment path down to `focusNode`, outermost first. */
  trail: DocumentationNode[]
  /** Descend into a node: the canvas redraws with what it contains. */
  dive: (nodeId: string, options?: FocusOptions) => Promise<void>
  /** Back up one level, to wherever the current focus lives. */
  ascend: (options?: FocusOptions) => Promise<void>
  /**
   * Jump to any level, including `null` for the top of the space. The breadcrumb uses it.
   *
   * `selectOnArrival` is a node id to select once there, or `'first'` for whichever card
   * reads first on that level. A named node that has since moved or gone falls back to
   * the first one.
   */
  focusOn: (nodeId: string | null, selectOnArrival?: 'first' | string) => Promise<void>

  selectedNodeId: string | null
  selectNode: (nodeId: string | null) => void

  saving: boolean
  error: string | null
  dismissError: () => void

  addNode: (attributes: {
    title: string
    nodeType?: string
    x: number
    y: number
    layerId?: string | null
    parentNodeId?: string | null
  }) => Promise<DocumentationNode | null>
  moveNode: (nodeId: string, position: SpatialPosition) => void
  /** Retitles a node from the canvas, without going through the inspector. */
  renameNode: (nodeId: string, title: string) => Promise<void>
  connectNodes: (sourceNodeId: string, targetNodeId: string, relationshipType: string) => Promise<void>
  /**
   * Files a node inside another one, or out to an ancestor.
   *
   * `fromParentNodeId` is the containment being left, which is the level the gesture
   * happened on. Passing nothing adds a parent without removing one, which is how a node
   * comes to live in two places.
   */
  reparentNode: (nodeId: string, newParentNodeId: string | null, fromParentNodeId?: string | null) => Promise<void>
  /** Copies a node, with or without everything inside it. Selects the copy. */
  cloneNode: (nodeId: string, includeChildren: boolean) => Promise<void>
  removeNode: (nodeId: string, cascade?: boolean) => Promise<void>
  removeRelationship: (relationshipId: string) => Promise<void>
  /** Call after an edit made elsewhere (the inspector) changed a node the canvas draws. */
  refresh: () => Promise<void>

  addLayer: (name?: string) => Promise<void>
  renameLayer: (layerId: string, name: string) => Promise<void>
  removeLayer: (layerId: string) => Promise<void>

  /** Merges one message from the space channel. Everything a collaborator does lands here. */
  applyRealtime: (message: RealtimeEnvelope) => void
}

export function useGraphState({
  spaceId,
  initialGraph,
  initialLayers,
  initialFocusNodeId = null,
}: UseGraphStateOptions): GraphStateApi {
  const [graph, setGraph] = useState<SpaceGraph>(initialGraph)
  const [layers, setLayers] = useState<Layer[]>(initialLayers)
  const [layerFilter, setLayerFilterState] = useState<string | null>(null)
  const [focusNodeId, setFocusNodeId] = useState<string | null>(initialFocusNodeId)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
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
    async (layerId: string | null, focus: string | null, signal?: AbortSignal) => {
      const space = await api.fetchSpaceGraph(
        { id: spaceId, layerId, limit: undefined, focusNodeId: focus },
        signal ? { signal } : {},
      )

      setGraph(space.graph)
      setLayers(space.layers)
      confirmedGraph.current = space.graph

      // The server decides whether a focus is still valid -- a node someone else deleted
      // resolves to no focus rather than to an error -- so the client follows its answer
      // instead of its own request.
      setFocusNodeId(space.graph.focusNode?.id ?? null)

      // Returned as well as stored, because a caller that has just changed level needs to
      // act on what arrived -- state is a render away, and by then the keyboard has moved
      // on without it.
      return space.graph
    },
    [spaceId],
  )

  // Refetch on mount. The Inertia props are a snapshot from when the page was rendered;
  // another tab, or the same user ten minutes ago, may have moved things since.
  useEffect(() => {
    const controller = new AbortController()

    load(null, initialFocusNodeId, controller.signal).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Non-fatal: the snapshot is already on screen, so the canvas stays usable.
      logger.warn('frontend.documentation_refetch_failed', {
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    })

    return () => controller.abort()
    // Mount only: `initialFocusNodeId` seeds the first load and every later focus change
    // goes through `dive`/`ascend`, which fetch for themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  const refresh = useCallback(async () => {
    inFlightRefetch.current?.abort()
    const controller = new AbortController()
    inFlightRefetch.current = controller

    try {
      await load(layerFilter, focusNodeId, controller.signal)
    } catch (err: unknown) {
      reportFailure(err, 'frontend.documentation_refresh_failed', 'Could not reload the graph.')
    }
  }, [focusNodeId, layerFilter, load, reportFailure])

  // Filtering happens on the server, not by hiding nodes locally: the point of layers is
  // that a space may hold more nodes than the browser should ever receive.
  const setLayerFilter = useCallback(
    (layerId: string | null) => {
      setLayerFilterState(layerId)
      setSaving(true)

      load(layerId, focusNodeId)
        .catch((err: unknown) => reportFailure(err, 'frontend.documentation_layer_filter_failed', 'Could not filter by layer.'))
        .finally(() => setSaving(false))
    },
    [focusNodeId, load, reportFailure],
  )

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
        const arrived = await load(layerFilter, nodeId)

        /*
         * Landing with something selected, when the caller asks for it.
         *
         * This is what makes the canvas usable without a mouse. Changing level clears the
         * selection -- the selected node is rarely on the level being arrived at -- and a
         * keyboard user who pressed Enter would then have nothing to press Enter on next:
         * no selection, and the card that held the focus gone from the document. So a
         * keyboard arrival names what it wants selected, and a named node that is not
         * here any more falls back to the first card rather than to nothing.
         */
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
    [layerFilter, load, reportFailure],
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
      setGraph(confirmedGraph.current)
      reportFailure(err, 'frontend.documentation_move_failed', 'Could not save the new position.')
    } finally {
      setSaving(false)
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
    [flushMoves],
  )

  /* --- Structure -------------------------------------------------------- */

  const addNode = useCallback<GraphStateApi['addNode']>(
    async (attributes) => {
      setSaving(true)

      try {
        const node = await api.createNode({
          spaceId,
          title: attributes.title,
          nodeType: attributes.nodeType,
          x: attributes.x,
          y: attributes.y,
          layerId: attributes.layerId ?? null,
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

        setSelectedNodeId(node.id)

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

  const removeNode = useCallback(
    async (nodeId: string, cascade = false) => {
      setSaving(true)

      try {
        await api.deleteNode(nodeId, cascade)

        if (selectedNodeId === nodeId) setSelectedNodeId(null)
        // Refetched rather than spliced locally, because deleting a node also deletes
        // every edge touching it and the client would have to reproduce that rule to
        // stay consistent.
        await refresh()
      } catch (err: unknown) {
        reportFailure(err, 'frontend.documentation_delete_node_failed', 'Could not delete the node.')
      } finally {
        setSaving(false)
      }
    },
    [refresh, reportFailure, selectedNodeId],
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

  /* --- Layers ----------------------------------------------------------- */

  const runLayerMutation = useCallback(
    async (event: string, fallback: string, mutation: () => Promise<Layer[]>) => {
      setSaving(true)

      try {
        setLayers(await mutation())
      } catch (err: unknown) {
        reportFailure(err, event, fallback)
      } finally {
        setSaving(false)
      }
    },
    [reportFailure],
  )

  const addLayer = useCallback(
    (name?: string) =>
      runLayerMutation('frontend.documentation_create_layer_failed', 'Could not add that depth.', () =>
        api.createLayer(name ? { spaceId, name } : { spaceId }),
      ),
    [runLayerMutation, spaceId],
  )

  const renameLayer = useCallback(
    async (layerId: string, name: string) => {
      setSaving(true)

      try {
        const layer = await api.updateLayer({ layerId, name })
        setLayers((current) => current.map((existing) => (existing.id === layer.id ? layer : existing)))
      } catch (err: unknown) {
        reportFailure(err, 'frontend.documentation_rename_layer_failed', 'Could not rename that depth.')
      } finally {
        setSaving(false)
      }
    },
    [reportFailure],
  )

  const removeLayer = useCallback(
    async (layerId: string) => {
      await runLayerMutation('frontend.documentation_delete_layer_failed', 'Could not remove that depth.', () =>
        api.deleteLayer(layerId),
      )

      // The nodes that were on it are still there, unlayered, so a filter pointing at a
      // layer that no longer exists would show an empty canvas rather than nothing wrong.
      if (layerFilter === layerId) setLayerFilter(null)
      else await refresh()
    },
    [layerFilter, refresh, runLayerMutation, setLayerFilter],
  )

  /* --- Collaboration ---------------------------------------------------- */

  const remoteRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

        case 'documentation.node_updated':
        case 'documentation.layer_changed': {
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
        // Both change which level a node belongs on, and only the server can say which.
        case 'documentation.node_reparented':
        case 'documentation.node_cloned':
          scheduleRemoteRefresh()
          return

        case 'documentation.layer_created':
        case 'documentation.layer_updated':
        case 'documentation.layer_deleted': {
          const incoming = message.layers as Layer[] | undefined
          if (incoming) setLayers(incoming)
          return
        }

        default:
          // Block-level changes are handled by the inspector, which is subscribed to the
          // node itself. Ignoring them here keeps a keystroke from touching the canvas.
          break
      }
    },
    [focusNodeId, focusOn, scheduleRemoteRefresh, selectedNodeId],
  )

  const selectNode = useCallback((nodeId: string | null) => setSelectedNodeId(nodeId), [])
  const dismissError = useCallback(() => setError(null), [])

  return useMemo(
    () => ({
      nodes: graph.nodes,
      relationships: graph.relationships,
      neighbors: graph.neighbors ?? [],
      layers,
      nodeCount: graph.nodeCount,
      relationshipCount: graph.relationshipCount,
      truncated: graph.truncated,
      layerFilter,
      setLayerFilter,
      focusNode: graph.focusNode ?? null,
      focusNodeId,
      trail: graph.trail ?? [],
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
      removeNode,
      removeRelationship,
      refresh,
      addLayer,
      renameLayer,
      removeLayer,
      applyRealtime,
    }),
    [
      addLayer,
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
      layerFilter,
      layers,
      moveNode,
      refresh,
      removeLayer,
      removeNode,
      cloneNode,
      removeRelationship,
      renameLayer,
      renameNode,
      reparentNode,
      saving,
      selectNode,
      selectedNodeId,
      setLayerFilter,
    ],
  )
}
