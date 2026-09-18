# frozen_string_literal: true

module Documentation
  # A bounded read of one space's graph: the nodes to draw and the edges between them.
  #
  # The canvas needs nodes and edges together, and the two constraints on that are in
  # tension. A graph is not a paginable list -- an edge whose other endpoint was left on
  # the next page renders as a line to nowhere -- but a space may hold 10,000 nodes and
  # nothing may load all of them.
  #
  # The resolution: filter first (by layer, by viewport), cap what comes back, and return
  # only edges whose *both* endpoints are in that set. The result is always internally
  # consistent, and `truncated?` tells the client it is looking at part of a larger graph
  # so it can say so rather than quietly lying.
  #
  # Three queries, independent of graph size: nodes, edges, and the space-wide counts the
  # UI shows.
  class GraphSnapshot
    # Not an Operation: this reads, so there is no actor and no event.
    Snapshot = Struct.new(
      :nodes, :relationships, :neighbors, :node_count, :relationship_count, :truncated,
      :focus_node, :trail,
      keyword_init: true
    ) do
      def truncated?
        truncated
      end
    end

    DEFAULT_LIMIT = 500

    # Above this, the browser is the bottleneck long before PostgreSQL is. The renderer
    # culls to the viewport, so a client that needs more should narrow instead.
    MAX_LIMIT = 2_000

    # How many edges out of the current view are followed to their far end.
    #
    # Small on purpose. These are context, not content: enough to see that the thing on
    # screen is wired to something elsewhere and to go there, not enough to redraw the
    # rest of the space around the edge of every folder.
    NEIGHBOR_LIMIT = 60

    def self.call(**kwargs)
      new(**kwargs).call
    end

    def initialize(space:, viewport: nil, limit: DEFAULT_LIMIT, focus_node_id: nil)
      @space = space
      @viewport = viewport
      @limit = limit.to_i.clamp(1, MAX_LIMIT)
      @focus_node_id = focus_node_id
    end

    def call
      focus = resolve_focus
      scope = filtered_nodes(focus)
      total = scope.count

      nodes = scope.ordered.limit(@limit).to_a
      node_ids = nodes.map(&:id)
      crossing = crossing_edges(node_ids)

      Snapshot.new(
        nodes: nodes,
        relationships: relationships_among(node_ids) + crossing,
        neighbors: neighbors_of(node_ids, crossing),
        node_count: total,
        relationship_count: @space.node_relationships.count,
        truncated: total > nodes.size,
        focus_node: focus,
        trail: focus ? AncestorTrail.call(node: focus) : []
      )
    end

    private

    # A focus id that does not resolve inside this space is treated as no focus rather
    # than as an error. The client holds a focus in its URL, and a node deleted by a
    # collaborator while someone was inside it should land them at the top of the space,
    # not on an error page.
    def resolve_focus
      return nil if @focus_node_id.blank?

      @space.nodes.find_by(id: @focus_node_id)
    end

    # With a focus, the canvas shows what that node contains -- the folder reading of the
    # graph. Without one it shows the space's outermost nodes, and *only* those.
    #
    # That second part is what makes containment mean something. A node added inside
    # another one used to be drawn at the top of the space as well, which made putting
    # something inside a node a way of adding clutter in two places at once: the top
    # level grew with every detail anyone documented anywhere, and there was no view of
    # the space that was just its shape. A node now appears in exactly one place -- among
    # its siblings, inside its parent -- and the way to see it is to open that parent.
    #
    # Only `contains` counts here. A node may also depend on, call or reference a dozen
    # others, and drawing those as its contents would make diving in produce a different
    # graph than the one the user built.
    #
    # A layer filter is the one thing that overrides this, because it is asking a
    # question the hierarchy cannot answer: "everything on this rung, wherever it lives".
    # Intersecting it with "top level only" would answer almost every such question with
    # an empty canvas, since depth beyond the first rung is by definition nested.
    def filtered_nodes(focus)
      scope = focus ? contained_by(focus) : outermost

      return scope if @viewport.blank?

      scope.within(
        @viewport[:min_x],
        @viewport[:min_y],
        @viewport[:max_x],
        @viewport[:max_y]
      )
    end

    # The nodes nothing contains: the top of the space.
    #
    # `NOT IN` over a subquery rather than a LEFT JOIN, which would need a DISTINCT to
    # undo the row multiplication a node with several parents causes. `target_node_id` is
    # NOT NULL, so the usual NULL trap with `NOT IN` does not apply.
    def outermost
      contained_ids = @space.node_relationships
                            .where(relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
                            .select(:target_node_id)

      @space.nodes.where.not(id: contained_ids)
    end

    def contained_by(focus)
      child_ids = @space.node_relationships
                        .where(source_node_id: focus.id, relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
                        .select(:target_node_id)

      @space.nodes.where(id: child_ids)
    end

    # Both endpoints, not either: an edge to a node that was filtered out or truncated
    # away cannot be drawn, and returning it would make the client hold references to
    # nodes it was never given.
    def relationships_among(node_ids)
      return [] if node_ids.empty?

      @space.node_relationships
            .where(source_node_id: node_ids, target_node_id: node_ids)
            .order(:id)
            .to_a
    end

    # Edges with one end on this canvas and the other somewhere else in the space.
    #
    # The counterpart to hiding nested nodes. Scoping the canvas to one level makes it
    # legible, but a component's relationships do not respect levels -- a module three
    # deep inside one service may well call another service's endpoint -- and a view that
    # silently dropped those edges would show the architecture as less connected than it
    # is. So they are returned, along with the node at the far end, for the client to draw
    # faintly and to offer as a way out of this level.
    #
    # `contains` is excluded, and that exclusion is load-bearing rather than tidiness:
    # every node on a canvas has a containment edge to its parent and to each of its
    # children, all of which are off-canvas by construction. Following those would put
    # back exactly the nodes this scoping just removed. Containment is expressed by the
    # breadcrumb and by diving in; these edges are the ones that are not.
    def crossing_edges(node_ids)
      return [] if node_ids.empty?

      @space.node_relationships
            .where.not(relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
            .where(
              "(source_node_id IN (:ids) AND target_node_id NOT IN (:ids)) OR " \
              "(target_node_id IN (:ids) AND source_node_id NOT IN (:ids))",
              ids: node_ids
            )
            .order(:id)
            .limit(NEIGHBOR_LIMIT)
            .to_a
    end

    def neighbors_of(node_ids, crossing)
      return [] if crossing.empty?

      outside = crossing.flat_map { |edge| [ edge.source_node_id, edge.target_node_id ] }.uniq - node_ids

      @space.nodes.where(id: outside).ordered.to_a
    end
  end
end
