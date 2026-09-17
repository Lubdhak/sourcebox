# frozen_string_literal: true

module Mutations
  class DeleteNode < BaseDocumentationMutation
    description "Remove a node, its content blocks and every edge touching it."

    argument :node_id, ID, description: "The node to delete."
    argument :cascade, Boolean, required: false, default_value: false,
             description: <<~ARG
               Delete everything inside it as well.

               False moves the nodes it contains up into whatever contained it, so the
               work filed under a grouping survives the grouping. A descendant that also
               lives somewhere else is never destroyed either way -- it only loses this
               containment. Use `nodeDeletionImpact` to show which is which before asking.
             ARG

    field :deleted_node_id, ID, null: true,
          description: "The id of the removed node, so the client can drop it."

    def resolve(node_id:, cascade: false)
      node = authorize_within_space!(Node.find_by(id: node_id), :write)

      deleted_id = Documentation::DeleteNode.call(
        node: node,
        cascade: cascade,
        actor: current_user,
        request_id: context[:request_id]
      )

      { deleted_node_id: deleted_id.to_s }
    end
  end
end
