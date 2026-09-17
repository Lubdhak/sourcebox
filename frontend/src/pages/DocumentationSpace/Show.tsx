import { Head } from '@inertiajs/react'
import { Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { AppShell } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { DeleteNodeDialog, DuplicateNodeDialog } from '@/features/documentation/actions/NodeActionDialogs'
import { Breadcrumb } from '@/features/documentation/canvas/Breadcrumb'
import { SpatialCanvas } from '@/features/documentation/canvas/SpatialCanvas'
import { PresenceBar } from '@/features/documentation/collaboration/PresenceBar'
import { useSpaceChannel } from '@/features/documentation/collaboration/useSpaceChannel'
import { InspectorColumn } from '@/features/documentation/inspector/InspectorColumn'
import { InspectorPanel } from '@/features/documentation/inspector/InspectorPanel'
import { useInspectorTrail } from '@/features/documentation/inspector/useInspectorTrail'
import { DepthMenu } from '@/features/documentation/layers/DepthMenu'
import { canEdit, ROLE_LABELS } from '@/features/documentation/roles'
import { SearchPanel } from '@/features/documentation/search/SearchPanel'
import { useGraphState } from '@/features/documentation/useGraphState'
import { useIsMobile } from '@/hooks/use-mobile'
import type { DocumentationNode, DocumentationSpacePageProps, NodeParent, SpatialPosition } from '@/types'

/**
 * The spatial documentation page.
 *
 * Composition only: it wires the canvas, the ladder, the inspector, search and the
 * realtime channel to one `useGraphState`, and decides whether the inspector is a column
 * or a sheet. No graph logic lives here -- the state hook owns the client's copy of the
 * graph, and the server owns the graph.
 *
 * The default relationship verb is `depends_on` rather than `contains`. Dragging a
 * connection is a statement about coupling far more often than about ownership, and the
 * verb is editable afterwards; defaulting to the hierarchical one would quietly push
 * every graph back towards a tree. Adding a node *inside* another one is the deliberate
 * exception, and it is a different gesture.
 */
const DEFAULT_RELATIONSHIP_TYPE = 'depends_on'

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
    initialLayers: space.layers,
    initialFocusNodeId: initialFocusFromUrl(),
  })

  // The socket hands structural messages straight to the graph state. This page does not
  // interpret them; it only decides that they belong together.
  const { peers, connected, publishCursor, publishPresence } = useSpaceChannel({
    spaceId: space.id,
    onGraphMessage: graph.applyRealtime,
  })

  const [pendingPosition, setPendingPosition] = useState<SpatialPosition | null>(null)

  // Where the inspector has been, so a link it followed can be walked back the way it
  // came. Every callback below that moves the *canvas* clears it: those are moves around
  // the map, and none of them continues a path through the reading. See
  // `useInspectorTrail`.
  const history = useInspectorTrail()

  const createNodeAt = useCallback(
    async (position: SpatialPosition, parentNodeId?: string | null) => {
      setPendingPosition(position)
      history.reset()

      // Created with a placeholder title and immediately selected, rather than behind a
      // modal asking for a name. The inspector is already the place where a node is
      // edited, so opening it on a new node is one fewer dialog and one fewer concept.
      //
      // Inside a drill-down the current focus is the parent, which is what makes "add"
      // mean "add here" rather than "add somewhere in this space".
      const node = await graph.addNode({
        title: 'Untitled node',
        nodeType: 'concept',
        x: position.x,
        y: position.y,
        layerId: graph.layerFilter,
        parentNodeId: parentNodeId ?? graph.focusNodeId,
      })

      setPendingPosition(null)

      // The canvas may have followed the new node to another level, so the collaborators'
      // markers have to follow it too.
      if (node) {
        publishPresence({ focusNodeId: node.parents?.[0]?.id ?? null, selectedNodeId: node.id })
      }
    },
    [graph, history, publishPresence],
  )

  const scatteredPosition = useCallback(
    (): SpatialPosition => ({
      // No viewport information here, so new nodes from a toolbar are scattered near the
      // origin rather than stacked exactly on top of each other. Double-clicking the
      // canvas is the placement-aware path.
      x: Math.round((Math.random() - 0.5) * 400),
      y: Math.round((Math.random() - 0.5) * 300),
      z: 0,
    }),
    [],
  )

  const addNodeAtCentre = useCallback(() => {
    void createNodeAt(scatteredPosition())
  }, [createNodeAt, scatteredPosition])

  const connectNodes = useCallback(
    (sourceNodeId: string, targetNodeId: string) => {
      void graph.connectNodes(sourceNodeId, targetNodeId, DEFAULT_RELATIONSHIP_TYPE)
    },
    [graph],
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
      // Keyed by node id so switching selection remounts the panel. Without it, the
      // editing state of the previous node -- an open block editor, a half-typed title --
      // would carry over onto a different node's documentation.
      key={graph.selectedNodeId}
      nodeId={graph.selectedNodeId}
      spaceId={space.id}
      layers={graph.layers}
      // The nodes on screen, offered first when the author types `@`. Search covers the
      // rest of the space; this covers the case that needs no round trip.
      levelNodes={graph.nodes}
      editable={mayEdit}
      // Present only while a link has been followed, which is the only time there is
      // somewhere to go back to.
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

          <DepthMenu
            layers={graph.layers}
            activeLayerId={graph.layerFilter}
            busy={graph.saving}
            // Filtering by depth is reading, so everyone keeps it. Editing the ladder is
            // a structural change to the space and goes with the other writes.
            editable={mayEdit}
            onSelect={graph.setLayerFilter}
            onAdd={() => void graph.addLayer()}
            onRename={(layerId, name) => void graph.renameLayer(layerId, name)}
            onRemove={(layerId) => void graph.removeLayer(layerId)}
          />

          {mayEdit ? (
            <Button size="sm" onClick={addNodeAtCentre} disabled={graph.saving}>
              <Plus className="size-4" />
              <span className="hidden sm:inline">Add node</span>
            </Button>
          ) : null}
        </div>
      </div>
    ),
    [addNodeAtCentre, collaborator, connected, graph.addLayer, graph.layerFilter, graph.layers, graph.nodeCount, graph.relationshipCount, graph.removeLayer, graph.renameLayer, graph.saving, graph.setLayerFilter, mayEdit, peers, selectNode, space.id, space.name, viewerRole],
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
                Showing {graph.nodes.length} of {graph.nodeCount} nodes. Filter by depth to see the rest.
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
              nodes={graph.nodes}
              relationships={graph.relationships}
              neighbors={graph.neighbors}
              layers={graph.layers}
              selectedNodeId={graph.selectedNodeId}
              focusNodeId={graph.focusNodeId}
              focusKey={graph.focusNodeId ?? 'root'}
              editable={mayEdit}
              peers={peers}
              onSelectNode={selectNode}
              onMoveNode={graph.moveNode}
              onConnectNodes={connectNodes}
              onCreateNodeAt={(position) => void createNodeAt(position)}
              onDeleteRelationship={(relationshipId) => void graph.removeRelationship(relationshipId)}
              onDive={dive}
              onAscend={ascend}
              onDeleteNode={setDeleting}
              onRenameNode={(nodeId, title) => void graph.renameNode(nodeId, title)}
              onDuplicateNode={duplicateNode}
              // The level on screen is the containment a dragged node is leaving, which is
              // what keeps a node filed in two places from losing the other one.
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
