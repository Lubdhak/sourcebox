# frozen_string_literal: true

module Documentation
  # Adds a rung to a space's depth ladder, at the bottom or inserted mid-ladder.
  #
  # Depth is open-ended, so this is an ordinary create. The only subtlety is insertion:
  # making room at index 3 pushes every layer from 3 down one rung deeper, which
  # LayerLadder does without tripping the unique index on (space, index).
  class CreateLayer < Operation
    def initialize(space:, name: nil, description: nil, index: nil, **options)
      super(**options)

      @space = space
      @name = name
      @description = description
      @index = index
    end

    def call
      layer = ActiveRecord::Base.transaction do
        target = target_index
        LayerLadder.shift_down_from(@space, target)

        @space.layers.create!(
          index: target,
          name: @name.presence || Layer.default_name_for(target),
          description: @description
        )
      end


      publish(
        Events::Names::DOCUMENTATION_LAYER_CREATED,
        space_id: @space.id,
        layer_id: layer.id,
        index: layer.index
      )

      layer
    end


    private

    # A requested index is clamped to the ladder rather than rejected: asking for depth 12
    # of a five-rung ladder means "at the bottom", which is what the caller wants, and an
    # error there would be pedantry.
    def target_index
      bottom = @space.layers.maximum(:index)
      return 0 if bottom.nil?
      return bottom + 1 if @index.nil?


      @index.to_i.clamp(0, bottom + 1)
    end
  end
end
