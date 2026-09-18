import { Head } from '@inertiajs/react'
import { Plus } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { DeleteNodeDialog, DuplicateNodeDialog } from '@/features/documentation/actions/NodeActionDialogs'
import { Breadcrumb } from '@/features/documentation/canvas/Breadcrumb'
import { SpatialCanvas, type SpatialCanvasHandle } from '@/features/documentation/canvas/SpatialCanvas'
import { PresenceBar } from '@/features/documentation/collaboration/PresenceBar'
import { useSpaceChannel } from '@/features/documentation/collaboration/useSpaceChannel'
import { InspectorColumn } from '@/features/documentation/inspector/InspectorColumn'
import { InspectorPanel } from '@/features/documentation/inspector/InspectorPanel'
import { useInspectorTrail } from '@/features/documentation/inspector/useInspectorTrail'
import { NameRelationshipDialog } from '@/features/documentation/actions/NameRelationshipDialog'
import { canEdit, ROLE_LABELS } from '@/features/documentation/roles'
import { SearchPanel } from '@/features/documentation/search/SearchPanel'
import { useGraphState } from '@/features/documentation/useGraphState'
import { useIsMobile } from '@/hooks/use-mobile'
import type { DocumentationNode, DocumentationSpacePageProps, NodeParent, SpatialPosition } from '@/types'

/**
 * The spatial documentation page.
 *
 * Composition only: it wires the canvas, the inspector, search and the
 * realtime channel to one `useGraphState`, and decides whether the inspector is a column
 * or a sheet. No graph logic lives here.
 */

function initialFocusFromUrl(): string | null {
  if (typeof window === 'undefined') return null

  return new URLSearchParams(window.location.search).get('focus')
}

export default function DocumentationSpaceShow({
  space,
  initialGraph,
  collaborator,
  viewerRole,
}: DocumentationSpacePageProps) {
  const isMobile = useIsMobile()

  // Two different pages, really, built from one: a viewer gets a document and an editor
  // gets the canvas. Rendering the same controls for both and letting the server refuse
  // would be simpler here and worse everywhere else -- a delete button that always fails
  // is not a feature.
  const mayEdit = canEdit(viewerRole)

  const graph = useGraphState({
    spaceId: space.id,
    initialGraph,
    initialFocusNodeId: initialFocusFromUrl(),
  })

  // The socket hands structural messages straight to the graph state. This page does not
  // interpret them; it only decides that they belong together.
  const { peers, connected, publishCursor, publishPresence } = useSpaceChannel({
    spaceId: space.id,
    onGraphMessage: graph.applyRealtime,
  })

  const canvasRef = useRef<SpatialCanvasHandle>(null)

  const [pendingPosition, setPendingPosition] = useState<SpatialPosition | null>(null)
  /**
   * The id of the node most recently added by this client, if any.
   *
   * Passed to the canvas so it can auto-start renaming the card as soon as React Flow
   * has measured and shown it -- without opening the inspector panel. The user can type
   * the name directly on the card.
   */
  const [autoRenameNodeId, setAutoRenameNodeId] = useState<string | null>(null)

  // Where the inspector has been, so a link it followed can be walked back the way it
  // came. Every callback below that moves the *canvas* clears it: those are moves around
  // the map, and none of them continues a path through the reading. See
  // `useInspectorTrail`.
  const history = useInspectorTrail()

  const createNodeAt = useCallback(
    async (position: SpatialPosition, parentNodeId?: string | null) => {
      setPendingPosition(position)
      history.reset()

      const node = await graph.addNode({
        title: 'Untitled node',
        x: position.x,
        y: position.y,
        parentNodeId: parentNodeId ?? graph.focusNodeId,
      })

      setPendingPosition(null)

    if (node) {
      // Signal the canvas to auto-rename the new card (inline, without opening the
      // inspector). No node is selected, so the panel stays closed.
      setAutoRenameNodeId(node.id)
      publishPresence({ focusNodeId: node.parents?.[0]?.id ?? null, selectedNodeId: null })
    }
  },
  [graph, history, publishPresence],
)

  const scatteredPosition = useCallback((): SpatialPosition => {
    // Nodes added from the toolbar always land near the centre of what the user can
    // currently see, not at the graph origin. A small random offset stops them from
    // stacking exactly on top of each other when several are added in a row.
    const offset = {
      x: Math.round((Math.random() - 0.5) * 200),
      y: Math.round((Math.random() - 0.5) * 150),
    }

    const center = canvasRef.current?.getViewportCenter()

    return {
      x: (center?.x ?? 0) + offset.x,
      y: (center?.y ?? 0) + offset.y,
      z: 0,
    }
  }, [])

  const addNodeAtCentre = useCallback(() => {
    void createNodeAt(scatteredPosition())
  }, [createNodeAt, scatteredPosition])

  /*
   * Connecting two nodes: shows a dialog that REQUIRES the user to name the
   * relationship before it is created. The canvas calls this when the user finishes
   * a drag from one node to another.
   */
  const [pendingConnection, setPendingConnection] = useState<{
    sourceNodeId: string
    targetNodeId: string
  } | null>(null)

  const handleConnectNodes = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      setPendingConnection({ sourceNodeId, targetNodeId })
    },
    [],
  )

  const confirmConnection = useCallback(
    (relationshipType: string) => {
      if (!pendingConnection) return

      void graph.connectNodes(
        pendingConnection.sourceNodeId,
        pendingConnection.targetNodeId,
        relationshipType,
      )
      setPendingConnection(null)
    },
    [graph, pendingConnection],
  )

  // Selection and focus are broadcast immediately rather than with the throttled cursor,
  // because they are what put a collaborator's marker on a card -- and a stale marker on
  // the wrong node is worse than none.
  const selectNode = useCallback(
    (nodeId: string | null) => {
      // Selecting on the canvas, from search, or closing the panel: a new starting point,
      // so whatever was being followed in the panel is over.
      history.reset()
      graph.selectNode(nodeId)
      publishPresence({ selectedNodeId: nodeId })
    },
    [graph, history, publishPresence],
  )

  /** Following a link inside the panel. One hop deeper. */
  const followLink = useCallback(
    (nodeId: string) => {
      const from = graph.selectedNodeId

      history.follow(
        from
          ? {
              id: from,
              // The trail's own cache answers first; this is for a page it has not seen.
              title: graph.nodes.find((node) => node.id === from)?.title ?? 'the previous page',
            }
          : null,
        nodeId,
      )

      graph.selectNode(nodeId)
      publishPresence({ selectedNodeId: nodeId })
    },
    [graph, history, publishPresence],
  )

  const goBack = useCallback(() => {
    const previous = history.pop()
    if (!previous) return

    graph.selectNode(previous.id)
    publishPresence({ selectedNodeId: previous.id })
  }, [graph, history, publishPresence])

  const dive = useCallback(
    (nodeId: string, options: { fromKeyboard?: boolean } = {}) => {
      history.reset()
      void graph.dive(nodeId, { selectOnArrival: options.fromKeyboard })
      publishPresence({ focusNodeId: nodeId, selectedNodeId: null })
    },
    [graph, history, publishPresence],
  )

  /**
   * Follows an edge that leaves the current level.
   *
   * Lands on the level the neighbour lives on -- its parent -- with the neighbour itself
   * selected, rather than descending into the neighbour. Those are different places: a
   * node with nothing inside it would otherwise open onto an empty canvas, and the
   * question a ghost card answers is "where does this thing live", which is among its
   * siblings.
   */
  const openNeighbor = useCallback(
    (node: DocumentationNode) => {
      const parentNodeId = node.parentNodeId ?? null

      history.reset()
      void graph.focusOn(parentNodeId).then(() => {
        graph.selectNode(node.id)
        publishPresence({ focusNodeId: parentNodeId, selectedNodeId: node.id })
      })
    },
    [graph, history, publishPresence],
  )

  /**
   * Up a level from a card, to the node that contains it.
   *
   * The same landing as a ghost card's: the level the parent lives on, with the parent
   * selected. Not *inside* the parent -- that is where the user already is.
   */
  const goUp = useCallback(
    (parent: NodeParent) => {
      history.reset()
      void graph.focusOn(parent.parentNodeId ?? null).then(() => {
        graph.selectNode(parent.id)
        publishPresence({ focusNodeId: parent.parentNodeId ?? null, selectedNodeId: parent.id })
      })
    },
    [graph, history, publishPresence],
  )

  /*
   * Deleting and duplicating are held here, at the page, rather than on the card.
   *
   * Both put a question on screen, and a question that outlives the card it was asked
   * from has to live above it: the canvas unmounts and remounts cards freely as the
   * viewport moves, and a dialog owned by one of them would vanish mid-decision.
   */
  const [deleting, setDeleting] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState<string | null>(null)
  const nodeById = useCallback((nodeId: string | null) => graph.nodes.find((node) => node.id === nodeId) ?? null, [graph.nodes])

  const duplicateNode = useCallback(
    (nodeId: string) => {
      // A leaf has nothing to ask about, so it is copied on the click. The dialog exists
      // for the one decision -- with or without the contents -- and showing it with only
      // one possible answer is a confirmation for its own sake.
      const node = graph.nodes.find((candidate) => candidate.id === nodeId)

      if ((node?.childCount ?? 0) === 0) void graph.cloneNode(nodeId, false)
      else setDuplicating(nodeId)
    },
    [graph],
  )

  const navigateTo = useCallback(
    (nodeId: string | null) => {
      history.reset()
      void graph.focusOn(nodeId)
      publishPresence({ focusNodeId: nodeId, selectedNodeId: null })
    },
    [graph, history, publishPresence],
  )

  // One level up, from the breadcrumb button or from Escape on the canvas. The trail's
  // last entry is where that is; an empty trail means the level above is the space itself.
  const ascend = useCallback(
    (options: { fromKeyboard?: boolean } = {}) => {
      // Coming up by keyboard selects the node just left, so the collaborators' markers
      // are told about it rather than being left pointing into the level below.
      const arriving = graph.trail.at(-1)?.id ?? null

      history.reset()
      void graph.ascend({ selectOnArrival: options.fromKeyboard })
      publishPresence({
        focusNodeId: arriving,
        selectedNodeId: options.fromKeyboard ? graph.focusNodeId : null,
      })
    },
    [graph, history, publishPresence],
  )

  const inspector = graph.selectedNodeId ? (
    <InspectorPanel
      key={graph.selectedNodeId}
      nodeId={graph.selectedNodeId}
      spaceId={space.id}
      levelNodes={graph.nodes}
      editable={mayEdit}
      back={history.back ? { title: history.back.title, onBack: goBack } : null}
      onClose={() => selectNode(null)}
      onSelectNode={followLink}
      onTitleLoaded={history.remember}
      onDeleteNode={setDeleting}
      onDeleteRelationship={(relationshipId) => void graph.removeRelationship(relationshipId)}
      onNodeChanged={() => void graph.refresh()}
    />
  ) : null

  const header = useMemo(
    () => (
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="truncate text-sm font-medium">{space.name}</span>
        <span className="hidden shrink-0 font-mono text-[11px] text-muted-foreground sm:inline">
          {graph.nodeCount} nodes · {graph.relationshipCount} edges
        </span>

        <div className="ml-auto flex items-center gap-2">
          {viewerRole !== 'OWNER' ? (
            <span className="hidden shrink-0 rounded-xs bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline">
              {ROLE_LABELS[viewerRole]}
            </span>
          ) : null}

          <PresenceBar peers={peers} self={collaborator} connected={connected} />
          <SearchPanel spaceId={space.id} onSelectNode={selectNode} />

          {mayEdit ? (
            <Button size="sm" onClick={addNodeAtCentre} disabled={graph.saving}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">Add node</span>
            </Button>
          ) : null}
        </div>
      </div>
    ),
    [addNodeAtCentre, collaborator, connected, graph.nodeCount, graph.relationshipCount, graph.saving, mayEdit, peers, selectNode, space.name, viewerRole],
  )

  return (
    <AppShell header={header}>
      <Head title={space.name} />

      {/*
        An explicit height rather than `h-full`: the canvas has to fill the viewport
        below the 3.5rem header, and a percentage height needs every ancestor to have a
        resolved height to be meaningful.
      */}
      <div className="flex h-[calc(100svh-3.5rem)] w-full">
        <div className="flex min-w-0 flex-1 flex-col">
          <Breadcrumb
            spaceName={space.name}
            trail={graph.trail}
            focusNode={graph.focusNode}
            onNavigate={navigateTo}
            onAscend={ascend}
          />

          <div className="relative min-h-0 flex-1">
            {graph.error ? (
              <div
                role="alert"
                className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive"
              >
                <span>{graph.error}</span>
                <button type="button" onClick={graph.dismissError} className="font-medium underline">
                  Dismiss
                </button>
              </div>
            ) : null}


            {graph.truncated ? (
              <p className="absolute inset-x-0 bottom-0 z-10 bg-muted/90 px-4 py-1.5 text-center text-[11px] text-muted-foreground">
                Showing {graph.nodes.length} of {graph.nodeCount} nodes. Drill into a folder to see the rest.
              </p>
            ) : null}

            {graph.nodes.length === 0 && graph.focusNode ? (
              <div className="absolute inset-0 z-10 grid place-items-center">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">{graph.focusNode.title} contains nothing yet.</p>
                  {mayEdit ? (
                    <Button size="sm" variant="outline" className="mt-2" onClick={addNodeAtCentre}>
                      <Plus className="size-3" />
                      Add the first node inside it
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            <SpatialCanvas
              ref={canvasRef}
              nodes={graph.nodes}
              relationships={graph.relationships}
              neighbors={graph.neighbors}
              selectedNodeId={graph.selectedNodeId}
              focusNodeId={graph.focusNodeId}
              focusKey={graph.focusNodeId ?? 'root'}
              editable={mayEdit}
              peers={peers}
              autoRenameNodeId={autoRenameNodeId}
              onAutoRenameStarted={() => setAutoRenameNodeId(null)}
              onSelectNode={selectNode}
              onMoveNode={graph.moveNode}
              onConnectNodes={handleConnectNodes}
              onCreateNodeAt={(position) => void createNodeAt(position)}
              onDeleteRelationship={(relationshipId) => void graph.removeRelationship(relationshipId)}
              onDive={dive}
              onAscend={ascend}
              onDeleteNode={setDeleting}
              onRenameNode={(nodeId, title) => void graph.renameNode(nodeId, title)}
              onDuplicateNode={duplicateNode}
              onReparentNode={(nodeId, newParentNodeId) =>
                void graph.reparentNode(nodeId, newParentNodeId, graph.focusNodeId)
              }
              onOpenNeighbor={openNeighbor}
              onGoUp={goUp}
              onPointerPosition={(position) => publishCursor(position)}
            />

            {pendingPosition ? (
              <p className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-sm bg-popover px-3 py-1 text-xs shadow-md">
                Creating node…
              </p>
            ) : null}

            <NameRelationshipDialog
              open={pendingConnection !== null}
              sourceNode={graph.nodes.find((n) => n.id === pendingConnection?.sourceNodeId) ?? null}
              targetNode={graph.nodes.find((n) => n.id === pendingConnection?.targetNodeId) ?? null}
              onConfirm={confirmConnection}
              onCancel={() => setPendingConnection(null)}
            />

            <DeleteNodeDialog
              node={nodeById(deleting)}
              open={deleting !== null}
              onOpenChange={(open) => !open && setDeleting(null)}
              onConfirm={(cascade) => {
                const nodeId = deleting
                setDeleting(null)
                if (nodeId) void graph.removeNode(nodeId, cascade)
              }}
            />

            <DuplicateNodeDialog
              node={nodeById(duplicating)}
              open={duplicating !== null}
              onOpenChange={(open) => !open && setDuplicating(null)}
              onConfirm={(includeChildren) => {
                const nodeId = duplicating
                setDuplicating(null)
                if (nodeId) void graph.cloneNode(nodeId, includeChildren)
              }}
            />
          </div>
        </div>

        {/*
          Two presentations of one component. On a narrow screen a fixed column would
          leave the canvas unusable, so the inspector becomes a sheet over it; on a wide
          screen a sheet would hide the very thing the panel describes.
        */}
        {isMobile ? (
          <Sheet open={graph.selectedNodeId !== null} onOpenChange={(open) => !open && selectNode(null)}>
            <SheetContent side="right" className="w-full p-0 sm:max-w-lg" showCloseButton={false}>
              <SheetTitle className="sr-only">Node inspector</SheetTitle>
              <SheetDescription className="sr-only">
                Details and documentation for the selected node.
              </SheetDescription>
              {inspector}
            </SheetContent>
          </Sheet>
        ) : (
          <InspectorColumn open={graph.selectedNodeId !== null}>{inspector}</InspectorColumn>
        )}
      </div>
    </AppShell>
  )
}
