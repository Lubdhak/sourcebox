# frozen_string_literal: true

module Mutations
  class UpdateNode < BaseDocumentationMutation
    description <<~DESC
      Update a node's metadata, size or layer. Omitted fields are left unchanged.

      Position is not updatable here -- use `moveNodes`, which is shaped for the very
      different write pattern a drag produces.
    DESC

    argument :node_id, ID, description: "The node to update."
    argument :title, String, required: false
    argument :node_type, String, required: false
    argument :summary, String, required: false
    argument :width, Float, required: false
    argument :height, Float, required: false
    argument :depth, Float, required: false
    argument :layer_id, ID, required: false,
             description: "Move the node to this layer. Pass null to take it off every layer."
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

    # Only the keys the client actually sent survive, which is what makes this a partial
    # update. `layer_id` is cast here rather than left to ActiveRecord: it arrives as a
    # string ID, and the operation compares it against the current integer to decide
    # whether a layer change occurred, so an uncast value would report a change on every
    # save.
    def normalize(attributes)
      normalized = attributes.slice(:title, :node_type, :summary, :width, :height, :depth, :metadata)

      normalized[:layer_id] = attributes[:layer_id].presence&.to_i if attributes.key?(:layer_id)

      normalized
    end
  end
end
