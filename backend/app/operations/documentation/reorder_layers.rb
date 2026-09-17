# frozen_string_literal: true

module Documentation
  # Moves rungs around the ladder.
  #
  # Separate from UpdateLayer on purpose: this rewrites the index of every layer the user
  # did not touch, and that should not share an entry point with renaming one.
  class ReorderLayers < Operation
    def initialize(space:, ordered_layer_ids:, **options)
      super(**options)

      @space = space
      @ordered_layer_ids = ordered_layer_ids
    end

    def call
      ids = ActiveRecord::Base.transaction { LayerLadder.renumber(@space, @ordered_layer_ids) }

      publish(
        Events::Names::DOCUMENTATION_LAYER_UPDATED,
        space_id: @space.id,
        layer_ids: ids,
        changed: [ "index" ]
      )

      @space.layers.ordered.to_a
    end
  end
end
