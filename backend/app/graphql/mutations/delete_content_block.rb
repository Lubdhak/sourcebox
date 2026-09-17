# frozen_string_literal: true

module Mutations
  class DeleteContentBlock < BaseDocumentationMutation
    description "Remove a content block and close the gap it leaves in its siblings' order."

    argument :block_id, ID, description: "The block to delete."

    field :deleted_block_id, ID, null: true,
          description: "The id of the removed block."
    field :node, Types::NodeType, null: true,
          description: "The owning node, whose remaining blocks have been renumbered."

    def resolve(block_id:)
      # Two hops to a space (block -> node -> space), which is why content blocks have
      # their own authorization helper.
      block = authorize_content_block!(ContentBlock.find_by(id: block_id), :write)
      node = block.node

      deleted_id = Documentation::DeleteContentBlock.call(
        block: block,
        actor: current_user,
        request_id: context[:request_id]
      )

      { deleted_block_id: deleted_id.to_s, node: node.reload }
    end
  end
end
