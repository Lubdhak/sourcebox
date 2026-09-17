# frozen_string_literal: true

module Mutations
  class ReparentNode < BaseDocumentationMutation
    description <<~DESC
      Move a node into another node, or out of the one it is in.

      This is the drag-and-drop gesture on the canvas: dropping a card onto another files
      it inside, dropping it onto a breadcrumb moves it up to that ancestor, and a null
      `newParentId` takes it to the top of the space.
    DESC

    argument :node_id, ID, description: "The node being moved."
    argument :new_parent_id, ID, required: false,
             description: "Where it should live. Null puts it at the top of the space."
    argument :from_parent_id, ID, required: false,
             description: <<~ARG
               The parent it is being taken out of.

               Sent by the client because containment is many-to-many: a node inside two
               systems dragged out of one must stay in the other, and only the client
               knows which of them the user was looking at. Null leaves every existing
               parent in place, which is how a node is filed in an additional place
               rather than moved.
             ARG

    field :node, Types::NodeType, null: true,
          description: "The moved node."

    def resolve(node_id:, new_parent_id: nil, from_parent_id: nil)
      node = authorize_within_space!(Node.find_by(id: node_id), :write)

      moved = Documentation::ReparentNode.call(
        node: node,
        new_parent_id: new_parent_id,
        from_parent_id: from_parent_id,
        actor: current_user,
        request_id: context[:request_id]
      )

      { node: moved }
    end
  end
end
