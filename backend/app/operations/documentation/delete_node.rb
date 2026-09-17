# frozen_string_literal: true

module Documentation
  # Removes a node, its content blocks and every edge touching it.
  #
  # A hard delete, not a soft one. Soft deletion would have to be honoured by every graph
  # query, every edge traversal and the search index, and its only payoff here -- knowing
  # what used to exist -- is already covered by the event stream and the audit trail.
  # Nothing in the product asks to browse deleted documentation.
  #
  # What happens to the nodes *inside* it is the caller's decision, because the two answers
  # are both right and mean different things. Deleting a service you have decided against
  # should take its modules with it (`cascade`). Deleting a grouping you no longer find
  # useful should not destroy the work filed under it -- so by default the children move up
  # into whatever contained the node, which is where a reader would next look for them.
  #
  # Leaving them alone was the third option and is the one thing this must not do: with the
  # canvas scoped to one level, a child whose only parent was deleted has no level to
  # appear on except the top of the space, so "nothing happens to them" would silently
  # empty a service's contents onto the front page.
  class DeleteNode < Operation
    def initialize(node:, cascade: false, **options)
      super(**options)

      @node = node
      @cascade = cascade
    end

    def call
      impact = DeletionImpact.call(node: @node)
      space_id = @node.documentation_space_id
      node_id = @node.id
      doomed = @cascade ? [ @node ] + impact.descendants : [ @node ]

      counts = ActiveRecord::Base.transaction do
        removed = {
          block_count: ContentBlock.where(node_id: doomed.map(&:id)).count,
          # Counted before the destroy, and counted from both directions: an edge is
          # deleted whether this node was its source or its target.
          relationship_count: NodeRelationship.for_nodes(doomed.map(&:id)).distinct.count,
          node_count: doomed.size,
          # Ids, so collaborators can drop the whole subtree rather than refetch for it.
          node_ids: doomed.map(&:id),
        }

        # Re-homed before anything is destroyed, so the containment edges being read are
        # still there.
        adopt_children_of(@node) unless @cascade

        Node.where(id: doomed.map(&:id)).destroy_all

        removed
      end

      publish(
        Events::Names::DOCUMENTATION_NODE_DELETED,
        space_id: space_id,
        node_id: node_id,
        cascade: @cascade,
        **counts
      )

      node_id
    end

    private

    # The children take the deleted node's place in the hierarchy: whatever contained it
    # now contains them. With no parent, the node was at the top of the space and its
    # children rise to the top too, which is the same statement.
    def adopt_children_of(node)
      space = node.documentation_space
      containment = space.node_relationships.where(relationship_type: NodeRelationship::HIERARCHICAL_TYPE)

      grandparent_ids = containment.where(target_node_id: node.id).pluck(:source_node_id)
      child_ids = containment.where(source_node_id: node.id).pluck(:target_node_id)

      grandparent_ids.product(child_ids).each do |parent_id, child_id|
        next if parent_id == child_id

        NodeRelationship.find_or_create_by!(
          documentation_space_id: space.id,
          source_node_id: parent_id,
          target_node_id: child_id,
          relationship_type: NodeRelationship::HIERARCHICAL_TYPE
        )
      end
    end
  end
end
