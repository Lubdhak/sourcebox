# frozen_string_literal: true

module Documentation
  # Renumbers a node's blocks into a contiguous 0-based sequence.
  #
  # The unique index on (node_id, position) is what makes this non-trivial: writing the
  # final numbers directly collides the moment two blocks swap, because the first UPDATE
  # lands on a position the second has not vacated yet. PostgreSQL checks a unique index
  # per row, not at statement end, so ordering the updates cleverly does not help either.
  #
  # So it is done in two passes: move every row far out of the way, then write the final
  # positions into the space that leaves. The staging offset is positive because the
  # CHECK constraint forbids negative positions.
  #
  # Emits no event of its own. Reordering is always a consequence of another operation
  # (an insert, a delete, a drag in the block list), and that operation reports it.
  class ReorderContentBlocks < Operation
    def initialize(node:, ordered_block_ids: nil, **options)
      super(**options)

      @node = node
      @ordered_block_ids = ordered_block_ids
    end

    def call
      ActiveRecord::Base.transaction do
        ids = target_order

        # Pass one: out of the way. Offsetting by the row's own index keeps this pass
        # itself collision-free.
        ids.each_with_index do |id, index|
          @node.content_blocks.where(id: id)
               .update_all(position: ContentBlock::POSITION_STAGING_OFFSET + index)
        end

        # Pass two: the real positions, now that 0..n-1 is empty.
        ids.each_with_index do |id, index|
          @node.content_blocks.where(id: id).update_all(position: index)
        end

        ids
      end
    end

    private

    # An explicit order is honoured, but only for blocks that actually belong to this
    # node, and any block the caller omitted keeps its relative place at the end. A
    # partial list must not silently drop content.
    def target_order
      current = @node.content_blocks.reload.ordered.pluck(:id)
      return current if @ordered_block_ids.blank?

      requested = Array(@ordered_block_ids).map(&:to_i) & current

      requested + (current - requested)
    end
  end
end
