# frozen_string_literal: true

module Mutations
  class UpdateNode < BaseDocumentationMutation
    description <<~DESC
      Update a node's metadata or size. Omitted fields are left unchanged.

      Position is not updatable here -- use `moveNodes`, which is shaped for the very
      different write pattern a drag produces.
    DESC

    argument :node_id, ID, description: "The node to update."
    argument :title, String, required: false
    argument :summary, String, required: false
    argument :width, Float, required: false
    argument :height, Float, required: false
    argument :depth, Float, required: false
    argument :metadata, GraphQL::Types::JSON, required: false,
             description: "Merged key-by-key, so one client cannot wipe another's keys."

    field :node, Types::NodeType, null: true,
          description: "The updated node."

    def resolve(node_id:, **attributes)
      node = authorize_within_space!(Node.find_by(id: node_id), :write)

      { node: Documentation::UpdateNode.call(
        node: node,
        attributes: normalize(attributes),
        actor: current_user,
        request_id: context[:request_id]
      ) }
    end

    private

    def normalize(attributes)
      attributes.slice(:title, :summary, :width, :height, :depth, :metadata)
    end
  end
end
