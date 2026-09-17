# frozen_string_literal: true

module Documentation
  # Connects two nodes with a typed, directed edge.
  #
  # Both endpoints are looked up *through the space*, which is the single most important
  # line in this class: it is what makes an edge unable to span two spaces, and therefore
  # what stops an authorized space from being used to pull another user's node onto a
  # canvas. The model and a same-space validation back it up.
  class CreateRelationship < Operation
    def initialize(space:, source_node_id:, target_node_id:, relationship_type:, metadata: {}, **options)
      super(**options)

      @space = space
      @source_node_id = source_node_id
      @target_node_id = target_node_id
      @relationship_type = relationship_type.to_s
      @metadata = metadata || {}
    end

    def call
      source = find_in_space(@source_node_id, "source")
      target = find_in_space(@target_node_id, "target")

      # Idempotent by design.
      #
      # An optimistic client retries readily, and drawing the same edge twice is a no-op
      # in the user's mind, not an error they can act on. So an existing edge is returned
      # rather than reported as a validation failure -- and no event is emitted, because
      # nothing changed.
      existing = find_existing(source, target)
      return existing if existing

      relationship = NodeRelationship.create!(
        documentation_space: @space,
        source_node: source,
        target_node: target,
        relationship_type: @relationship_type,
        metadata: @metadata
      )

      publish(
        Events::Names::DOCUMENTATION_RELATIONSHIP_CREATED,
        space_id: @space.id,
        relationship_id: relationship.id,
        relationship_type: relationship.relationship_type,
        source_node_id: source.id,
        target_node_id: target.id
      )

      relationship
    rescue ActiveRecord::RecordNotUnique
      # Two clients drawing the same edge at the same time: both passed the check above
      # before either committed. The unique index is what makes this a caught race rather
      # than a duplicate edge.
      find_existing(source, target) || raise
    end

    private

    def find_existing(source, target)
      NodeRelationship.find_by(
        source_node_id: source.id,
        target_node_id: target.id,
        relationship_type: @relationship_type
      )
    end

    def find_in_space(id, role)
      node = @space.nodes.find_by(id: id)
      return node if node

      raise ApplicationGraphql::ValidationError,
            "The #{role} node does not exist in this space."
    end
  end
end
