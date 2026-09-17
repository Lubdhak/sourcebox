# frozen_string_literal: true

module Documentation
  # Everything contained by one node, at any depth.
  #
  # The counterpart to AncestorTrail, and it exists because three separate operations need
  # the same answer and would otherwise each walk the graph their own way: moving a node
  # must refuse to put it inside something it contains, cloning it may have to copy what
  # is inside, and deleting it has to say what else goes.
  #
  # Breadth-first, one indexed query per level, rather than a recursive CTE. The CTE would
  # be a single round trip, but the traversal has to be bounded and de-duplicated: this is
  # a DAG, so the same node is reachable by several paths, and nothing in the schema
  # forbids a `contains` cycle -- forbidding it would mean a graph walk on every edge
  # write. `visited` makes a cycle terminate instead of hanging, and MAX_NODES stops a
  # pathological graph from pulling the whole space into memory.
  class Subtree
    # Generous, because this is a real answer a user may want ("delete this service and
    # the 300 things in it") and stingy compared to a space, which may hold 10,000 nodes.
    MAX_NODES = 2_000

    def self.call(**kwargs)
      new(**kwargs).call
    end

    def initialize(node:, max_nodes: MAX_NODES)
      @node = node
      @max_nodes = max_nodes
    end

    # The descendants, nearest first, excluding the node itself. Ordering is by distance
    # rather than by id, which is what makes a confirmation dialog read as a hierarchy.
    def call
      ids = descendant_ids
      by_id = Node.where(id: ids).index_by(&:id)

      ids.filter_map { |id| by_id[id] }
    end

    # Ids only, for callers counting rather than showing.
    def descendant_ids
      found = []
      visited = Set.new([ @node.id ])
      frontier = [ @node.id ]

      while frontier.any? && found.size < @max_nodes
        children = child_ids_of(frontier).reject { |id| visited.include?(id) }
        break if children.empty?

        visited.merge(children)
        frontier = children
        found.concat(children)
      end

      found.first(@max_nodes)
    end

    # Whether `candidate` is this node or somewhere inside it.
    #
    # The question a reparent has to ask before it moves anything: putting a node inside
    # its own descendant detaches that whole branch from the space, since the only way in
    # would be through the node that is now underneath it.
    def self.contains?(node:, candidate_id:)
      return true if node.id == candidate_id

      new(node: node).descendant_ids.include?(candidate_id)
    end

    private

    def child_ids_of(node_ids)
      NodeRelationship
        .where(
          documentation_space_id: @node.documentation_space_id,
          source_node_id: node_ids,
          relationship_type: NodeRelationship::HIERARCHICAL_TYPE
        )
        .order(:target_node_id)
        .pluck(:target_node_id)
        .uniq
    end
  end
end
