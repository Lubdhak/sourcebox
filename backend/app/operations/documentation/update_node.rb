# frozen_string_literal: true

module Documentation
  # Applies a partial update to a node's metadata, size or layer.
  #
  # Position is deliberately not updatable here -- see MoveNodes. Dragging produces a
  # different shape of write (many nodes, high frequency, coalesced) from editing a title,
  # and giving them one entry point would mean either validating a whole node on every
  # frame of a drag or skipping validation when a title changes.
  class UpdateNode < Operation
    # `metadata` is merged key-by-key; everything else replaces.
    ASSIGNABLE = %i[title node_type summary width height depth layer_id].freeze

    def initialize(node:, attributes:, **options)
      super(**options)

      @node = node
      @attributes = attributes.symbolize_keys
    end

    def call
      changes = @attributes.slice(*ASSIGNABLE)
      layer_changed = changes.key?(:layer_id) && changes[:layer_id] != @node.layer_id
      previous_layer_id = @node.layer_id

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
        # Which fields moved, never their values: this payload is persisted as a job
        # argument and must not become a copy of the user's documentation.
        changed_keys: changed_keys
      )

      if layer_changed
        publish(
          Events::Names::DOCUMENTATION_LAYER_CHANGED,
          space_id: @node.documentation_space_id,
          node_id: @node.id,
          from_layer_id: previous_layer_id,
          to_layer_id: @node.layer_id
        )
      end

      @node
    end
  end
end
