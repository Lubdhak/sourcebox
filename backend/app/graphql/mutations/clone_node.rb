# frozen_string_literal: true

module Mutations
  class CloneNode < BaseDocumentationMutation
    description <<~DESC
      Copy a node, with or without the nodes inside it.

      The copy carries the original's documentation and lands beside it, inside the same
      parents. Relationships that leave the copied set are not copied -- see
      Documentation::CloneNode for why.
    DESC

    argument :node_id, ID, description: "The node to copy."
    argument :include_children, Boolean, required: false, default_value: false,
             description: "Copy everything inside it too, at any depth."

    field :node, Types::NodeType, null: true,
          description: "The new copy."

    def resolve(node_id:, include_children: false)
      node = authorize_within_space!(Node.find_by(id: node_id), :write)

      clone = Documentation::CloneNode.call(
        node: node,
        include_children: include_children,
        actor: current_user,
        request_id: context[:request_id]
      )

      { node: clone }
    end
  end
end
