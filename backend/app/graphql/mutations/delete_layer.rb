# frozen_string_literal: true

module Mutations
  class DeleteLayer < BaseDocumentationMutation
    description <<~DESC
      Remove a rung from the ladder.

      The nodes on it are kept and left unlayered. A layer is a depth to view the graph
      at, not the identity of what is documented there.
    DESC

    argument :layer_id, ID, description: "The layer to remove."

    field :deleted_layer_id, ID, null: true,
          description: "The id that no longer exists."
    field :layers, [ Types::LayerType ], null: true, description: "The remaining ladder, re-indexed."

    def resolve(layer_id:)
      layer = authorize_within_space!(Layer.find_by(id: layer_id), :write)
      space = layer.documentation_space

      deleted_id = Documentation::DeleteLayer.call(
        layer: layer,
        actor: current_user,
        request_id: context[:request_id]
      )

      { deleted_layer_id: deleted_id.to_s, layers: space.layers.reload.ordered.to_a }
    end
  end
end
