# frozen_string_literal: true

module Documentation
  # Removes one edge. The nodes it connected are untouched -- that is the point of keeping
  # relationships in their own table rather than as a parent_id on the node.
  class DeleteRelationship < Operation
    def initialize(relationship:, **options)
      super(**options)

      @relationship = relationship
    end

    def call
      attributes = {
        space_id: @relationship.documentation_space_id,
        relationship_id: @relationship.id,
        relationship_type: @relationship.relationship_type,
        source_node_id: @relationship.source_node_id,
        target_node_id: @relationship.target_node_id,
      }

      @relationship.destroy!

      publish(Events::Names::DOCUMENTATION_RELATIONSHIP_DELETED, **attributes)

      attributes[:relationship_id]
    end
  end
end
