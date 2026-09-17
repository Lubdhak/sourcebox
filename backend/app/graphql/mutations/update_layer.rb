# frozen_string_literal: true

module Mutations
  class UpdateLayer < BaseDocumentationMutation
    description "Rename a depth, or change what it says it is for."

    argument :layer_id, ID, description: "The layer to edit."
    argument :name, String, required: false, description: "New name."
    argument :description, String, required: false, description: "New description."

    field :layer, Types::LayerType, null: true,
          description: "The updated layer."

    def resolve(layer_id:, **attributes)
      layer = authorize_within_space!(Layer.find_by(id: layer_id), :write)

      updated = Documentation::UpdateLayer.call(
        layer: layer,
        **attributes.slice(:name, :description),
        actor: current_user,
        request_id: context[:request_id]
      )

      { layer: updated }
    end
  end
end
