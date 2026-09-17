# frozen_string_literal: true

module Documentation
  # Removes a rung and closes the gap it leaves.
  #
  # The nodes that sat on it survive, unlayered: `has_many :nodes, dependent: :nullify`.
  # Deleting the "Modules" rung must not delete everything documented at that depth, and a
  # node with no layer is already a supported state -- the layer is a filtering dimension,
  # not the node's identity.
  class DeleteLayer < Operation
    def initialize(layer:, **options)
      super(**options)

      @layer = layer
    end

    def call
      space = @layer.documentation_space
      layer_id = @layer.id
      index = @layer.index
      orphaned = @layer.nodes.count

      ActiveRecord::Base.transaction do
        @layer.destroy!
        # Without this the ladder reads 0, 1, 3, 4 and every later insert has to reason
        # about holes. Contiguity is cheap to maintain here and removes a whole class of
        # off-by-one from the drill-down, which walks the ladder one rung at a time.
        LayerLadder.renumber(space)
      end


      publish(
        Events::Names::DOCUMENTATION_LAYER_DELETED,
        space_id: space.id,
        layer_id: layer_id,
        index: index,
        unlayered_node_count: orphaned
      )

      layer_id
    end
  end
end
