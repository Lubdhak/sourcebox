# frozen_string_literal: true

module Documentation
  # Creates or updates one content block on a node.
  #
  # One operation rather than separate create and update paths, because the editor does
  # not distinguish them: a user adds a Markdown block and starts typing, and every
  # keystroke batch after the first is an update to the block the first one created. A
  # single entry point means the client sends the same mutation either way and keeps one
  # optimistic code path.
  class UpsertContentBlock < Operation
    def initialize(node:, block_id: nil, block_type: nil, data: nil, position: nil, **options)
      super(**options)

      @node = node
      @block_id = block_id
      @block_type = block_type
      @data = data
      @position = position
      @options = options
    end

    def call
      block = existing_block || @node.content_blocks.new(position: next_position)

      block.block_type = @block_type if @block_type.present?
      block.data = @data unless @data.nil?

      changed = block.new_record? || block.changed?
      block.save! if changed

      moved = reposition(block)

      # Debounced editors re-send unchanged content readily. A save that changes nothing
      # should not bump updated_at or emit an event.
      return block unless changed || moved

      publish(
        Events::Names::DOCUMENTATION_BLOCK_UPDATED,
        space_id: @node.documentation_space_id,
        node_id: @node.id,
        block_id: block.id,
        block_type: block.block_type
      )

      block.reload
    end

    private

    # Scoped to the node, so a block id belonging to another node -- and therefore
    # possibly to another space -- is not found rather than reparented.
    def existing_block
      return nil if @block_id.blank?

      @node.content_blocks.find_by(id: @block_id) || raise(ApplicationGraphql::NotFoundError)
    end

    # Appends. `MAX(position) + 1` rather than `COUNT(*)`, because the two disagree
    # whenever a delete has left a gap, and a collision with the unique index on
    # (node_id, position) is a 500 rather than a validation error.
    def next_position
      (@node.content_blocks.maximum(:position) || -1) + 1
    end

    # An explicit position means "insert here", which moves every sibling below it. That
    # is a reordering, so it is delegated rather than reimplemented -- ReorderContentBlocks
    # is the one place that knows how to renumber without tripping the unique index.
    def reposition(block)
      return false if @position.nil?

      target = normalized_position
      ordered_ids = @node.content_blocks.reload.ordered.pluck(:id)
      current = ordered_ids.index(block.id)
      return false if current.nil? || current == target

      ordered_ids.delete(block.id)
      ordered_ids.insert(target.clamp(0, ordered_ids.size), block.id)

      ReorderContentBlocks.call(node: @node, ordered_block_ids: ordered_ids, **@options)

      true
    end

    def normalized_position
      [ Integer(@position), 0 ].max
    rescue TypeError, ArgumentError
      raise ApplicationGraphql::ValidationError, "position must be an integer."
    end
  end
end
