# frozen_string_literal: true

module Mutations
  class ReorderLayers < BaseDocumentationMutation
    description <<~DESC
      Reorder the depth ladder.

      Layers left out of `orderedLayerIds` keep their relative place at the bottom, so a
      partial list cannot silently drop a depth.
    DESC

    argument :space_id, ID, description: "The space whose ladder is being reordered."
    argument :ordered_layer_ids, [ ID ], description: "Layer ids, shallowest first."

    field :layers, [ Types::LayerType ], null: true,
          description: "The ladder in its new order."

    def resolve(space_id:, ordered_layer_ids:)
      space = authorize_space_by_public_id!(space_id, :write)

      layers = Documentation::ReorderLayers.call(
        space: space,
        ordered_layer_ids: ordered_layer_ids,
        actor: current_user,
        request_id: context[:request_id]
      )

      { layers: layers }
    end
  end
end
