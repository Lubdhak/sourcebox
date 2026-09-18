# frozen_string_literal: true

module Documentation
  # Applies a partial update to a node's metadata or size.
  #
  # Position is deliberately not updatable here -- see MoveNodes. Dragging produces a
  # different shape of write (many nodes, high frequency, coalesced) from editing a title,
  # and giving them one entry point would mean either validating a whole node on every
  # frame of a drag or skipping validation when a title changes.
  class UpdateNode < Operation
    ASSIGNABLE = %i[title summary width height depth].freeze

    def initialize(node:, attributes:, **options)
      super(**options)

      @node = node
      @attributes = attributes.symbolize_keys
    end

    def call
      changes = @attributes.slice(*ASSIGNABLE)

      if @attributes.key?(:metadata)
        # Merged rather than replaced, for the same reason widgetSettings is: one client
        # saving the key it owns must not wipe keys written by another.
        incoming = @attributes[:metadata]
        raise ApplicationGraphql::ValidationError, "metadata must be an object" unless incoming.is_a?(Hash)

        changes[:metadata] = @node.metadata.merge(incoming.deep_stringify_keys)
      end

      @node.assign_attributes(**changes)

      # No-op updates are common with an optimistic client that re-sends state readily,
      # and they should not bump updated_at or emit an event.
      return @node unless @node.changed?

      changed_keys = @node.changed
      @node.save!

      publish(
        Events::Names::DOCUMENTATION_NODE_UPDATED,
        space_id: @node.documentation_space_id,
        node_id: @node.id,
        changed_keys: changed_keys
      )

      @node
    end
  end
end
