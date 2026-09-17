# frozen_string_literal: true

module Documentation
  # Moves a node from one containment to another, or out of containment entirely.
  #
  # Two edge writes, and the reason it is one operation rather than the client issuing a
  # create and a delete is that half of it is a broken graph: a node briefly inside both
  # its old and its new parent appears twice on two canvases, and one that is out of the
  # old parent but not yet in the new one has, for that moment, been moved to the top of
  # the space. Both are visible to everyone else in the space, since each write
  # broadcasts. One transaction and one event instead.
  #
  # `from_parent_id` is the parent being left, not "every parent". Containment is
  # many-to-many by design -- a `users` table legitimately sits inside both Identity and
  # Billing -- so dragging that table out of Identity must not also remove it from
  # Billing. The client passes the context the drag happened in, which is the only place
  # that knows which of several parents the user was looking at.
  class ReparentNode < Operation
    def initialize(node:, new_parent_id: nil, from_parent_id: nil, **options)
      super(**options)

      @node = node
      @new_parent_id = new_parent_id
      @from_parent_id = from_parent_id
    end

    def call
      new_parent = resolve_new_parent
      from_parent_id = @from_parent_id.presence

      ActiveRecord::Base.transaction do
        if from_parent_id
          containment.where(source_node_id: from_parent_id, target_node_id: @node.id).destroy_all
        end

        if new_parent
          # Idempotent: dragging a node into something it is already inside is a no-op
          # the user cannot act on, not an error. `find_or_create_by!` also survives two
          # people doing it at once, which the unique index would otherwise turn into a
          # 500.
          NodeRelationship.find_or_create_by!(
            documentation_space_id: space.id,
            source_node_id: new_parent.id,
            target_node_id: @node.id,
            relationship_type: NodeRelationship::HIERARCHICAL_TYPE
          )
        end
      end

      publish(
        Events::Names::DOCUMENTATION_NODE_REPARENTED,
        space_id: space.id,
        node_id: @node.id,
        new_parent_id: new_parent&.id,
        from_parent_id: from_parent_id
      )

      @node.reload
    end

    private

    def space
      @node.documentation_space
    end

    def containment
      space.node_relationships.where(relationship_type: NodeRelationship::HIERARCHICAL_TYPE)
    end

    def resolve_new_parent
      return nil if @new_parent_id.blank?

      parent = space.nodes.find_by(id: @new_parent_id)

      raise ApplicationGraphql::ValidationError, "That node is not in this space." if parent.nil?

      if parent.id == @node.id
        raise ApplicationGraphql::ValidationError, "A node cannot be placed inside itself."
      end

      # The check that keeps the containment graph navigable. Putting a node inside one of
      # its own descendants makes that whole branch unreachable from the space: the only
      # way down to it would be through the node now sitting underneath it.
      if Subtree.contains?(node: @node, candidate_id: parent.id)
        raise ApplicationGraphql::ValidationError,
              "“#{parent.title}” is inside “#{@node.title}”, so it cannot also contain it."
      end

      parent
    end
  end
end
