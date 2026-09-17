# frozen_string_literal: true

module Documentation
  # What deleting one node would actually take with it.
  #
  # Read-only, and it exists so that a confirmation can name things instead of warning
  # about them. "Delete Order Service?" is not a question anyone can answer if the service
  # holds forty nodes of documentation; "Delete Order Service and the 40 nodes inside it,
  # including orders, payments and Stripe Webhook Handler?" is.
  #
  # The same applies to the edges, and more sharply. "2 relationships would go" is a
  # number nobody can weigh: the two might be an incidental `related_to` or they might be
  # the only record that this service is what the payment gateway calls. So every edge is
  # named in full -- both ends and the verb -- because the ends are what make an edge
  # worth keeping or not.
  #
  # It also draws the distinction the delete itself makes: a node inside the one being
  # deleted, which is *also* inside something else, is not destroyed -- it keeps living in
  # its other home and only loses this containment. Reporting that separately is the
  # difference between a dialog that is accurate and one that overstates what it is about
  # to do.
  class DeletionImpact
    Impact = Struct.new(
      :node,
      :descendants,
      :retained,
      :relationships,
      :relationship_count,
      :descendant_relationship_count,
      :block_count,
      :descendant_block_count,
      keyword_init: true
    )

    # An edge, said as a sentence. Both titles rather than ids, because the dialog exists
    # to be read by the person who wrote these nodes, not resolved by a client.
    Edge = Struct.new(:id, :relationship_type, :source_title, :target_title, keyword_init: true)

    # Long enough to cover anything a person will read, short enough that a hub node with
    # a thousand edges does not turn a confirmation into a page load. Past this the dialog
    # falls back to the count, which is all anyone would take from the list anyway.
    MAX_LISTED_EDGES = 200

    def self.call(**kwargs)
      new(**kwargs).call
    end

    def initialize(node:)
      @node = node
    end

    def call
      descendants = Subtree.call(node: @node)
      descendant_ids = descendants.map(&:id)
      doomed_ids = [ @node.id ] + descendant_ids
      retained_ids = descendant_ids.select { |id| parent_outside?(id, doomed_ids) }

      # Only the node's own edges are named. Those are the ones that go whichever option
      # the user takes; the rest are attached to the nodes inside, which are listed
      # separately and only removed by a cascading delete. Mixing them would mean the
      # dialog described a consequence of the button next to the one being hovered.
      own_edges = own_relationships

      Impact.new(
        node: @node,
        # Split rather than mixed: these are the nodes that would cease to exist.
        descendants: descendants.reject { |descendant| retained_ids.include?(descendant.id) },
        retained: descendants.select { |descendant| retained_ids.include?(descendant.id) },
        relationships: own_edges.first(MAX_LISTED_EDGES).map { |edge| describe(edge) },
        relationship_count: own_edges.size,
        # What the extra option costs, counted the same way the delete performs it.
        descendant_relationship_count: descendant_ids.empty? ? 0 : NodeRelationship.for_nodes(doomed_ids).distinct.count - own_edges.size,
        block_count: ContentBlock.where(node_id: @node.id).count,
        descendant_block_count: descendant_ids.empty? ? 0 : ContentBlock.where(node_id: descendant_ids).count
      )
    end

    private

    def own_relationships
      @own_relationships ||= @node.documentation_space
                                  .node_relationships
                                  .for_nodes([ @node.id ])
                                  .distinct
                                  .order(:relationship_type, :id)
                                  .to_a
    end

    # One query for the titles at both ends of every edge, rather than two per edge.
    def titles
      @titles ||= begin
        ids = own_relationships.flat_map { |edge| [ edge.source_node_id, edge.target_node_id ] }.uniq

        Node.where(id: ids).pluck(:id, :title).to_h
      end
    end

    def describe(edge)
      Edge.new(
        id: edge.id,
        relationship_type: edge.relationship_type,
        source_title: titles[edge.source_node_id] || "a deleted node",
        target_title: titles[edge.target_node_id] || "a deleted node"
      )
    end

    def parent_outside?(node_id, doomed_ids)
      @node.documentation_space
           .node_relationships
           .where(target_node_id: node_id, relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
           .where.not(source_node_id: doomed_ids)
           .exists?
    end
  end
end
