# frozen_string_literal: true

module Documentation
  # Removes a block and closes the gap it leaves.
  #
  # Compacting matters because positions are contiguous by contract: the editor inserts by
  # index, so a hole would make "insert at 2" ambiguous and would eventually collide with
  # the unique index.
  class DeleteContentBlock < Operation
    def initialize(block:, **options)
      super(**options)

      @block = block
      @options = options
    end

    def call
      node = @block.node
      block_id = @block.id
      block_type = @block.block_type

      ActiveRecord::Base.transaction do
        @block.destroy!
        ReorderContentBlocks.call(node: node, **@options)
      end

      publish(
        Events::Names::DOCUMENTATION_BLOCK_DELETED,
        space_id: node.documentation_space_id,
        node_id: node.id,
        block_id: block_id,
        block_type: block_type
      )

      block_id
    end
  end
end
