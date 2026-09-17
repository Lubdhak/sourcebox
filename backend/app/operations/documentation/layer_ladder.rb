# frozen_string_literal: true

module Documentation
  # The mechanics of renumbering a space's depth ladder.
  #
  # Not an Operation: it has no actor and emits no event, because re-indexing is never
  # something a user asks for directly. They add a rung, remove one, or drag one, and the
  # renumbering is what makes the ladder contiguous afterwards. The operation that was
  # asked for is the one that reports.
  #
  # It exists as its own module because three callers need the same non-obvious trick.
  # `layers.index` is unique per space, so writing final indices directly collides as soon
  # as two rows trade places -- PostgreSQL enforces a unique index per row, not at
  # statement end. Every write here therefore goes out to a staging offset first and comes
  # back to its real index second. The offset is positive because the index validation
  # forbids negatives.
  #
  # Nodes are never touched. A node references its layer, not its depth number, so
  # re-indexing moves an entire depth of documentation without rewriting one node row.
  module LayerLadder
    INDEX_STAGING_OFFSET = 1_000_000

    class << self
      # Renumbers the ladder into a contiguous 0-based sequence.
      #
      # An explicit order is honoured for layers that belong to this space; any layer the
      # caller left out keeps its relative place at the bottom, so a partial list cannot
      # silently drop a depth.
      def renumber(space, ordered_layer_ids = nil)
        current = space.layers.ordered.pluck(:id)
        requested = Array(ordered_layer_ids).map(&:to_i) & current
        ids = requested + (current - requested)

        stage(space, ids)
        ids.each_with_index { |id, index| write(space, id, index) }

        ids
      end

      # Opens a hole at `index` by pushing it and everything below it one rung deeper.
      def shift_down_from(space, index)
        displaced = space.layers.where(index: index..).ordered.to_a
        return [] if displaced.empty?

        stage(space, displaced.map(&:id))
        displaced.each { |layer| write(space, layer.id, layer.index + 1) }

        displaced.map(&:id)
      end

      private

      # Offsetting by position rather than by a constant keeps this pass itself
      # collision-free.
      def stage(space, ids)
        ids.each_with_index do |id, offset|
          write(space, id, INDEX_STAGING_OFFSET + offset)
        end
      end

      def write(space, id, index)
        space.layers.where(id: id).update_all(index: index)
      end
    end
  end
end
