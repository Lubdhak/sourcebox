# frozen_string_literal: true

module Mutations
  class CreateLayer < BaseDocumentationMutation
    description <<~DESC
      Add a rung to a space's depth ladder.

      Depth is open-ended: a space can be decomposed as far as its authors need, and
      omitting `index` appends a new deepest rung. Passing an `index` inserts there and
      pushes the rungs below it one deeper.
    DESC

    argument :space_id, ID, description: "The space whose ladder gains a rung."
    argument :name, String, required: false,
             description: "What this depth is called. Defaults to `Depth N`."
    argument :description, String, required: false, description: "What belongs at this depth."
    argument :index, Int, required: false,
             description: "Insert at this depth instead of appending. Clamped to the ladder."

    field :layer, Types::LayerType, null: true,
          description: "The new layer."
    field :layers, [ Types::LayerType ], null: true, description: "The whole ladder, re-indexed."

    def resolve(space_id:, **attributes)
      space = authorize_space_by_public_id!(space_id, :write)

      layer = Documentation::CreateLayer.call(
        space: space,
        name: attributes[:name],
        description: attributes[:description],
        index: attributes[:index],
        actor: current_user,
        request_id: context[:request_id]
      )

      # The whole ladder comes back, not just the new rung: inserting re-indexes
      # everything below it, so a client that merged one layer locally would be showing
      # stale depths for the rest.
      { layer: layer, layers: space.layers.ordered.to_a }
    end
  end
end
